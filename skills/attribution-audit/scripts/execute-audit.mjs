import { readFile, writeFile, mkdir, mkdtemp, realpath, chmod, rm, readdir, stat } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { isAbsolute } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { types } from 'node:util';
import { resolve, join, dirname, sep } from 'node:path';
import { tmpdir } from 'node:os';
import { pathToFileURL } from 'node:url';
import { composeAudit, canonicalHash } from './compose-audit.mjs';

const own=(o,k)=>Object.hasOwn(o,k), bad=()=>{throw new TypeError('Invalid fresh audit input');};
const sha=x=>createHash('sha256').update(x).digest('hex');
const now=()=>new Date().toISOString();
function capture(x,active=new Set()){
  if(x===null||typeof x==='string'||typeof x==='boolean')return x;
  if(typeof x==='number'){if(!Number.isFinite(x))bad();return x;}
  if(typeof x!=='object'||types.isProxy(x)||active.has(x))bad();
  const arr=Array.isArray(x);if(!arr&&![Object.prototype,null].includes(Object.getPrototypeOf(x)))bad();
  active.add(x);const out=arr?[]:{};
  for(const k of Reflect.ownKeys(x)){if(typeof k!=='string')bad();if(arr&&k==='length')continue;const d=Object.getOwnPropertyDescriptor(x,k);if(!d.enumerable||!own(d,'value')||(arr&&!/^(0|[1-9]\d*)$/.test(k)))bad();Object.defineProperty(out,k,{value:capture(d.value,active),enumerable:true,writable:true,configurable:true});}
  if(arr&&(out.length!==x.length||Object.keys(out).length!==x.length))bad();active.delete(x);return out;
}
function shape(x,keys){if(!x||typeof x!=='object'||Array.isArray(x)||Object.keys(x).sort().join('\0')!==[...keys].sort().join('\0'))bad();}
function exact(x){if(typeof x!=='string'||!x||x.trim()!==x||/[\u0000-\u001f\u007f-\u009f]/u.test(x))bad();}
function array(x){if(!Array.isArray(x))bad();}
function segments(p){if(typeof p!=='string'||(p!==''&&!p.startsWith('/')))bad();return p===''?[]:p.slice(1).split('/').map(k=>{if(/~(?![01])/u.test(k))bad();return k.replaceAll('~1','/').replaceAll('~0','~');});}
function at(value,parts){for(const k of parts){if(value===null||typeof value!=='object'||!own(value,k)||(Array.isArray(value)&&!/^(0|[1-9]\d*)$/.test(k)))bad();value=value[k];}return value;}
function bind(value,parts,replacement){if(!parts.length){if(value!==null)bad();return capture(replacement);}const parent=at(value,parts.slice(0,-1)),key=parts.at(-1);if(at(value,parts)!==null)bad();Object.defineProperty(parent,key,{value:capture(replacement),enumerable:true,writable:true,configurable:true});return value;}
const sqlEntries=new Set(["crm-paid-attribution/attribute_leads_sql","funnel-truth-and-cost-per-stage/stage_truth","funnel-truth-and-cost-per-stage/cost_per_stage","funnel-truth-and-cost-per-stage/refresh_partitions","multi-touch-models-sql/credit_ledger","multi-touch-models-sql/attribution_metrics","attribution-data-quality-tripwires/spend_conservation","attribution-data-quality-tripwires/funnel_additivity","attribution-data-quality-tripwires/unmapped_share","attribution-data-quality-tripwires/match_rate","attribution-data-quality-tripwires/primary_uniqueness","attribution-data-quality-tripwires/source_parity","attribution-data-quality-tripwires/no_pii_columns","attribution-data-quality-tripwires/empty_column_probe","attribution-data-quality-tripwires/deleted_ad_coverage","attribution-data-quality-tripwires/inspect_schema","attribution-data-quality-tripwires/inspect_column_population"]);
const sqlHostFiles=['scripts/render-audit-sql.mjs','references/sql-rendering-schemas.json','scripts/audit-bigquery-transport.mjs'];
const operations={
  ...Object.fromEntries([...sqlEntries].map(key=>[key,{executeSql:'executeSql'}])),
  'mmm-and-incrementality-framing/weekly_mlr':{fit_weekly_mlr:'fit_weekly_mlr'},
  'mmm-and-incrementality-framing/response_curves':{calibrate_and_scenario:'calibrate_and_scenario'},
  'mmm-and-incrementality-framing/framing':{compare_shares:'compare_shares',project_bands:'project_bands'},
  'channel-taxonomy/classify':{classify:'classify'},
  'first-party-pixel/identity_projection':{projectIdentity:'projectIdentity'},
  'clickstream-identity-stitching/dedupe_touches':{dedupeTouches:'dedupeTouches'},
  'clickstream-identity-stitching/identity_graph':{buildIdentityGraph:'buildIdentityGraph'},
  'clickstream-identity-stitching/webhook_resolution':{resolveWebhookStitch:'resolveWebhookStitch'},
  'crm-attribution-profiler/profile':{profileCrmAttribution:'profileCrmAttribution'},
  'crm-paid-attribution/attribute_leads':{attributeLeads:'attributeLeads'},
  'capi-match-keys/conversion_preparation':{conversionFromStage:'conversionFromStage',prepareConversion:'prepareConversion'},
  'capi-match-keys/provider_payloads':{google:'buildGooglePayload',linkedin:'buildLinkedInPayload',meta:'buildMetaPayload',tiktok:'buildTikTokPayload',reddit:'buildRedditPayload'},
};
// No shell, no ambient Python import path, and no bytecode writes into source snapshots.
function pythonProcess(executable,argv,stdin){
  return new Promise(resolveProcess=>{
    const result={executable,argv,stdin,stdin_sha256:sha(stdin),process_started:false,started_at:null,finished_at:null,stdout:'',stderr:'',exit_code:null,signal:null,error_code:null};
    const child=spawn(executable,argv,{shell:false,env:{PATH:process.env.PATH??'',PYTHONDONTWRITEBYTECODE:'1'},stdio:['pipe','pipe','pipe']});
    child.on('spawn',()=>{result.process_started=true;result.started_at=now();});
    child.stdout.on('data',b=>{result.stdout+=b.toString('utf8');});child.stderr.on('data',b=>{result.stderr+=b.toString('utf8');});
    child.on('error',e=>{result.error_code=e.code??'SPAWN_ERROR';});child.stdin.on('error',()=>{});
    child.on('close',(code,signal)=>{result.exit_code=code;result.signal=signal;result.finished_at=now();result.stdout_sha256=sha(result.stdout);result.stderr_sha256=sha(result.stderr);resolveProcess(result);});child.stdin.end(stdin);
  });
}
const pythonProbeCode="import sys,json,importlib.util; spec=importlib.util.find_spec('numpy'); import importlib; np=importlib.import_module('numpy') if spec else None; print(json.dumps({'executable':sys.executable,'python_version':sys.version.split()[0],'numpy_version':None if np is None else np.__version__}))";
export class AuditPreflightError extends Error {
  constructor(evidence){super('Audit preflight failed; no invalid native artifact was synthesized');this.name='AuditPreflightError';this.evidence=evidence;}
}
async function permissions(path,mode){for(const e of await readdir(path,{withFileTypes:true})){if(e.isDirectory())await permissions(join(path,e.name),mode);}await chmod(path,mode);}

export async function executeAudit(rawInput,rawOptions,dependencies={}){
  const input=capture(rawInput),options=capture(rawOptions);
  shape(input,['audit_key','boundary','inventory','bridges','evidence_records','steps','invocations']);shape(options,['skillRoots',...(own(options,'pythonExecutable')?['pythonExecutable']:[]),...(own(options,'bigquery')?['bigquery']:[])]);if(own(options,'pythonExecutable')){exact(options.pythonExecutable);if(!isAbsolute(options.pythonExecutable))bad();}
  shape(dependencies,own(dependencies,'bigqueryTransport')?['bigqueryTransport']:[]);if(own(dependencies,'bigqueryTransport')){shape(dependencies.bigqueryTransport,['runCommand','fetchImpl']);for(const key of ['runCommand','fetchImpl'])if(typeof dependencies.bigqueryTransport[key]!=='function')bad();}
  const injectedTransport=dependencies.bigqueryTransport?{runCommand:dependencies.bigqueryTransport.runCommand,fetchImpl:dependencies.bigqueryTransport.fetchImpl}:{};
  if(own(options,'bigquery')){const b=options.bigquery;shape(b,['configuration','reportDirectory','resumeReports']);shape(b.configuration,['billingProject','location','maximumBytesBilled']);const c=b.configuration;if(typeof c.billingProject!=='string'||!/^[a-z][a-z0-9-]{4,28}[a-z0-9]$/.test(c.billingProject)||typeof c.location!=='string'||!/^[A-Za-z][A-Za-z0-9-]{0,62}$/.test(c.location)||typeof c.maximumBytesBilled!=='string'||!/^[1-9][0-9]*$/.test(c.maximumBytesBilled)||BigInt(c.maximumBytesBilled)>9223372036854775807n)bad();exact(b.reportDirectory);if(!isAbsolute(b.reportDirectory)||!b.resumeReports||typeof b.resumeReports!=='object'||Array.isArray(b.resumeReports))bad();array(input.steps);for(const[key,path]of Object.entries(b.resumeReports)){exact(path);if(!isAbsolute(path)||!input.steps.some(s=>s.step_id===key&&sqlEntries.has(s.skill+'/'+s.entrypoint)))bad();}}

  for(const k of ['steps','invocations','evidence_records'])array(input[k]);
  const registry=JSON.parse(await readFile(new URL('../references/entrypoints.json',import.meta.url),'utf8'));
  const entries=new Map(registry.entries.map(e=>[e.skill+'/'+e.id,e])),stepMap=new Map(),invocations=new Map(),catalog=new Map(input.evidence_records.map(e=>[e.evidence_ref,e]));
  for(const s of input.steps){shape(s,['step_id','skill','entrypoint','required','depends_on','input_evidence_refs','artifact_ref']);exact(s.step_id);array(s.input_evidence_refs);s.input_evidence_refs.forEach(exact);if(stepMap.has(s.step_id)||!entries.has(s.skill+'/'+s.entrypoint))bad();stepMap.set(s.step_id,s);}
  for(const v of input.invocations){shape(v,['step_id','operation','input','bindings','declaration','observations','expected_source_hashes']);exact(v.step_id);exact(v.operation);if(invocations.has(v.step_id)||!stepMap.has(v.step_id))bad();const s=stepMap.get(v.step_id),entry=entries.get(s.skill+'/'+s.entrypoint),ops=operations[s.skill+'/'+s.entrypoint];if(ops?!own(ops,v.operation):v.operation!=='unavailable')bad();shape(v.expected_source_hashes,entry.source_refs.map(r=>r.skill+'/'+r.path));for(const h of Object.values(v.expected_source_hashes))if(typeof h!=='string'||!/^[a-f0-9]{64}$/.test(h))bad();array(v.bindings);array(v.observations);for(const o of v.observations){shape(o,['pointer']);segments(o.pointer);}const targets=[];for(const b of v.bindings){shape(b,['target_pointer','evidence_ref','source_pointer']);exact(b.evidence_ref);const parts=segments(b.target_pointer);segments(b.source_pointer);if(!s.input_evidence_refs.includes(b.evidence_ref)||at(v.input,parts)!==null)bad();if(targets.some(t=>t.every((x,i)=>parts[i]===x)||parts.every((x,i)=>t[i]===x)))bad();targets.push(parts);}invocations.set(v.step_id,v);}
  if(invocations.size!==stepMap.size)bad();
  const artifactOwners=new Map(input.steps.filter(s=>s.artifact_ref!==null).map(s=>[s.artifact_ref,s.step_id]));
  for(const s of input.steps)for(const ref of s.input_evidence_refs){if(!catalog.has(ref)&&!artifactOwners.has(ref))bad();if(artifactOwners.has(ref)&&!s.depends_on.includes(artifactOwners.get(ref)))bad();}
  for(const v of input.invocations)for(const b of v.bindings)if(catalog.has(b.evidence_ref))at(catalog.get(b.evidence_ref).value,segments(b.source_pointer));
  const provenance={run_id:randomUUID(),node_version:process.version,started_at:now(),finished_at:null,requested_input:input,requested_input_sha256:canonicalHash(input),source_snapshot:null,snapshot_source_hashes:{},source_snapshot_errors:{},calls:[],cleanup:{owned_snapshot_removed:false},limits:['no_provider_delivery_or_permanent_database_mutation','only_allowlisted_js_python_and_fixed_bigquery_adapters','historical_recorded_evidence_not_used_as_runtime_output']};
  const artifactMap=new Map();let snapshot=null,snapshotRoots={},composition=null,error=null,pythonProbe=null,sqlRuntime=null;
  provenance.host_helper_hashes={};provenance.bigquery_transport_mode=dependencies.bigqueryTransport?'MOCKED_NO_SQL_EXECUTED':'native';provenance.bigquery_evidence_directory=null;
  const recordFor=(s,v,status,reason_codes,nativeInput,output,transport,observations=[])=>({evidence_ref:s.artifact_ref,step_id:s.step_id,execution_status:status,reason_codes,source_hashes:v.expected_source_hashes,input:nativeInput,input_sha256:canonicalHash(nativeInput),output,output_sha256:output===null?null:canonicalHash(output),runtime_provenance:{kind:'recorded',runtime:transport.python_runtime?'Python '+transport.python_runtime.python_version:'Node '+process.version,run_id:provenance.run_id,recorded_at:now(),transport},declaration:v.declaration,observations});
  const compositionInput=(candidate=null)=>{
    const artifacts=input.steps.filter(s=>s.artifact_ref!==null).map(s=>artifactMap.get(s.step_id)??recordFor(s,invocations.get(s.step_id),'unavailable',['invocation_pending'],candidate?.step_id===s.step_id?candidate.input:{},null,{phase:'preflight',function_entered:false}));
    const byRef=new Map(artifacts.map(a=>[a.evidence_ref,a]));
    return {audit_key:input.audit_key,boundary:input.boundary,inventory:input.inventory,bridges:input.bridges,evidence_records:input.evidence_records,steps:input.steps.map(s=>({...s,input_evidence_refs:s.input_evidence_refs.map(ref=>({evidence_ref:ref,content_sha256:catalog.has(ref)?catalog.get(ref).sha256:byRef.get(ref)?.output_sha256??null}))})),artifacts};
  };
  const failure=(phase,s,nativeInput,nativeOutput=null)=>new AuditPreflightError({phase,step_id:s?.step_id??null,captured_input:input,unresolved_input:s?invocations.get(s.step_id).input:null,resolved_input:nativeInput,native_output:nativeOutput,run_provenance:provenance});
  try {
    // Truthful not-yet-invoked placeholders reuse the frozen scope/DAG/declaration validator.
    let initial;try{initial=await composeAudit(compositionInput(),{skillRoots:options.skillRoots});}catch{throw failure('request_preflight',null,null);}
    snapshot=await mkdtemp(join(tmpdir(),'attribution-audit-js-'));provenance.source_snapshot=snapshot;
    const wanted=new Map();for(const s of input.steps)for(const ref of entries.get(s.skill+'/'+s.entrypoint).source_refs)wanted.set(ref.skill+'/'+ref.path,ref);
    for(const [key,ref] of wanted){if(!own(options.skillRoots,ref.skill)){provenance.source_snapshot_errors[key]={status:'unavailable',reason:'installed_source_missing'};continue;}try{const installed=await realpath(options.skillRoots[ref.skill]),actual=await realpath(resolve(installed,ref.path));if(!actual.startsWith(installed+sep))throw Error('source_path_outside_root');const bytes=await readFile(actual),target=join(snapshot,ref.skill,ref.path);await mkdir(dirname(target),{recursive:true});await writeFile(target,bytes,{flag:'wx'});await chmod(target,0o444);snapshotRoots[ref.skill]=join(snapshot,ref.skill);provenance.snapshot_source_hashes[key]=sha(await readFile(target));}catch(e){provenance.source_snapshot_errors[key]=e.code==='ENOENT'?{status:'unavailable',reason:'installed_source_missing'}:{status:'failed',reason:'installed_source_unreadable'};}}
    if(options.bigquery&&input.steps.some(s=>sqlEntries.has(s.skill+'/'+s.entrypoint))){
      for(const path of sqlHostFiles){const bytes=await readFile(new URL('../'+path,import.meta.url)),target=join(snapshot,'audit-host',path);await mkdir(dirname(target),{recursive:true});await writeFile(target,bytes,{flag:'wx',mode:0o444});provenance.host_helper_hashes[path]=sha(await readFile(target));}
      await mkdir(options.bigquery.reportDirectory,{recursive:true});provenance.bigquery_evidence_directory=await mkdtemp(join(options.bigquery.reportDirectory,'audit-'+provenance.run_id+'-'));
      await writeFile(join(provenance.bigquery_evidence_directory,'run-request.json'),JSON.stringify({execution_mode:'fresh_invocation',transport_mode:provenance.bigquery_transport_mode,run_id:provenance.run_id,input,options,host_source_sha256:sha(await readFile(new URL(import.meta.url))),host_helper_hashes:provenance.host_helper_hashes,snapshot_source_hashes:provenance.snapshot_source_hashes},null,2)+'\n',{flag:'wx',mode:0o600});
    }
    await permissions(snapshot,0o555);
    for(const declaredStep of initial.steps){const s=stepMap.get(declaredStep.step_id),v=invocations.get(s.step_id),entry=entries.get(s.skill+'/'+s.entrypoint),ops=operations[s.skill+'/'+s.entrypoint];
      const python=s.skill==='mmm-and-incrementality-framing'&&Boolean(ops),sql=sqlEntries.has(s.skill+'/'+s.entrypoint);
      const call={adapter_kind:sql?'bigquery':python?'python_cli':'javascript',process_started:false,invocation_started:false,step_id:s.step_id,skill:s.skill,entrypoint:s.entrypoint,operation:v.operation,function_name:ops?.[v.operation]??null,function_entered:python||sql?null:false,started_at:null,finished_at:null,execution_status:'unavailable',reason_codes:[],source_hashes:v.expected_source_hashes,actual_snapshot_source_hashes:Object.fromEntries(entry.source_refs.map(r=>[r.skill+'/'+r.path,provenance.snapshot_source_hashes[r.skill+'/'+r.path]??null])),resolved_input:null,input_sha256:null,output:null,output_sha256:null,bindings:[]};provenance.calls.push(call);
      if(s.artifact_ref===null){call.reason_codes=['artifact_ref_missing'];continue;}
      let nativeInput=capture(v.input);
      // Only successful actual producer output can bind a dependent input.
      const failed=s.depends_on.map(d=>artifactMap.get(d)).filter(a=>!a||a.execution_status!=='succeeded');
      if(failed.length){call.execution_status=failed.some(a=>a?.execution_status==='failed')?'failed':'unavailable';call.reason_codes=[call.execution_status==='failed'?'dependency_failed':'dependency_unavailable'];}
      else {
        try{for(const b of v.bindings){const record=catalog.get(b.evidence_ref),producer=record?null:artifactMap.get(artifactOwners.get(b.evidence_ref));if(!record&&(!producer||producer.execution_status!=='succeeded'))bad();const value=at(record?record.value:producer.output,segments(b.source_pointer));nativeInput=bind(nativeInput,segments(b.target_pointer),value);call.bindings.push({...b,content_sha256:record?record.sha256:producer.output_sha256,copied_value_sha256:canonicalHash(value)});}}catch{throw failure('binding_resolution',s,nativeInput);}
        if(s.entrypoint==='provider_payloads'&&nativeInput?.preparation_input?.policy&&nativeInput.preparation_input.policy.as_of!==input.boundary.as_of)throw failure('resolved_input_preflight',s,nativeInput);
        let preflight;try{preflight=await composeAudit(compositionInput({step_id:s.step_id,input:nativeInput}),{skillRoots:snapshotRoots});}catch{throw failure('resolved_input_preflight',s,nativeInput);}
        const current=preflight.steps.find(r=>r.step_id===s.step_id),sourceProblems=entry.source_refs.map(r=>provenance.source_snapshot_errors[r.skill+'/'+r.path]).filter(Boolean);
        const blocking=[...new Set([...current.reason_codes.filter(r=>r!=='recorded_unavailable'&&!(sourceProblems.length&&['installed_source_missing','installed_source_unreadable'].includes(r))),...sourceProblems.map(p=>p.reason)])];
        if(blocking.length){call.execution_status=sourceProblems.some(p=>p.status==='failed')?'failed':current.execution_status;call.reason_codes=[...blocking,...(!ops?['adapter_not_implemented']:[])].sort();}
        else if(!ops){call.execution_status='unavailable';call.reason_codes=['adapter_not_implemented'];}
        else if(sql){
          call.resolved_input=capture(nativeInput);call.input_sha256=canonicalHash(call.resolved_input);call.submission_attempted=false;call.server_job_observed=false;call.read_only_retrieval=false;call.confirmed_fresh_queries=0;call.effect_accounting_complete=true;
          if(!options.bigquery){call.execution_status='unavailable';call.reason_codes=['bigquery_not_configured'];}
          else {
            if(s.entrypoint==='inspect_column_population'){
              if(nativeInput.report_timezone!==input.boundary.timezone)throw failure('resolved_input_preflight',s,nativeInput);
              if(nativeInput.population_mode==='report_window'){if(nativeInput.start_date!==input.boundary.start||nativeInput.end_date!==input.boundary.end)throw failure('resolved_input_preflight',s,nativeInput);call.population_evidence_scope='declared_report_window';}
              else if(nativeInput.population_mode==='full_table_snapshot'){if(nativeInput.start_date!==null||nativeInput.end_date!==null||nativeInput.date_column!==null)throw failure('resolved_input_preflight',s,nativeInput);call.population_evidence_scope='full_table_snapshot_not_report_window';}
              else throw failure('resolved_input_preflight',s,nativeInput);
            }
            if(s.entrypoint==='inspect_schema')call.population_evidence_scope='schema_metadata_not_population_evidence';
            let rendered;try{sqlRuntime??={renderer:await import(pathToFileURL(join(snapshot,'audit-host/scripts/render-audit-sql.mjs')).href),transport:await import(pathToFileURL(join(snapshot,'audit-host/scripts/audit-bigquery-transport.mjs')).href)};rendered=sqlRuntime.renderer.renderAuditSql(s.skill+'/'+s.entrypoint,await readFile(join(snapshotRoots[s.skill],entry.path),'utf8'),call.resolved_input);}catch{throw failure('sql_rendering_preflight',s,nativeInput);}
            call.rendered_sql=capture(rendered);call.query_sha256=sha(rendered.query);const ordinal=String(provenance.calls.length).padStart(4,'0'),reportPath=join(provenance.bigquery_evidence_directory,'step-'+ordinal+'-transport.json'),requestPath=join(provenance.bigquery_evidence_directory,'step-'+ordinal+'-request.json');
            const transportInput={configuration:options.bigquery.configuration,query:rendered.query,queryParameters:rendered.queryParameters,parameterMode:rendered.parameterMode,resultKind:rendered.resultKind};
            const sharedRef='ga4-bigquery-export/scripts/run-export-checks.mjs';const transportOptions={sharedModulePath:join(snapshotRoots['ga4-bigquery-export'],'scripts/run-export-checks.mjs'),expectedSharedSourceSha256:v.expected_source_hashes[sharedRef],reportPath,...(own(options.bigquery.resumeReports,s.step_id)?{resumeReportPath:options.bigquery.resumeReports[s.step_id]}:{})};
            call.bigquery_report_path=reportPath;call.bigquery_request_path=requestPath;call.started_at=now();
            await writeFile(requestPath,JSON.stringify({run_id:provenance.run_id,transport_mode:provenance.bigquery_transport_mode,step_id:s.step_id,resolved_input:call.resolved_input,input_sha256:call.input_sha256,rendered_sql:rendered,transport_input:transportInput,transport_options:transportOptions,source_hashes:call.actual_snapshot_source_hashes,host_helper_hashes:provenance.host_helper_hashes,prior_calls:provenance.calls.slice(0,-1),run_provenance:provenance},null,2)+'\n',{flag:'wx',mode:0o600});
            try{const result=await sqlRuntime.transport.runAuditBigQuery(transportInput,transportOptions,injectedTransport);call.bigquery_transport=result.report;call.bigquery_report_sha256=sha(await readFile(reportPath));for(const key of ['submission_attempted','server_job_observed','read_only_retrieval','confirmed_fresh_queries'])call[key]=result.report[key];call.invocation_started=result.report.submission_attempted||result.report.read_only_retrieval;call.effect_accounting_complete=!(result.report.submission_attempted&&!result.report.server_job_observed);
              if(result.report.state==='completed'){call.output=capture(result.report.output);call.output_sha256=canonicalHash(call.output);call.execution_status='succeeded';call.reason_codes=[];}
              else if(result.report.versions&&['bq','gcloud'].some(key=>result.report.versions[key]?.code!==0)){call.execution_status='unavailable';call.reason_codes=['bigquery_runtime_unavailable'];}
              else {call.execution_status='failed';call.reason_codes=[result.report.job.state==='query_failed'?'bigquery_query_failed':'bigquery_execution_or_retrieval_failed'];}
            }catch(e){
              call.execution_status='failed';call.reason_codes=['bigquery_transport_failed'];call.native_error={name:typeof e?.name==='string'?e.name:'Error',message_sha256:sha(String(e?.message??''))};
              call.submission_attempted=null;call.server_job_observed=null;call.read_only_retrieval=own(transportOptions,'resumeReportPath');call.confirmed_fresh_queries=null;call.effect_accounting_complete=false;call.effect_accounting_status='unknown_after_transport_throw';
              try{const bytes=await readFile(reportPath),retained=capture(JSON.parse(bytes));if(canonicalHash(retained.input)!==canonicalHash(transportInput)||retained.shared_source_sha256!==transportOptions.expectedSharedSourceSha256||retained.transport_source_sha256!==provenance.host_helper_hashes['scripts/audit-bigquery-transport.mjs']||retained.job.query!==rendered.query||retained.job.querySha256!==sha(rendered.query)||!/^[A-Za-z0-9_-]+$/.test(retained.job.jobId))bad();
                const submitted=retained.http.filter(r=>r.method==='POST');if(submitted.some(r=>r.request_body?.jobReference?.jobId!==retained.job.jobId||r.request_body?.jobReference?.projectId!==options.bigquery.configuration.billingProject))bad();
                if(transportOptions.resumeReportPath){const prior=JSON.parse(await readFile(transportOptions.resumeReportPath));if(prior.job?.jobId!==retained.job.jobId)bad();}
                for(const key of ['submission_attempted','server_job_observed','read_only_retrieval'])if(typeof retained[key]!=='boolean')bad();if(![0,1].includes(retained.confirmed_fresh_queries))bad();
                call.bigquery_transport=retained;call.bigquery_report_sha256=sha(bytes);for(const key of ['submission_attempted','server_job_observed','read_only_retrieval','confirmed_fresh_queries'])call[key]=retained[key];call.invocation_started=retained.submission_attempted||retained.read_only_retrieval;call.effect_accounting_status='verified_retained_report_after_throw';call.effect_accounting_complete=retained.server_job_observed;
              }catch{call.retained_report_recovery='unavailable_or_identity_mismatch';}
            }
            call.finished_at=now();
          }
        }
        else if(python){
          call.resolved_input=capture(nativeInput);call.input_sha256=canonicalHash(call.resolved_input);
          if(!own(options,'pythonExecutable')){call.execution_status='unavailable';call.reason_codes=['python_interpreter_not_configured'];}
          else {
            if(pythonProbe===null){const transport=await pythonProcess(options.pythonExecutable,['-I','-B','-c',pythonProbeCode],'');let runtime=null;try{if(transport.exit_code===0)runtime=capture(JSON.parse(transport.stdout));}catch{}pythonProbe={transport,runtime};provenance.python_probe=pythonProbe;}
            if(!pythonProbe.transport.process_started){call.execution_status=pythonProbe.transport.error_code==='ENOENT'?'unavailable':'failed';call.reason_codes=[call.execution_status==='unavailable'?'python_interpreter_missing':'python_interpreter_unreadable'];}
            else if(!pythonProbe.runtime){call.execution_status='failed';call.reason_codes=['python_runtime_probe_failed'];}
            else if(s.entrypoint==='weekly_mlr'&&pythonProbe.runtime.numpy_version===null){call.execution_status='unavailable';call.reason_codes=['python_numpy_unavailable'];}
            else {
              const cliInput=s.entrypoint==='framing'?{operation:v.operation,input:capture(call.resolved_input)}:capture(call.resolved_input);
              const transport=await pythonProcess(options.pythonExecutable,['-I','-B',join(snapshotRoots[s.skill],entry.path)],JSON.stringify(cliInput));
              call.python_runtime=pythonProbe.runtime;call.python_transport=transport;call.process_started=transport.process_started;call.invocation_started=transport.process_started;call.started_at=transport.started_at;call.finished_at=transport.finished_at;
              if(!transport.process_started){call.execution_status=transport.error_code==='ENOENT'?'unavailable':'failed';call.reason_codes=[call.execution_status==='unavailable'?'python_interpreter_missing':'python_process_start_failed'];}
              else if(transport.exit_code!==0||transport.signal!==null){call.execution_status='failed';call.reason_codes=['native_invocation_failed'];}
              else {try{call.output=capture(JSON.parse(transport.stdout));call.output_sha256=canonicalHash(call.output);}catch{throw failure('native_output_capture',s,nativeInput,transport.stdout);}call.execution_status='succeeded';call.reason_codes=[];}
            }
          }
        }
        else {
          let module;try{module=await import(pathToFileURL(join(snapshotRoots[s.skill],entry.path)).href);if(typeof module[ops[v.operation]]!=='function')throw Error();}catch{call.execution_status='failed';call.reason_codes=['adapter_import_failed'];}
          if(module&&typeof module[ops[v.operation]]==='function'){
            if(v.operation==='dedupeTouches')shape(nativeInput,['touches','options']);if(v.operation==='attributeLeads')shape(nativeInput,['leads','options']);
            call.resolved_input=capture(nativeInput);call.input_sha256=canonicalHash(call.resolved_input);
            const invocationInput=capture(call.resolved_input);
            call.started_at=now();call.function_entered=true;call.invocation_started=true;
            let output;try{if(v.operation==='dedupeTouches')output=await module.dedupeTouches(invocationInput.touches,invocationInput.options);else if(v.operation==='attributeLeads')output=await module.attributeLeads(invocationInput.leads,invocationInput.options);else if(v.operation==='projectIdentity')output=await module.projectIdentity(invocationInput,{identitySkillRoot:snapshotRoots['clickstream-identity-stitching']});else output=await module[ops[v.operation]](invocationInput);call.execution_status='succeeded';call.reason_codes=[];}catch(e){call.execution_status='failed';call.reason_codes=['native_invocation_failed'];call.native_error={name:typeof e?.name==='string'?e.name:'Error',message_sha256:sha(String(e?.message??''))};}
            call.finished_at=now();
            if(call.execution_status==='succeeded'){try{call.output=capture(output);call.output_sha256=canonicalHash(call.output);}catch{throw failure('native_output_capture',s,nativeInput,output);}}
          }
        }
      }
      if(call.input_sha256===null){call.resolved_input=capture(nativeInput);call.input_sha256=canonicalHash(call.resolved_input);}
      // A blocked template may still contain null placeholders; retain its real unresolved
      // input in run provenance while the unavailable artifact honestly has no invocation input.
      const artifactInput=failed.length?{}:nativeInput;
      const artifact=recordFor(s,v,call.execution_status,call.reason_codes,artifactInput,call.output,{phase:'actual_invocation',operation:v.operation,function_entered:call.function_entered,started_at:call.started_at,finished_at:call.finished_at,node_version:process.version,adapter_kind:call.adapter_kind,process_started:call.process_started,invocation_started:call.invocation_started,...(call.python_transport?{python_transport:call.python_transport,python_runtime:call.python_runtime}:{}),...(call.adapter_kind==='bigquery'?{bigquery_report_path:call.bigquery_report_path??null,bigquery_report_sha256:call.bigquery_report_sha256??null,bigquery_transport:call.bigquery_transport??null,submission_attempted:call.submission_attempted===undefined?false:call.submission_attempted,server_job_observed:call.server_job_observed===undefined?false:call.server_job_observed,read_only_retrieval:call.read_only_retrieval??false,confirmed_fresh_queries:call.confirmed_fresh_queries===undefined?0:call.confirmed_fresh_queries,effect_accounting_complete:call.effect_accounting_complete??true,effect_accounting_status:call.effect_accounting_status??null,transport_mode:provenance.bigquery_transport_mode,population_evidence_scope:call.population_evidence_scope??null}:{}),bindings:call.bindings,...(call.native_error?{native_error:call.native_error}:{})},call.execution_status==='succeeded'?v.observations:[]);artifactMap.set(s.step_id,artifact);
      try{await composeAudit(compositionInput(),{skillRoots:snapshotRoots});}catch{throw failure('native_output_preflight',s,nativeInput,call.output);}
    }
    composition=await composeAudit(compositionInput(),{skillRoots:snapshotRoots});
  }catch(e){error=e;}finally{
    if(snapshot){await permissions(snapshot,0o700);await rm(snapshot,{recursive:true,force:true});try{await stat(snapshot);}catch(e){if(e.code==='ENOENT')provenance.cleanup.owned_snapshot_removed=true;}}
    provenance.finished_at=now();
  }
  if(error){if(error instanceof AuditPreflightError)throw error;throw new AuditPreflightError({phase:'host_validation',captured_input:input,run_provenance:provenance});}
  return {execution_mode:'fresh_invocation',fresh_upstream_calls:provenance.calls.reduce((n,c)=>n+(c.adapter_kind==='bigquery'?(c.confirmed_fresh_queries??0):Number(c.invocation_started)),0),confirmed_fresh_bigquery_queries:provenance.calls.reduce((n,c)=>n+(c.confirmed_fresh_queries??0),0),bigquery_effect_accounting_complete:!provenance.calls.some(c=>c.effect_accounting_complete===false),run_provenance:provenance,composition};
}
