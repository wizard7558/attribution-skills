#!/usr/bin/env node
import {readFile,writeFile,mkdir,rename} from 'node:fs/promises';
import {spawn} from 'node:child_process';
import {realpathSync} from 'node:fs';
import {createHash,randomUUID} from 'node:crypto';
import {dirname,resolve,join} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {homedir} from 'node:os';
export const VERSION='1.0.0';
export const FILES=Object.freeze(['sessions.sql','channel_daily.sql','landing_pages.sql','traffic_source_compare.sql','params.sql','key_events.sql','ui_reconciliation.sql','ecommerce.sql']);
export const DEFAULT_CAP='1073741824';
const here=dirname(fileURLToPath(import.meta.url));
export const sha256=x=>createHash('sha256').update(x).digest('hex');
const fail=s=>{throw new Error(s);};
const exact=(s,re)=>typeof s==='string'&&re.test(s)&&s.match(re)?.[0]===s;
export function validDate(s){
 if(!exact(s,/^[0-9]{8}$/))return false;
 const y=Number(s.slice(0,4)),m=Number(s.slice(4,6)),d=Number(s.slice(6));
 const days=[31,(y%4===0&&(y%100!==0||y%400===0))?29:28,31,30,31,30,31,31,30,31,30,31];
 return y>=1&&m>=1&&m<=12&&d>=1&&d<=days[m-1];
}
export function validateConfig(input){
 const c={sourceProject:input.sourceProject,dataset:input.dataset,start:input.start,end:input.end,billingProject:input.billingProject??input.sourceProject,location:input.location??'US',maximumBytesBilled:input.maximumBytesBilled??DEFAULT_CAP};
 for(const k of ['sourceProject','billingProject'])if(!exact(c[k],/^[a-z][a-z0-9-]{4,28}[a-z0-9]$/))fail(`Invalid ${k}: require standard 6–30 character project ID`);
 if(!exact(c.dataset,/^[A-Za-z0-9_]{1,1024}$/))fail('Invalid dataset');
 if(!validDate(c.start)||!validDate(c.end)||c.start>c.end)fail('Invalid Gregorian date window');
 if(!exact(c.location,/^[A-Za-z][A-Za-z0-9-]{0,62}$/))fail('Invalid location');
 if(!exact(c.maximumBytesBilled,/^[1-9][0-9]*$/)||BigInt(c.maximumBytesBilled)>9223372036854775807n)fail('Invalid positive INT64 byte cap');
 return c;
}
export function parseArgs(args,env={}){
 const values=new Map(),pos=[];const switches=new Set(['--render-only','--synthetic']);
 const valued=new Set(['--billing-project','--location','--report','--resume-report']);
 for(let i=0;i<args.length;i++){
  const a=args[i];if(a.startsWith('--')){if(values.has(a)||(!switches.has(a)&&!valued.has(a)))fail(`Unknown or repeated option ${a}`);if(switches.has(a))values.set(a,true);else{const v=args[++i];if(!v||v.startsWith('--'))fail(`Missing value ${a}`);values.set(a,v);}}
  else pos.push(a);
 }
 if(values.has('--synthetic')){
  if(pos.length||!values.has('--billing-project')||values.has('--render-only')||values.has('--resume-report'))fail('Synthetic mode requires --billing-project; no positional, render or resume options');
  const c=validateConfig({sourceProject:values.get('--billing-project'),dataset:'validation',start:'20260901',end:'20260903',location:values.get('--location'),maximumBytesBilled:env.MAX_BYTES??DEFAULT_CAP});
  if(c.maximumBytesBilled!==DEFAULT_CAP)fail('Synthetic proof requires the fixed 1 GiB ordinary-job cap');
  return {synthetic:true,config:c,report:values.get('--report')};
 }
 if(pos.length!==4)fail('Usage: run_checks.sh PROJECT DATASET START_YYYYMMDD END_YYYYMMDD [--billing-project PROJECT] [--location US] [--render-only] [--report PATH] [--resume-report PATH]');
 if(values.has('--render-only')&&values.has('--resume-report'))fail('Render-only cannot resume native jobs');
 return {config:validateConfig({sourceProject:pos[0],dataset:pos[1],start:pos[2],end:pos[3],billingProject:values.get('--billing-project'),location:values.get('--location'),maximumBytesBilled:env.MAX_BYTES??DEFAULT_CAP}),renderOnly:values.has('--render-only'),report:values.get('--report'),resumeReport:values.get('--resume-report')};
}
export function renderTemplate(name,source,config){
 if(!FILES.includes(name))fail('Template outside fixed allowlist');const c=validateConfig(config);
 if(!source.includes('PROJECT.analytics_PROPERTY_ID')||!source.includes("'YYYYMMDD' AND 'YYYYMMDD'"))fail('Missing required template markers');
 let sql=source.replaceAll('PROJECT.analytics_PROPERTY_ID',()=>`${c.sourceProject}.${c.dataset}`)
 .replaceAll("'YYYYMMDD' AND 'YYYYMMDD'",()=>`'${c.start}' AND '${c.end}'`)
 .replaceAll("'YYYYMMDD' AS start_suffix, 'YYYYMMDD' AS end_suffix",()=>`'${c.start}' AS start_suffix, '${c.end}' AS end_suffix`)
 .replaceAll("PARSE_DATE('%Y%m%d','YYYYMMDD'),PARSE_DATE('%Y%m%d','YYYYMMDD')",()=>`PARSE_DATE('%Y%m%d','${c.start}'),PARSE_DATE('%Y%m%d','${c.end}')`);
 if(/YYYYMMDD|PROJECT\.analytics_PROPERTY_ID/.test(sql))fail('Unresolved template placeholder');
 return sql;
}
export async function captureTemplates(config,sqlDir=resolve(here,'../references/sql')){
 const templates=[];for(const name of FILES){const source=await readFile(join(sqlDir,name),'utf8'),query=renderTemplate(name,source,config);templates.push({name,sourceSha256:sha256(source),querySha256:sha256(query),query});}return templates;
}
export function decodeRows(schema,rows){
 if(!schema||!Array.isArray(schema.fields)||!Array.isArray(rows))fail('Missing result schema or row array');
 const record=(fields,row)=>{if(!row||!Array.isArray(row.f)||row.f.length!==fields.length)fail('Invalid STRUCT result');return Object.fromEntries(fields.map((f,i)=>[f.name,cell(f,row.f[i]?.v)]));};
 const cell=(f,v)=>{
  if(f.mode==='REPEATED'){if(!Array.isArray(v))fail('Invalid REPEATED result');return v.map(x=>cell({...f,mode:'NULLABLE'},x.v));}
  if(v===null)return null;if(v===undefined)fail('Missing result cell');
  if(['RECORD','STRUCT'].includes(f.type))return record(f.fields,v);
  if(['BOOLEAN','BOOL'].includes(f.type)){if(v==='true'||v===true)return true;if(v==='false'||v===false)return false;fail('Invalid Boolean result');}
  if(['FLOAT','FLOAT64'].includes(f.type)){if(typeof v!=='string'&&typeof v!=='number')fail('Invalid FLOAT result');const n=Number(v);return Number.isFinite(n)?n:String(v);}
  if(typeof v!=='string')fail(`Expected string encoding for ${f.type}`);
  return v;
 };
 return rows.map(r=>record(schema.fields,r));
}
export async function collectResults(getPage,identity,onPage=async()=>{}){
 const pages=[],tokens=new Set();let token,expected,schema;const rawRows=[];
 do{
  const page=await getPage(token);pages.push(page);await onPage(page);
  if(page.jobComplete!==true)fail('Result retrieval pending: jobComplete is not true');
  if(page.errors?.length)fail('Result page reports query errors');
  const ref=page.jobReference;
  if(!ref||ref.projectId!==identity.projectId||ref.jobId!==identity.jobId||ref.location?.toLowerCase()!==identity.location.toLowerCase())fail('Result job identity mismatch');
  if(!exact(page.totalRows,/^[0-9]+$/))fail('Missing totalRows');
  if(expected===undefined)expected=page.totalRows;else if(expected!==page.totalRows)fail('Changing totalRows');
  if(page.schema){if(schema&&JSON.stringify(schema)!==JSON.stringify(page.schema))fail('Changing schema');schema=page.schema;}
  if(page.rows!==undefined&&!Array.isArray(page.rows))fail('Invalid rows');rawRows.push(...(page.rows??[]));
  token=page.pageToken;if(token!==undefined&&token!==null&&token!==''){if(typeof token!=='string'||tokens.has(token))fail('Repeated or invalid page token');tokens.add(token);}
 }while(token);
 if(BigInt(rawRows.length)!==BigInt(expected))fail('Retrieved row count does not equal totalRows');
 const rows=decodeRows(schema??{fields:[]},rawRows);
 const parsedResultJson=rows.filter(r=>Object.hasOwn(r,'result_json')).map(r=>{if(typeof r.result_json!=='string')fail('result_json is not a string');return JSON.parse(r.result_json);});
 return {pages,schema:schema??{fields:[]},totalRows:expected,rows,parsedResultJson};
}
export function command(program,args,input=''){
 return new Promise((done,reject)=>{const p=spawn(program,args,{stdio:['pipe','pipe','pipe'],shell:false});let stdout='',stderr='';p.stdout.on('data',b=>stdout+=b);p.stderr.on('data',b=>stderr+=b);p.on('error',reject);p.on('close',code=>done({code,stdout,stderr}));p.stdin.on('error',()=>{});p.stdin.end(input);});
}
export function createNativeTransport(config,{run=command,fetchImpl=fetch}={}){
 const c=validateConfig(config);let token;
 const sanitize=x=>token?String(x).replaceAll(token,'[REDACTED_ACCESS_TOKEN]'):String(x);
 async function rest(path,query){
  if(!token){const auth=await run('gcloud',['auth','print-access-token']);if(auth.code!==0||!auth.stdout.trim())fail('gcloud access-token acquisition failed (credential output deliberately omitted)');token=auth.stdout.trim();}
  const url=new URL('https://bigquery.googleapis.com/bigquery/v2/'+path);for(const [k,v]of Object.entries(query))if(v!==undefined)url.searchParams.set(k,v);
  let response,raw;try{response=await fetchImpl(url,{headers:{Authorization:`Bearer ${token}`},signal:AbortSignal.timeout(30000)});raw=await response.text();}catch(e){const err=new Error('BigQuery REST transport failed: '+sanitize(e.message));err.rest={url:String(url),transportError:sanitize(e.message)};throw err;}
  let body;try{body=JSON.parse(raw);}catch{const e=new Error('BigQuery REST non-JSON response');e.rest={url:String(url),status:response.status,raw:sanitize(raw)};throw e;}
  if(!response.ok){const e=new Error(`BigQuery REST HTTP ${response.status}`);e.rest={url:String(url),status:response.status,body:JSON.parse(sanitize(JSON.stringify(body)))};throw e;}
  return body;
 }
 const base=`projects/${encodeURIComponent(c.billingProject)}`;
 return {
  async versions(){return {node:process.version,bq:await run('bq',['version']),gcloud:await run('gcloud',['version'])};},
  async submit(job){return run('bq',[`--project_id=${c.billingProject}`,`--location=${c.location}`,'--format=json','--quiet','--synchronous_mode=false',`--job_id=${job.jobId}`,'query','--use_legacy_sql=false','--use_cache=false',`--maximum_bytes_billed=${job.maximumBytesBilled??c.maximumBytesBilled}`,'--max_rows=0'],job.query);},
  metadata:job=>rest(`${base}/jobs/${encodeURIComponent(job.jobId)}`,{location:c.location}),
  page:(job,pageToken)=>rest(`${base}/queries/${encodeURIComponent(job.jobId)}`,{location:c.location,maxResults:'1000',timeoutMs:'10000','formatOptions.useInt64Timestamp':'true',pageToken}),
 };
}
export async function exclusiveReport(path,report){await mkdir(dirname(path),{recursive:true});await writeFile(path,JSON.stringify(report,null,2)+'\n',{flag:'wx',mode:0o600});return async()=>{const tmp=path+'.tmp-'+randomUUID();await writeFile(tmp,JSON.stringify(report,null,2)+'\n',{mode:0o600});await rename(tmp,path);};}
export async function executeJob(job,config,transport,save,{submit=true,pollDelay=3000,maxPolls=200}={}){
 const attempt={startedAt:new Date().toISOString(),kind:submit?'submission_and_retrieval':'read_only_retrieval',pages:[],metadataObservations:[]};job.attempts??=[];job.attempts.push(attempt);job.state='pending';await save();
 try{
  if(submit){job.submissionStartedAt=new Date().toISOString();await save();attempt.submission=await transport.submit(job);await save();}
  let metadata;
  for(let i=0;i<maxPolls;i++){
   metadata=await transport.metadata(job);attempt.metadataObservations.push(metadata);await save();
   const ref=metadata.jobReference,q=metadata.configuration?.query;
   if(ref?.projectId!==config.billingProject||ref?.jobId!==job.jobId||ref?.location?.toLowerCase()!==config.location.toLowerCase())fail('Metadata job identity mismatch');
   if(!q||q.query!==job.query||q.useLegacySql!==false||q.useQueryCache!==false||String(q.maximumBytesBilled)!==String(job.maximumBytesBilled??config.maximumBytesBilled))fail('Native query configuration mismatch');
   if(metadata.status?.state==='DONE')break;
   if(i===maxPolls-1)fail('Job remains pending; resume the recorded handle');
   await new Promise(r=>setTimeout(r,pollDelay));
  }
  job.metadata=metadata;job.totalBytesProcessed=metadata.statistics?.query?.totalBytesProcessed??null;job.totalBytesBilled=metadata.statistics?.query?.totalBytesBilled??null;
  if(metadata.status.errorResult){job.state='query_failed';fail('Native job failed; inspect retained errorResult');}
  const result=await collectResults(t=>transport.page(job,t),{projectId:config.billingProject,location:config.location,jobId:job.jobId},async page=>{attempt.pages.push(page);await save();});
  job.result=result;job.state='completed';attempt.completedAt=new Date().toISOString();await save();return result;
 }catch(e){attempt.error={message:e.message,...(e.rest?{rest:e.rest}:{})};attempt.completedAt=new Date().toISOString();if(job.state!=='query_failed')job.state='retrieval_pending_or_failed';await save();return null;}
}
export async function runChecks(options,{transport,sqlDir,wrapperHash}={}){
 const config=validateConfig(options.config),templates=await captureTemplates(config,sqlDir);
 wrapperHash??=sha256(await readFile(fileURLToPath(import.meta.url)));
 const report={version:VERSION,mode:options.renderOnly?'render_only':'native',state:'prepared',startedAt:new Date().toISOString(),pid:process.pid,config,wrapperSha256:wrapperHash,templates,jobs:[]};
 if(options.resumeReport){const old=JSON.parse(await readFile(options.resumeReport,'utf8'));if(old.mode!=='native'||JSON.stringify(old.config)!==JSON.stringify(config)||old.wrapperSha256!==wrapperHash||JSON.stringify(old.templates)!==JSON.stringify(templates))fail('Resume source/config/query mismatch');
  const seen=new Set();for(const j of old.jobs){const t=templates.find(x=>x.name===j.name);if(!t||seen.has(j.name)||j.query!==t.query||j.querySha256!==t.querySha256||!exact(j.jobId,/^[A-Za-z0-9_-]+$/))fail('Invalid resume job record');seen.add(j.name);}report.jobs=structuredClone(old.jobs);report.resumedFrom={path:resolve(options.resumeReport),sha256:sha256(await readFile(options.resumeReport))};}
 const path=resolve(options.report??join(homedir(),'Downloads',`ga4-export-checks-${Date.now()}-${randomUUID().slice(0,8)}.json`));
 if(options.resumeReport&&path===resolve(options.resumeReport))fail('Resume requires a new output report');
 const save=await exclusiveReport(path,report);
 if(options.renderOnly){report.state='rendered';report.sqlExecuted=false;await save();return {path,report};}
 transport??=createNativeTransport(config);
 try{
  report.versions=await transport.versions();
  for(const name of ['bq','gcloud'])if(report.versions[name]&&report.versions[name].code!==0)fail(`${name} version command failed; inspect retained command output`);
 }catch(e){report.state='incomplete';report.startupError={message:e.message,code:e.code??null};report.completedAt=new Date().toISOString();await save();return {path,report};}
 report.state='running';await save();
 for(const template of templates){let job=report.jobs.find(j=>j.name===template.name);const submit=!job;if(!job){job={name:template.name,jobId:'ga4_export_'+randomUUID().replaceAll('-',''),query:template.query,querySha256:template.querySha256,state:'prepared'};report.jobs.push(job);await save();}
  console.log(`${submit?'SUBMIT':'RETRIEVE'} ${job.name} ${job.jobId}`);await executeJob(job,config,transport,save,{submit});}
 report.state=report.jobs.every(j=>j.state==='completed')?'completed':'incomplete';report.completedAt=new Date().toISOString();await save();return {path,report};
}
async function main(){const options=parseArgs(process.argv.slice(2),process.env);if(options.synthetic){const {runSynthetic}=await import('./test-export-checks.mjs');await runSynthetic(options);return;}const {path,report}=await runChecks(options);console.log(`${report.mode==='render_only'?'NO SQL EXECUTED':report.state}: ${path}`);if(report.state==='incomplete')process.exitCode=1;}
if(process.argv[1]&&import.meta.url===pathToFileURL(realpathSync(process.argv[1])).href)main().catch(e=>{console.error(e.message);process.exitCode=1;});
