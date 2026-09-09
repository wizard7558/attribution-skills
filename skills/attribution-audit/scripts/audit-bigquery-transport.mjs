import {readFile,writeFile,mkdir,mkdtemp,chmod,rm,stat} from 'node:fs/promises';
import {createHash,randomUUID} from 'node:crypto';
import {spawn} from 'node:child_process';
import {types} from 'node:util';
import {isAbsolute,join,resolve} from 'node:path';
import {tmpdir} from 'node:os';
import {pathToFileURL} from 'node:url';
const own=(x,k)=>Object.hasOwn(x,k),sha=x=>createHash('sha256').update(x).digest('hex'),now=()=>new Date().toISOString();
const invalid=()=>{throw new TypeError('Invalid audit BigQuery transport input');};
function capture(x,active=new Set()){
 if(x===null||['string','boolean'].includes(typeof x))return x;if(typeof x==='number'){if(!Number.isFinite(x))invalid();return x;}
 if(typeof x!=='object'||types.isProxy(x)||active.has(x))invalid();const array=Array.isArray(x);if(!array&&![Object.prototype,null].includes(Object.getPrototypeOf(x)))invalid();active.add(x);const y=array?[]:{};
 for(const k of Reflect.ownKeys(x)){if(typeof k!=='string')invalid();if(array&&k==='length')continue;const d=Object.getOwnPropertyDescriptor(x,k);if(!d.enumerable||!own(d,'value')||(array&&!/^(0|[1-9]\d*)$/.test(k)))invalid();Object.defineProperty(y,k,{value:capture(d.value,active),enumerable:true,writable:true,configurable:true});}if(array&&(y.length!==x.length||Object.keys(y).length!==x.length))invalid();active.delete(x);return y;
}
function shape(x,keys){if(x===null||typeof x!=='object'||Array.isArray(x)||Object.keys(x).sort().join('\0')!==[...keys].sort().join('\0'))invalid();}
const canonical=x=>Array.isArray(x)?x.map(canonical):x&&typeof x==='object'?Object.fromEntries(Object.keys(x).sort().map(k=>[k,canonical(x[k])])):x;
const equal=(a,b)=>JSON.stringify(canonical(a))===JSON.stringify(canonical(b));
// Only native-observed omissions of explicitly null scalar DATE or STRING are equivalent.
function parameterMetadata(sent,received){
 const comparison=capture(received),equivalencePointers=[];
 if(Array.isArray(comparison.queryParameters)&&comparison.queryParameters.length===sent.queryParameters.length){
  for(let i=0;i<sent.queryParameters.length;i++){
   const expected=sent.queryParameters[i],actual=comparison.queryParameters[i];
   if(['DATE','STRING'].some(type=>equal(expected.parameterType,{type}))&&equal(expected.parameterValue,{value:null})&&equal(actual,{name:expected.name,parameterType:expected.parameterType})){
    comparison.queryParameters[i]={...actual,parameterValue:{value:null}};
    equivalencePointers.push('/queryParameters/'+i+'/parameterValue');
   }
  }
 }
 return {matches:equal(sent,comparison),equivalence_pointers:equivalencePointers};
}
function parameter(p){shape(p,['name','parameterType','parameterValue']);if(typeof p.name!=='string'||!/^[A-Za-z_][A-Za-z0-9_]*$/.test(p.name))invalid();
 function check(t,v){if(t?.type==='ARRAY'){shape(t,['type','arrayType']);if(t.arrayType?.type==='ARRAY')invalid();if(v?.value===null){shape(v,['value']);check(t.arrayType,{value:null});return;}shape(v,['arrayValues']);if(!Array.isArray(v.arrayValues))invalid();for(const x of v.arrayValues)check(t.arrayType,x);}
 else{shape(t,['type']);if(!['STRING','DATE','TIMESTAMP','DATETIME','TIME','BOOL','INT64','FLOAT64','NUMERIC','BIGNUMERIC','BYTES','GEOGRAPHY','JSON'].includes(t.type))invalid();shape(v,['value']);if(v.value!==null&&typeof v.value!=='string')invalid();}}
 check(p.parameterType,p.parameterValue);
}
function validate(input,options){shape(input,['configuration','query','queryParameters','parameterMode','resultKind']);shape(input.configuration,['billingProject','location','maximumBytesBilled']);const c=input.configuration;
 if(typeof c.billingProject!=='string'||!/^[a-z][a-z0-9-]{4,28}[a-z0-9]$/.test(c.billingProject)||typeof c.location!=='string'||!/^[A-Za-z][A-Za-z0-9-]{0,62}$/.test(c.location)||typeof c.maximumBytesBilled!=='string'||!/^[1-9][0-9]*$/.test(c.maximumBytesBilled)||BigInt(c.maximumBytesBilled)>9223372036854775807n)invalid();
 if(typeof input.query!=='string'||!input.query.trim()||!Array.isArray(input.queryParameters)||!['rows','single_result_json'].includes(input.resultKind))invalid();input.queryParameters.forEach(parameter);if(new Set(input.queryParameters.map(p=>p.name)).size!==input.queryParameters.length)invalid();if(input.parameterMode!==(input.queryParameters.length?'NAMED':null))invalid();
 shape(options,own(options,'resumeReportPath')?['sharedModulePath','expectedSharedSourceSha256','reportPath','resumeReportPath']:['sharedModulePath','expectedSharedSourceSha256','reportPath']);for(const k of ['sharedModulePath','reportPath',...(own(options,'resumeReportPath')?['resumeReportPath']:[])])if(typeof options[k]!=='string'||!isAbsolute(options[k]))invalid();if(typeof options.expectedSharedSourceSha256!=='string'||!/^[a-f0-9]{64}$/.test(options.expectedSharedSourceSha256))invalid();if(options.resumeReportPath&&resolve(options.reportPath)===resolve(options.resumeReportPath))invalid();
}
function command(program,args){return new Promise((done,reject)=>{const p=spawn(program,args,{shell:false,stdio:['ignore','pipe','pipe']});let stdout='',stderr='';p.stdout.setEncoding('utf8');p.stderr.setEncoding('utf8');p.stdout.on('data',x=>stdout+=x);p.stderr.on('data',x=>stderr+=x);p.on('error',reject);p.on('close',code=>done({code,stdout,stderr}));});}
/** Internal helper: eventual audit host must supply only fixed approved rendered SQL. */
export async function runAuditBigQuery(rawInput,rawOptions,{runCommand=command,fetchImpl=fetch,pollDelay=3000,maxPolls=200}={}){
 const input=capture(rawInput),options=capture(rawOptions);validate(input,options);
 const bytes=await readFile(options.sharedModulePath);if(sha(bytes)!==options.expectedSharedSourceSha256)throw new Error('Installed shared BigQuery helper hash mismatch');
 const helperHash=sha(await readFile(new URL(import.meta.url))),identityHash=sha(JSON.stringify(canonical({input,shared_source_sha256:sha(bytes),transport_source_sha256:helperHash})));let prior=null;
 if(options.resumeReportPath){prior=JSON.parse(await readFile(options.resumeReportPath,'utf8'));if(prior.identity_sha256!==identityHash||!equal(prior.input,input)||prior.shared_source_sha256!==sha(bytes)||prior.transport_source_sha256!==helperHash||typeof prior.job?.jobId!=='string'||!/^[A-Za-z0-9_-]+$/.test(prior.job.jobId)||prior.job.query!==input.query||prior.job.querySha256!==sha(input.query)||prior.job.maximumBytesBilled!==input.configuration.maximumBytesBilled||prior.mode!=='internal_bigquery_transport')throw new Error('Resume query parameters configuration or helper mismatch');}
 const snapshot=await mkdtemp(join(tmpdir(),'audit-bq-shared-'));let report,save;
 try{
  const copied=join(snapshot,'run-export-checks.mjs');await writeFile(copied,bytes,{flag:'wx',mode:0o444});await chmod(snapshot,0o555);const shared=await import(pathToFileURL(copied).href);for(const k of ['executeJob','collectResults','decodeRows','exclusiveReport'])if(typeof shared[k]!=='function')throw new Error('Invalid installed shared BigQuery helper');
  const job=prior?capture(prior.job):{jobId:'audit_native_'+randomUUID().replaceAll('-',''),query:input.query,querySha256:sha(input.query),maximumBytesBilled:input.configuration.maximumBytesBilled};
  report={contract_version:'0.1.0',mode:'internal_bigquery_transport',started_at:now(),finished_at:null,state:'prepared',input,identity_sha256:identityHash,shared_module_path:options.sharedModulePath,shared_source_sha256:sha(bytes),transport_source_sha256:helperHash,shared_snapshot_path:snapshot,job,resumed_from:options.resumeReportPath?{path:options.resumeReportPath,sha256:sha(await readFile(options.resumeReportPath))}:null,submission_attempted:false,server_job_observed:false,read_only_retrieval:Boolean(prior),confirmed_fresh_queries:0,effects_status:prior?'historical_handle_retrieval':'not_submitted',http:[],output:null,cleanup:{owned_snapshot_removed:false}};
  save=await shared.exclusiveReport(options.reportPath,report);
  let token=null;
  const sanitize=s=>token?String(s).replaceAll(token,'[REDACTED_ACCESS_TOKEN]'):String(s);
  async function credentials(){if(token)return token;let auth;try{auth=await runCommand('gcloud',['auth','print-access-token']);}catch{throw new Error('Credential command unavailable; credential output omitted');}if(auth.code!==0||!auth.stdout.trim())throw new Error('Credential acquisition failed; credential output omitted');token=auth.stdout.trim();return token;}
  async function rest(method,path,query={},body=null){const url=new URL('https://bigquery.googleapis.com/bigquery/v2/'+path);for(const[k,v]of Object.entries(query))if(v!==undefined)url.searchParams.set(k,v);
   const auth=await credentials(),record={method,url:String(url),request_body:body,started_at:now(),finished_at:null,status:null,body:null,error:null};report.http.push(record);if(method==='POST'){report.submission_attempted=true;report.effects_status='submission_uncertain';}await save();
   let response,text;try{response=await fetchImpl(url,{method,headers:{Authorization:'Bearer '+auth,...(body?{'Content-Type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{}),signal:AbortSignal.timeout(30000)});text=await response.text();record.status=response.status;record.body=JSON.parse(sanitize(text));record.finished_at=now();await save();}
   catch(e){record.finished_at=now();record.error={message:sanitize(e.message)};await save();throw new Error('BigQuery HTTP request failed; inspect retained safe evidence');}
   if(!response.ok)throw new Error('BigQuery HTTP '+response.status+'; inspect retained safe evidence');return record.body;
  }
  const c=input.configuration,base='projects/'+encodeURIComponent(c.billingProject),observe=metadata=>{const ref=metadata.jobReference;if(ref?.projectId===c.billingProject&&ref?.jobId===job.jobId&&ref?.location?.toLowerCase()===c.location.toLowerCase()){report.server_job_observed=true;report.effects_status=prior?'historical_handle_observed':'new_handle_observed';report.confirmed_fresh_queries=prior?0:1;}};
  const transport={
   async versions(){const result={node:process.version};for(const program of ['bq','gcloud']){try{result[program]=await runCommand(program,['version']);}catch(e){result[program]={code:null,error_code:e.code??null,message:'Runtime executable unavailable'};}if(result[program].code!==0){report.versions=result;await save();throw new Error('Runtime version check failed');}}return result;},
   async submit(){const query={query:input.query,useLegacySql:false,useQueryCache:false,maximumBytesBilled:c.maximumBytesBilled,...(input.parameterMode?{parameterMode:input.parameterMode,queryParameters:input.queryParameters}:{})};const body={jobReference:{projectId:c.billingProject,location:c.location,jobId:job.jobId},configuration:{query}};const result=await rest('POST',base+'/jobs',{},body);observe(result);await save();return {code:0,stdout:JSON.stringify(result),stderr:''};},
   async metadata(){const m=await rest('GET',base+'/jobs/'+encodeURIComponent(job.jobId),{location:c.location});observe(m);const q=m.configuration?.query;const sent={queryParameters:input.queryParameters,parameterMode:input.parameterMode},received={queryParameters:q?.queryParameters??[],parameterMode:q?.parameterMode??null};const verification=parameterMetadata(sent,received);(report.parameter_metadata_checks??=[]).push({sent:capture(sent),received:capture(received),...verification});if(!verification.matches){report.parameter_mismatch={sent,received};await save();throw new Error('Native named parameter metadata mismatch');}await save();return m;},
   page:(_,pageToken)=>rest('GET',base+'/queries/'+encodeURIComponent(job.jobId),{location:c.location,maxResults:'1000',timeoutMs:'10000','formatOptions.useInt64Timestamp':'true',pageToken}),
  };
  try{report.versions=await transport.versions();await save();const result=await shared.executeJob(job,c,transport,save,{submit:!prior,pollDelay,maxPolls});
   if(result){if(input.resultKind==='rows')report.output=result.rows;else if(result.rows.length===1&&result.parsedResultJson.length===1&&result.parsedResultJson[0]!==null&&typeof result.parsedResultJson[0]==='object'&&!Array.isArray(result.parsedResultJson[0]))report.output=result.parsedResultJson[0];else throw new Error('Expected exactly one parsed native result object');report.state='completed';}else report.state=job.state;
  }catch(e){report.state='execution_or_retrieval_failed';report.error={message:sanitize(e.message)};await save();}
 }finally{await chmod(snapshot,0o700);await rm(snapshot,{recursive:true,force:true});if(report){try{await stat(snapshot);}catch(e){if(e.code==='ENOENT')report.cleanup.owned_snapshot_removed=true;}report.finished_at=now();await save();}}
 return {reportPath:options.reportPath,report};
}
