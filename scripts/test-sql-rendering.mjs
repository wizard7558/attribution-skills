// Focused offline regression: execute actual runner functions/expressions, never BigQuery.
import assert from 'node:assert/strict';
import {readFile,writeFile,copyFile,mkdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {homedir} from 'node:os';
import {join,resolve,dirname} from 'node:path';
import {pathToFileURL,fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const option=name=>{const i=process.argv.indexOf(name);if(i<0)return null;assert.ok(process.argv[i+1]&&!process.argv[i+1].startsWith('--'),name+' needs a value');return process.argv[i+1];};
const stamp=new Date().toISOString().replaceAll(/[^0-9]/g,'');
const output=option('--output')??join(homedir(),'Downloads','attribution-sql-rendering-review-evidence-'+stamp+'.json');
const beforePath=option('--before');
const baselineKind=beforePath?'historical_sources':'reconstructed_mutants';
const hash=s=>createHash('sha256').update(s).digest('hex');
const inputPrefix='.replace(/-- BEGIN REPLACEABLE INPUTS[\\s\\S]*?-- END REPLACEABLE INPUTS/,';
const tablePrefix='.replace(/CREATE TEMP TABLE invocation_input AS[\\s\\S]*?;/,';
const owned=[
 {path:'skills/attribution-data-quality-tripwires/scripts/test-population-checks.mjs',patches:[[inputPrefix+'()=>',inputPrefix,1]]},
 {path:'skills/attribution-data-quality-tripwires/scripts/test-reconciliation.mjs',patches:[[inputPrefix+'()=>',inputPrefix,1]]},
 {path:'skills/funnel-truth-and-cost-per-stage/scripts/test-stage-truth.mjs',patches:[[inputPrefix+' () => ',inputPrefix+' ',1],[tablePrefix+'()=> ',tablePrefix+' ',1]]},
 {path:'skills/funnel-truth-and-cost-per-stage/scripts/test-cost-per-stage.mjs',patches:[[inputPrefix+'()=>',inputPrefix,3],[tablePrefix+'()=>',tablePrefix,1]]},
 {path:'skills/funnel-truth-and-cost-per-stage/scripts/test-refresh-partitions.mjs',patches:[[inputPrefix+'()=>',inputPrefix,3],[tablePrefix+'()=>',tablePrefix,2]]},
 {path:'skills/multi-touch-models-sql/scripts/test-credit-ledger.mjs',patches:[[inputPrefix+'()=>',inputPrefix,1],[tablePrefix+'()=>',tablePrefix,2]]},
 {path:'skills/multi-touch-models-sql/scripts/test-attribution-metrics.mjs',patches:[[inputPrefix+'()=>',inputPrefix,2]]}
];
assert.equal(owned.reduce((n,f)=>n+f.patches.reduce((a,p)=>a+p[2],0),0),18);
const reconstructionPatches=[];
let beforeSources;
if(beforePath)beforeSources=JSON.parse(await readFile(beforePath,'utf8')).beforeSources;
else{
 beforeSources={};
 for(const {path,patches}of owned){
  let source=await readFile(join(root,path),'utf8');
  for(const [from,to,count]of patches){
   assert.equal(source.split(from).length-1,count,path+': exact callback-site count');
   source=source.split(from).join(to);
   reconstructionPatches.push({path,from,to,count});
  }
  beforeSources[path]=source;
 }
}
assert.deepEqual(Object.keys(beforeSources).sort(),owned.map(f=>f.path).sort(),'exact seven owned renderer paths');
const exportsToRead=['query','fixtureQuery','renderTable','table','inputsFor','inputs','input','upstreamQuery','upstreamFixtures','data','cases','additionalChecks','failureCases','failures','schemas','sql','sources','meta','identity','fixtureText','upstreamFixtureText'];
async function loadActual(relative,source){
 const url=pathToFileURL(join(root,relative)).href;
 // Only harness instrumentation: disable live flags/logging, preserve original file-relative reads,
 // and expose the actual existing lexical functions. No renderer implementation is replaced.
 const instrumented="const process={argv:['node','offline-render-test'],version:globalThis.process.version};\nconst console={log(){}};\n"+
 source.replaceAll('import.meta.url',JSON.stringify(url))+
 '\nexport const __rendering={'+exportsToRead.map(k=>k+':typeof '+k+"==='undefined'?undefined:"+k).join(',')+'};\n';
 return (await import('data:text/javascript;base64,'+Buffer.from(instrumented).toString('base64'))).__rendering;
}
const report={status:'running',startedAt:new Date().toISOString(),nodeVersion:process.version,beforePath,baselineKind,historicalByteProof:beforePath!==null,reconstructionPatches,beforeSources,afterSources:{},runners:[],fixtureQueries:[],paths:[],dollarCases:[],offlineCommands:[],nativeSqlExecuted:false};
const modules={};
const fixtureSet=r=>r.data?.cases??[...(r.cases??[]),...(r.additionalChecks??[]),...(r.failureCases??[]),...(r.failures??[])].filter((x,i,a)=>a.indexOf(x)===i);
function main(r,f){
 if(r.fixtureQuery)return r.fixtureQuery([f]);
 if(r.sources)return r.query([f],f.check);
 return r.query(f);
}
function historical(path,label,before,after){
 assert.equal(after,before,path+': '+label+' fixture bytes');
 report.fixtureQueries.push({path,label,beforeSha256:hash(before),afterSha256:hash(after),byteLength:Buffer.byteLength(after),sql:after});
}
function pathRecord(path,label,sourceBefore,sourceAfter){
 report.paths.push({path,label,beforeExpression:sourceBefore,afterExpression:sourceAfter});
}
const variants=[
 {name:'replacement_suffix',value:'tail$',sqlLiteral:"'tail$'"},
 {name:'whole_match',value:'left$&right',sqlLiteral:"'left$&right'"},
 {name:'literal_dollar_pair',value:'left$$right',sqlLiteral:"'left$$right'"},
 {name:'capture_reference_literal',value:'left$1right',sqlLiteral:"'left$1right'"}
];
const neutral='RENDER_NEUTRAL_6A54';
function dollars(path,label,renderBefore,renderAfter){
 const b=renderBefore(neutral),a=renderAfter(neutral);
 assert.equal(a,b,label+': neutral bytes');
 assert.ok(a.includes("'"+neutral+"'"),label+': independent neutral literal');
 for(const variant of variants){
  const expected=a.split(neutral).join(variant.value);
  assert.ok(expected.includes(variant.sqlLiteral),'independent literal expectation');
  const actual=renderAfter(variant.value),oldActual=renderBefore(variant.value);
  assert.equal(actual,expected,path+': '+label+' '+variant.name);
  const oldRejected=oldActual!==expected;
  assert.equal(oldRejected,variant.name!=='capture_reference_literal',label+': old behavior executed');
  report.dollarCases.push({path,label,variant:variant.name,value:variant.value,expectedLiteral:variant.sqlLiteral,expectedSql:expected,actualSql:actual,oldActualSql:oldActual,oldRejected});
 }
}
function expression(line,start){return line.slice(line.indexOf(start)).trim().replace(/;$/,'');}
function evaluate(expr,scope){return Function(...Object.keys(scope),'return ('+expr+');')(...Object.values(scope));}
function firstLine(source,predicate){const result=source.split('\n').find(predicate);assert.ok(result,'actual source expression found');return result;}
try{
 for(const [path,before]of Object.entries(beforeSources)){
  const after=await readFile(join(root,path),'utf8');report.afterSources[path]=after;
  // Fixed intentional capture substitutions must remain byte-for-byte unchanged.
  const captures=s=>s.split('\n').filter(l=>l.includes('SELECT * FROM ($1)'));
  assert.deepEqual(captures(after),captures(before),path+': preserve intentional capture references');
  const b=await loadActual(path,before),a=await loadActual(path,after);modules[path]={before:b,after:a};
  assert.ok(!b.fixtureText.includes('$'),path+': current fixture has no dollar characters');
  if(b.upstreamFixtureText)assert.ok(!b.upstreamFixtureText.includes('$'));
  report.runners.push({path,beforeSha256:hash(before),afterSha256:hash(after),fixtureSha256:hash(b.fixtureText),upstreamFixtureSha256:b.upstreamFixtureText?hash(b.upstreamFixtureText):null});
  for(const f of fixtureSet(a))historical(path,'fixture:'+f.id,main(b,f),main(a,f));
  if(a.fixtureQuery)historical(path,'full-success-batch',b.fixtureQuery(fixtureSet(b).filter(f=>f.expected)),a.fixtureQuery(fixtureSet(a).filter(f=>f.expected)));
  if(a.sources)for(const kind of Object.keys(a.sources)){const fs=fixtureSet(a).filter(f=>f.expected&&f.check===kind);historical(path,'full-success-batch:'+kind,b.query(fs,kind),a.query(fs,kind));}
  const baseline=fixtureSet(a).find(f=>f.expected);
  const withValue=v=>{const f=structuredClone(baseline);if(path.endsWith('test-attribution-metrics.mjs'))f.input.configuration.report_scope=v;else f.id=v;return f;};
  dollars(path,'actual-main-renderer',v=>main(b,withValue(v)),v=>main(a,withValue(v)));
  pathRecord(path,'main fixture renderer',firstLine(before,l=>l.includes('.replace(')&&l.includes('-- BEGIN REPLACEABLE INPUTS')),firstLine(after,l=>l.includes('.replace(')&&l.includes('-- BEGIN REPLACEABLE INPUTS')));
  // Actual write-example assignment expression; file writing is deliberately not executed.
  if(after.includes('--write-example')){
   const assignment=source=>{
    const line=firstLine(source,l=>l.includes('sql=sql.replace(')||l.includes('sql=query(cases[0])'));
    return line.includes('sql=query(')?'query(cases[0])':line.slice(line.indexOf('sql.replace('),line.indexOf(';',line.indexOf('sql.replace(')));
   };
   const be=assignment(before),ae=assignment(after);
   const render=(r,e,f)=>evaluate(e,{sql:r.sql,query:r.query,inputsFor:r.inputsFor,cases:[f]});
   historical(path,'write-example',render(b,be,baseline),render(a,ae,baseline));
   dollars(path,'write-example',v=>render(b,be,withValue(v)),v=>render(a,ae,withValue(v)));
   pathRecord(path,'write-example',be,ae);
  }
  // Actual missing-configuration and generated duplicate-configuration call expressions.
  for(const [index,line]of before.split('\n').entries()){
   if(!line.includes('.replace(/CREATE TEMP TABLE invocation_input AS')||(!line.includes('renderTable(')&&!line.includes(',table(')))continue;
   const next=after.split('\n')[index];assert.ok(next);
   const extract=l=>{
    const start=l.includes('priorSql.replace(')?'priorSql.replace(':'sql.replace(';
    let e=l.slice(l.indexOf(start)).trim();
    const marker=e.lastIndexOf(",'exactly one invocation");if(marker>=0)e=e.slice(0,marker);else e=e.replace(/;$/,'');
    return e;
   };
   const be=extract(line),ae=extract(next),scope=r=>({sql:r.sql,priorSql:r.sql,renderTable:r.renderTable,table:r.table,cases:r.cases});
   historical(path,'configuration-branch-line-'+(index+1),evaluate(be,scope(b)),evaluate(ae,scope(a)));
   pathRecord(path,'configuration-branch-line-'+(index+1),be,ae);
   if(line.includes('[1,2]')){
    const render=(r,e,v)=>{const fs=structuredClone(r.cases);fs[0].id=v;return evaluate(e,{...scope(r),cases:fs});};
    dollars(path,'generated-duplicate-configuration',v=>render(b,be,v),v=>render(a,ae,v));
   }
  }
  // MTA's actual upstreamQuery reads and projects its real producer fixture.
  if(a.upstreamQuery){
   for(const f of a.cases.filter(f=>f.upstream_fixture))historical(path,'upstream:'+f.id,b.upstreamQuery(f),a.upstreamQuery(f));
   const f=a.cases.find(f=>f.upstream_fixture);
   const render=(r,v)=>{const u=r.upstreamFixtures.cases.find(x=>x.id===f.upstream_fixture),previous=u.input.configuration.report_timezone;u.input.configuration.report_timezone=v;try{return r.upstreamQuery(f);}finally{u.input.configuration.report_timezone=previous;}};
   dollars(path,'actual-upstream-producer',v=>render(b,v),v=>render(a,v));
   pathRecord(path,'upstreamQuery',firstLine(before,l=>l.includes('return upstreamSql.replace')),firstLine(after,l=>l.includes('return upstreamSql.replace')));
  }
 }
 // Execute the original inline CRM-to-stage producer renderer up to its first native run.
 const costPath='skills/funnel-truth-and-cost-per-stage/scripts/test-cost-per-stage.mjs';
 const refreshPath='skills/funnel-truth-and-cost-per-stage/scripts/test-refresh-partitions.mjs';
 const stageSql=await readFile(join(root,'skills/funnel-truth-and-cost-per-stage/references/sql/stage_truth.sql'),'utf8');
 const stageData=JSON.parse(await readFile(join(root,'skills/funnel-truth-and-cost-per-stage/references/stage-fixtures.json'),'utf8'));
 const crmData=JSON.parse(await readFile(join(root,'skills/crm-paid-attribution/references/fixtures.json'),'utf8'));
 const {attributeLeads}=await import(pathToFileURL(join(root,'skills/crm-paid-attribution/scripts/attribute-leads.mjs')));
 const crm=crmData.cases.find(f=>f.id==='qualified-catalog-campaign-output');
 const crmRow=attributeLeads(crm.input.leads,crm.input.options)[0];
 function costProducer(source,r,value){
  const start=source.indexOf('   const stageSchemas='),end=source.indexOf("   const stageRun=await run(",start);assert.ok(start>=0&&end>start);
  const body=source.slice(start,end)+'return stageQuery;';
  const scope={source:{...crmRow,source_scope:value},stageFixture:stageData.cases.find(f=>f.expected&&f.input.leads.length===1&&f.input.opportunities.length>=3),integrationId:'actual-crm-stage-cost-integration',identity:r.identity,meta:r.meta,schemas:r.schemas,renderTable:r.renderTable,stageSql};
  return Function(...Object.keys(scope),body)(...Object.values(scope));
 }
 const cost=modules[costPath];
 historical(costPath,'actual-CRM-stage-producer',costProducer(beforeSources[costPath],cost.before,crmRow.source_scope),costProducer(report.afterSources[costPath],cost.after,crmRow.source_scope));
 dollars(costPath,'actual-CRM-stage-producer',v=>costProducer(beforeSources[costPath],cost.before,v),v=>costProducer(report.afterSources[costPath],cost.after,v));
 pathRecord(costPath,'stage producer integration',firstLine(beforeSources[costPath],l=>l.includes('const stageQuery=stageSql.replace')),firstLine(report.afterSources[costPath],l=>l.includes('const stageQuery=stageSql.replace')));
 function refreshProducer(source,r,value){
  const start=source.indexOf('   const config=cases[0].input.configuration;'),end=source.indexOf('    const stageRun=await run(',start);assert.ok(start>=0&&end>start);
  const body='const __queries=[];\n'+source.slice(start,end)+'__queries.push(query);}\nreturn __queries;';
  const cases=structuredClone(r.cases);cases[0].input.configuration.source_scope=value;
  const scope={cases,meta:r.meta,identity:r.identity,renderTable:r.renderTable,stageSql};
  return Function(...Object.keys(scope),body)(...Object.values(scope));
 }
 const refresh=modules[refreshPath],scope=refresh.after.cases[0].input.configuration.source_scope;
 const rb=refreshProducer(beforeSources[refreshPath],refresh.before,scope),ra=refreshProducer(report.afterSources[refreshPath],refresh.after,scope);
 for(let side=0;side<2;side++){
  historical(refreshPath,'actual-stage-producer-'+side,rb[side],ra[side]);
  dollars(refreshPath,'actual-stage-producer-'+side,v=>refreshProducer(beforeSources[refreshPath],refresh.before,v)[side],v=>refreshProducer(report.afterSources[refreshPath],refresh.after,v)[side]);
 }
 pathRecord(refreshPath,'stage producer integration',firstLine(beforeSources[refreshPath],l=>l.includes('const query=stageSql.replace')),firstLine(report.afterSources[refreshPath],l=>l.includes('const query=stageSql.replace')));
 for(const path of Object.keys(beforeSources)){
  for(const args of [['--check',path],[path]]){
   const run=spawnSync(process.execPath,args,{cwd:root,encoding:'utf8'});
   assert.equal(run.status,0,path+': '+run.stderr);
   report.offlineCommands.push({args,exitCode:run.status,stdout:run.stdout,stderr:run.stderr});
  }
 }
 report.status='passed';report.completedAt=new Date().toISOString();
 report.counts={runners:report.runners.length,fixtureQueries:report.fixtureQueries.length,coveredPaths:report.paths.length,dollarCases:report.dollarCases.length,oldBehaviorRejected:report.dollarCases.filter(c=>c.oldRejected).length,offlineCommands:report.offlineCommands.length};
}catch(error){report.status='failed';report.error=error.stack;report.completedAt=new Date().toISOString();throw error;}
finally{
 await mkdir(dirname(output),{recursive:true});
 try{await copyFile(output,output.replace('.json','-previous-'+Date.now()+'.json'));}catch(error){if(error.code!=='ENOENT')throw error;}
 await writeFile(output,JSON.stringify(report,null,2)+'\n');
}
const guide="Seven native test renderers insert generated SQL as literal bytes. Fixed cardinality backreferences remain unchanged. No native queries run in this regression.\n\nPortable default:\n  node scripts/test-sql-rendering.mjs\nIt reads only the seven current runner sources to reconstruct the former replacement-string behavior at 18 explicitly counted sites. Evidence is labeled reconstructed_mutants and does not claim an original historical baseline.\n\nHistorical proof:\n  node scripts/test-sql-rendering.mjs --before PATH_TO_ORIGINAL_SOURCE_EVIDENCE\nThis uses the supplied original sources and labels evidence historical_sources. The accepted dated report is never a default dependency.\n\nBoth modes compare current-fixture SQL bytes and execute independent dollar-literal regressions against the actual renderers and old-behavior source. Reports use new timestamped Downloads paths. Optional --output PATH selects another report location; the guide is saved beside it. Existing reports are preserved before an explicitly reused output path is written.\n";
await writeFile(join(dirname(output),'attribution-sql-rendering-guide.md'),guide);
console.log('PASS '+JSON.stringify(report.counts)+' '+output);
