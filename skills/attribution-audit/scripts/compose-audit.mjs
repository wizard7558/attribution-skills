import { readFile, realpath } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { types } from 'node:util';
import { resolve, sep, isAbsolute } from 'node:path';

const invalid = () => { throw new TypeError('Invalid audit composition input'); };
const own = (o, k) => Object.hasOwn(o, k);
// Capture descriptors before any await. Never invoke input accessors or freeze callers.
function capture(value, active = new Set()) {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number') { if (!Number.isFinite(value)) invalid(); return value; }
  if (typeof value !== 'object' || types.isProxy(value) || active.has(value)) invalid();
  const array = Array.isArray(value), proto = Object.getPrototypeOf(value);
  if (!array && proto !== Object.prototype && proto !== null) invalid();
  active.add(value);
  const descriptors = Object.getOwnPropertyDescriptors(value), keys = Reflect.ownKeys(descriptors);
  if (keys.some(k => typeof k !== 'string')) invalid();
  const out = array ? [] : {};
  for (const key of keys) {
    if (array && key === 'length') continue;
    const d = descriptors[key];
    if (!own(d, 'value') || !d.enumerable || (array && !/^(0|[1-9]\d*)$/.test(key))) invalid();
    Object.defineProperty(out, key, { value: capture(d.value, active), enumerable: true, writable: true, configurable: true });
  }
  if (array && (out.length !== value.length || Object.keys(out).length !== out.length)) invalid();
  active.delete(value); return out;
}
const canonical = value => value === null || typeof value !== 'object' ? JSON.stringify(value) : Array.isArray(value) ? '[' + value.map(canonical).join(',') + ']' : '{' + Object.keys(value).sort().map(k => JSON.stringify(k)+':'+canonical(value[k])).join(',') + '}';
const sha = value => createHash('sha256').update(value).digest('hex');
export const canonicalHash = value => sha(canonical(capture(value)));
function shape(o, keys) { if (!o || Array.isArray(o) || typeof o !== 'object' || Object.keys(o).sort().join('\0') !== [...keys].sort().join('\0')) invalid(); }
function exact(s) { if (typeof s !== 'string' || !s || s.trim() !== s || /[\u0000-\u001f\u007f-\u009f]/u.test(s)) invalid(); }
function hash(s) { if (typeof s !== 'string' || !/^[a-f0-9]{64}$/.test(s)) invalid(); }
function bool(v) { if (typeof v !== 'boolean') invalid(); }
function array(v) { if (!Array.isArray(v)) invalid(); }
function unique(values) { if (new Set(values).size !== values.length) invalid(); }
const scopeKey = o => JSON.stringify([o.source_system,o.source_scope]);
function scope(o) { shape(o,['source_system','source_scope']); exact(o.source_system);exact(o.source_scope); }
function date(s) { if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s) || s.slice(0,4)==='0000') invalid(); const d=new Date(s+'T00:00:00Z'); if(!Number.isFinite(+d)||d.toISOString().slice(0,10)!==s) invalid(); }
function timestamp(s) { if(typeof s!=='string'||!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(Z|[+-]\d{2}:\d{2})$/.test(s))invalid();date(s.slice(0,10));if(+s.slice(11,13)>23||+s.slice(14,16)>59||+s.slice(17,19)>59)invalid();const m=s.match(/([+-])(\d{2}):(\d{2})$/);if(m&&(+m[2]>14||+m[3]>59||(+m[2]===14&&+m[3]!==0)))invalid();if(!Number.isFinite(Date.parse(s)))invalid(); }
function timezone(s) { exact(s);if(!/^[A-Za-z][A-Za-z0-9_+./-]*$/.test(s))invalid();try{new Intl.DateTimeFormat('en',{timeZone:s}).format(new Date('2000-01-01T00:00:00Z'));}catch{invalid();} }
function boundary(b) { shape(b,['report_scope','timezone','start','end','date_mode','as_of','outcome_name','outcome_kind','spend_currency','outcome_currency','currency_status']);exact(b.report_scope);timezone(b.timezone);date(b.start);date(b.end);if(b.start>b.end)invalid();timestamp(b.as_of);if(!['cohort','activity'].includes(b.date_mode)||!['count','revenue'].includes(b.outcome_kind)||!['known','mixed_currency','unknown'].includes(b.currency_status))invalid();exact(b.outcome_name);for(const k of ['spend_currency','outcome_currency'])if(b[k]!==null&&(typeof b[k]!=='string'||!/^[A-Z]{3}$/.test(b[k])))invalid();if(b.outcome_kind==='count'&&b.outcome_currency!==null)invalid();if(b.currency_status==='known'&&(b.spend_currency===null||(b.outcome_kind==='revenue'&&b.outcome_currency===null)))invalid();if(b.currency_status==='mixed_currency'&&(b.spend_currency!==null||b.outcome_currency!==null))invalid(); }
function pointer(o,p) { if(typeof p!=='string'||(p!==''&&!p.startsWith('/')))invalid();let value=o;for(const raw of p===''?[]:p.slice(1).split('/')){if(/~(?![01])/u.test(raw))invalid();const k=raw.replaceAll('~1','/').replaceAll('~0','~');if(value===null||typeof value!=='object'||!own(value,k)||(Array.isArray(value)&&! /^(0|[1-9]\d*)$/.test(k)))invalid();value=value[k];}return value; }
function validateOrigins(value, scopes) {
  if(value===null||typeof value!=='object')return;
  if(!Array.isArray(value))for(const prefix of ['', 'crm_', 'ad_', 'reference_', 'subject_', 'contact_', 'visitor_', 'lead_', 'touch_', 'conversion_', 'click_']){
    const system=prefix+'source_system',scopeField=prefix+'source_scope';
    if(own(value,system)||own(value,scopeField)){
      if(!own(value,system)||!own(value,scopeField))invalid();
      if(value[system]!==null||value[scopeField]!==null){exact(value[system]);exact(value[scopeField]);if(!scopes.has(JSON.stringify([value[system],value[scopeField]])))invalid();}
    }
  }
  for(const child of Object.values(value))validateOrigins(child,scopes);
}
function knownBindings(value, allowed) {
  if(value===null||typeof value!=='object')return;
  const check=(row,kind,a,b)=>{for(const k of [...a,...b])exact(row[k]);if(!allowed.some(x=>x.kind===kind&&x.from_source_system===row[a[0]]&&x.from_source_scope===row[a[1]]&&x.to_source_system===row[b[0]]&&x.to_source_scope===row[b[1]]))invalid();};
  for(const [key,child] of Object.entries(value)){
    if(['identity_scope_bindings','ad_scope_bindings','binding_input','click_scope_bindings'].includes(key)){
      array(child);for(const row of child){
        if(key==='identity_scope_bindings')check(row,'identity',['source_system','source_scope'],['contact_source_system','contact_source_scope']);
        else if(key==='click_scope_bindings')check(row,'ad_scope',['conversion_source_system','conversion_source_scope'],['click_source_system','click_source_scope']);
        else check(row,'ad_scope',['crm_source_system','crm_source_scope'],['ad_source_system','ad_source_scope']);
      }
    }
    if(key==='membership' || key==='membership_input')if(Array.isArray(child))for(const row of child)if(row&&own(row,'ad_source_system')&&own(row,'reference_source_system'))check(row,'comparability',['ad_source_system','ad_source_scope'],['reference_source_system','reference_source_scope']);
    knownBindings(child,allowed);
  }
}
function boundaryEvidence(a, entry, declared) {
  const checked=[];
  const at=(location)=>{let value=a;for(const key of location.split('.')){if(value===null||typeof value!=='object'||!own(value,key))return null;value=value[key];}return value;};
  const verify=(location,mapping)=>{const c=at(location);if(c===null||typeof c!=='object'||Array.isArray(c))return;for(const [field,boundaryField] of Object.entries(mapping))if(own(c,field)){if(c[field]!==declared[boundaryField])invalid();checked.push({location,native_field:field,boundary_field:boundaryField,value:c[field]});}};
  const sql={report_scope:'report_scope',report_timezone:'timezone',report_start:'start',report_end:'end',report_start_date:'start',report_end_date:'end',date_mode:'date_mode',as_of:'as_of'};
  if(['funnel-truth-and-cost-per-stage','multi-touch-models-sql','attribution-data-quality-tripwires'].includes(entry.skill)){verify('input.configuration',sql);verify('output.configuration',sql);if(entry.id==='cost_per_stage'&&Array.isArray(a.output?.report))a.output.report.forEach((r,i)=>verify('output.report.'+i,{report_timezone:'timezone',date_mode:'date_mode'}));}
  if(entry.skill==='mmm-and-incrementality-framing'){const map={report_scope:'report_scope',timezone:'timezone',start_week:'start',end_week:'end',as_of:'as_of',outcome_name:'outcome_name',outcome_kind:'outcome_kind',spend_currency:'spend_currency',outcome_currency:'outcome_currency'};for(const path of ['input.config','input.regression_result.config','input.curves_result.config','input.scenario_result.config','output.config','output.curves.config','output.scenario.config'])verify(path,map);}
  if(entry.skill==='crm-attribution-profiler')for(const path of ['input.window','input.recentWindow','output.window'])verify(path,{timezone:'timezone'});
  if(entry.skill==='clickstream-identity-stitching')verify('input',{as_of:'as_of'});
  if(entry.skill==='first-party-pixel')verify('input.config',{as_of:'as_of'});
  if(entry.skill==='capi-match-keys')verify('input.policy',{as_of:'as_of'});
  return {status:checked.length?'verified_present_fields':'not_present',fields:checked,limit:'only_present_contract_configuration_fields_checked'};
}
function validate(input, roots, registry) {
  shape(input,['audit_key','boundary','inventory','bridges','evidence_records','steps','artifacts']);exact(input.audit_key);boundary(input.boundary);
  for(const k of ['inventory','bridges','evidence_records','steps','artifacts'])array(input[k]);
  if(!input.inventory.length)invalid();
  const skills=[...new Set(registry.entries.map(e=>e.skill))];
  if(!roots||Array.isArray(roots)||typeof roots!=='object')invalid();for(const [k,v] of Object.entries(roots)){if(!skills.includes(k))invalid();exact(v);if(!isAbsolute(v))invalid();}
  const records=new Map(),artifacts=new Map(),steps=new Map(),scopes=new Set(),bridges=new Map();
  const reserved='audit_declaration:'+input.audit_key;
  for(const e of input.evidence_records){shape(e,['evidence_ref','kind','value','sha256']);exact(e.evidence_ref);if(!['attestation','source_input'].includes(e.kind))invalid();hash(e.sha256);if(e.evidence_ref===reserved||records.has(e.evidence_ref))invalid();records.set(e.evidence_ref,e);}
  for(const x of input.inventory){shape(x,['source_system','source_scope','coverage_status','evidence_ref']);exact(x.source_system);exact(x.source_scope);if(!['complete','partial','unavailable'].includes(x.coverage_status)||!records.has(x.evidence_ref)||scopes.has(scopeKey(x)))invalid();scopes.add(scopeKey(x));}
  for(const b of input.bridges){shape(b,['bridge_key','kind','from_source_system','from_source_scope','to_source_system','to_source_scope','evidence_ref']);exact(b.bridge_key);for(const k of ['from_source_system','from_source_scope','to_source_system','to_source_scope'])exact(b[k]);if(!['identity','ad_scope','comparability'].includes(b.kind)||!records.has(b.evidence_ref)||bridges.has(b.bridge_key)||!scopes.has(JSON.stringify([b.from_source_system,b.from_source_scope]))||!scopes.has(JSON.stringify([b.to_source_system,b.to_source_scope])))invalid();bridges.set(b.bridge_key,b);}
  for(const s of input.steps){shape(s,['step_id','skill','entrypoint','required','depends_on','input_evidence_refs','artifact_ref']);exact(s.step_id);exact(s.skill);exact(s.entrypoint);bool(s.required);array(s.depends_on);s.depends_on.forEach(exact);unique(s.depends_on);array(s.input_evidence_refs);if(s.artifact_ref!==null)exact(s.artifact_ref);if(steps.has(s.step_id)||!registry.entries.some(e=>e.skill===s.skill&&e.id===s.entrypoint))invalid();steps.set(s.step_id,s);}
  for(const a of input.artifacts){shape(a,['evidence_ref','step_id','execution_status','reason_codes','source_hashes','input','input_sha256','output','output_sha256','runtime_provenance','declaration','observations']);exact(a.evidence_ref);exact(a.step_id);if(a.evidence_ref===reserved||records.has(a.evidence_ref)||artifacts.has(a.evidence_ref)||!steps.has(a.step_id)||steps.get(a.step_id).artifact_ref!==a.evidence_ref)invalid();if(!['succeeded','failed','unavailable'].includes(a.execution_status))invalid();array(a.reason_codes);a.reason_codes.forEach(x=>{if(typeof x!=='string'||! /^[a-z][a-z0-9_]*$/.test(x))invalid();});unique(a.reason_codes);if(a.execution_status==='succeeded'?(a.output===null||a.reason_codes.length>0):(a.output!==null||a.output_sha256!==null||a.reason_codes.length===0))invalid();hash(a.input_sha256);if(a.output_sha256!==null)hash(a.output_sha256);if(a.execution_status==='succeeded'&&a.output_sha256===null)invalid();const entry=registry.entries.find(e=>e.skill===steps.get(a.step_id).skill&&e.id===steps.get(a.step_id).entrypoint);shape(a.source_hashes,entry.source_refs.map(r=>r.skill+'/'+r.path));Object.values(a.source_hashes).forEach(hash);
    shape(a.runtime_provenance,['kind','runtime','run_id','recorded_at','transport']);if(!['fixture','recorded'].includes(a.runtime_provenance.kind))invalid();exact(a.runtime_provenance.runtime);exact(a.runtime_provenance.run_id);timestamp(a.runtime_provenance.recorded_at);
    shape(a.declaration,['boundary','sources','bridge_keys']);boundary(a.declaration.boundary);if(canonical(a.declaration.boundary)!==canonical(input.boundary))invalid();array(a.declaration.sources);a.declaration.sources.forEach(x=>{scope(x);if(!scopes.has(scopeKey(x)))invalid();});unique(a.declaration.sources.map(scopeKey));array(a.declaration.bridge_keys);unique(a.declaration.bridge_keys);for(const k of a.declaration.bridge_keys){if(!bridges.has(k))invalid();const b=bridges.get(k),declared=new Set(a.declaration.sources.map(scopeKey));if(!declared.has(JSON.stringify([b.from_source_system,b.from_source_scope]))||!declared.has(JSON.stringify([b.to_source_system,b.to_source_scope])))invalid();}
    const declaredOrigins=new Set(a.declaration.sources.map(scopeKey));validateOrigins(a.input,declaredOrigins);validateOrigins(a.output,declaredOrigins);
    knownBindings(a.input,a.declaration.bridge_keys.map(k=>bridges.get(k)));boundaryEvidence(a,entry,input.boundary);
    array(a.observations);for(const o of a.observations){shape(o,['pointer']);if(a.output===null)invalid();pointer(a.output,o.pointer);}unique(a.observations.map(o=>o.pointer));
    if(entry.quality_check_id&&a.execution_status==='succeeded'){shape(a.output,['check_id','contract_version','configuration','status','reasons','evidence_refs','details','diagnostics']);if(a.output.check_id!==entry.quality_check_id||a.output.contract_version!=='0.1.0'||!['pass','fail','unknown'].includes(a.output.status))invalid();for(const k of ['reasons','evidence_refs','details'])array(a.output[k]);if(!a.output.diagnostics||typeof a.output.diagnostics!=='object'||Array.isArray(a.output.diagnostics)||a.output.details.some(d=>!d||typeof d!=='object'||Array.isArray(d)))invalid();a.output.reasons.forEach(exact);a.output.evidence_refs.forEach(exact);const c=a.output.configuration;for(const [k,v] of Object.entries({report_scope:input.boundary.report_scope,report_timezone:input.boundary.timezone,report_start:input.boundary.start,report_end:input.boundary.end,date_mode:input.boundary.date_mode}))if(c?.[k]!==v)invalid();}
    artifacts.set(a.evidence_ref,a);
  }
  for(const s of input.steps){for(const d of s.depends_on)if(!steps.has(d)||d===s.step_id)invalid();if(s.artifact_ref!==null&&!artifacts.has(s.artifact_ref))invalid();const refs=[];for(const r of s.input_evidence_refs){shape(r,['evidence_ref','content_sha256']);exact(r.evidence_ref);if(r.content_sha256!==null)hash(r.content_sha256);if(!records.has(r.evidence_ref)&&!artifacts.has(r.evidence_ref))invalid();if(artifacts.has(r.evidence_ref)&&!s.depends_on.includes(artifacts.get(r.evidence_ref).step_id))invalid();refs.push(r.evidence_ref);}unique(refs);}
  const ordered=[],pending=[...input.steps];while(pending.length){const i=pending.findIndex(s=>s.depends_on.every(d=>ordered.some(o=>o.step_id===d)));if(i<0)invalid();ordered.push(pending.splice(i,1)[0]);}
  return {records,artifacts,steps,ordered,skills,bridges};
}

export async function composeAudit(rawInput, options) {
  const input=capture(rawInput),capturedOptions=capture(options);shape(capturedOptions,['skillRoots']);
  const roots=capturedOptions.skillRoots;
  const registry=JSON.parse(await readFile(new URL('../references/entrypoints.json',import.meta.url),'utf8'));
  const declarationRef='audit_declaration:'+input.audit_key;
  const state=validate(input,roots,registry),recordIntegrity=new Map(),findings=[],stepResults=[],outputs={};
  const finding=(code,status,evidence_ref,json_pointer,qualified_source=null)=>findings.push({code,severity:status==='fail'?'error':status==='unknown'?'warning':'info',status,qualified_source,evidence_ref,json_pointer});
  for(const e of input.evidence_records){const valid=sha(canonical(e.value))===e.sha256;recordIntegrity.set(e.evidence_ref,valid);if(!valid)finding('evidence_hash_mismatch','fail',e.evidence_ref,'/sha256');}
  const sourceCache=new Map();
  for(const s of state.ordered){const entry=registry.entries.find(e=>e.skill===s.skill&&e.id===s.entrypoint),a=s.artifact_ref===null?null:state.artifacts.get(s.artifact_ref);let status='succeeded';const reasons=[],verified={};
    const issue=(reason,level='failed')=>{reasons.push(reason);if(level==='failed'||status!=='failed')status=level;};
    if(!a)issue('artifact_missing','unavailable');
    for(const ref of entry.source_refs){const path=ref.path,key=ref.skill+'/'+path;if(!own(roots,ref.skill)){issue('installed_source_missing','unavailable');continue;}if(!sourceCache.has(key)){try{const root=await realpath(roots[ref.skill]),target=await realpath(resolve(root,path));if(!target.startsWith(root+sep))throw new Error('source_path_outside_root');sourceCache.set(key,{sha256:sha(await readFile(target))});}catch(e){sourceCache.set(key,{error:e.code==='ENOENT'?'installed_source_missing':'installed_source_unreadable'});}}const result=sourceCache.get(key);if(result.error)issue(result.error,result.error==='installed_source_missing'?'unavailable':'failed');else{verified[key]=result.sha256;if(a&&a.source_hashes[key]!==result.sha256)issue('source_hash_mismatch');}}
    if(a){if(sha(canonical(a.input))!==a.input_sha256)issue('input_hash_mismatch');if(a.output!==null&&sha(canonical(a.output))!==a.output_sha256)issue('output_hash_mismatch');if(a.execution_status!=='succeeded')issue('recorded_'+a.execution_status,a.execution_status);for(const source of a.declaration.sources){const inv=input.inventory.find(x=>scopeKey(x)===scopeKey(source));if(!recordIntegrity.get(inv.evidence_ref))issue('declaration_evidence_invalid');}for(const k of a.declaration.bridge_keys)if(!recordIntegrity.get(state.bridges.get(k).evidence_ref))issue('declaration_evidence_invalid');}
    for(const ref of s.input_evidence_refs){const record=state.records.get(ref.evidence_ref),artifact=state.artifacts.get(ref.evidence_ref);if(ref.content_sha256!==(record?.sha256??artifact?.output_sha256))issue('dependency_hash_mismatch');if(record&&!recordIntegrity.get(ref.evidence_ref))issue('input_evidence_invalid');}
    for(const d of s.depends_on){const producer=stepResults.find(x=>x.step_id===d);if(producer.execution_status!=='succeeded')issue(producer.execution_status==='failed'?'dependency_failed':'dependency_unavailable',producer.execution_status);}
    const dedup=[...new Set(reasons)].sort();for(const code of dedup)finding(code,status==='failed'?'fail':'unknown',a?.evidence_ref??declarationRef,a?'/runtime_provenance':'/steps/'+input.steps.indexOf(s));
    const observations=a?.observations.map(o=>({pointer:o.pointer,value:pointer(a.output,o.pointer)}))??[];
    stepResults.push({step_id:s.step_id,skill:s.skill,entrypoint:s.entrypoint,required:s.required,execution_status:status,reason_codes:dedup,input_evidence_refs:s.input_evidence_refs,output_evidence_ref:s.artifact_ref,verified_source_hashes:verified,recorded_execution_status:a?.execution_status??null,boundary_verification:a?boundaryEvidence(a,entry,input.boundary):{status:'not_present',fields:[],limit:'only_present_contract_configuration_fields_checked'},observations});
    if(a)Object.defineProperty(outputs,a.evidence_ref,{value:{output:a.output,runtime_provenance:a.runtime_provenance,input_sha256:a.input_sha256,output_sha256:a.output_sha256,integrity_verified:status==='succeeded'},enumerable:true,writable:true,configurable:true});
    if(entry.quality_check_id&&status==='succeeded'){finding('native_quality_'+a.output.status,a.output.status,a.evidence_ref,'/output/status');}
  }
  // Coverage is an attestation; integrity failure never promotes it to complete.
  const coverage=input.inventory.map((x,i)=>{const integrity=recordIntegrity.get(x.evidence_ref);if(x.coverage_status!=='complete'||!integrity)finding(integrity?'source_coverage_'+x.coverage_status:'inventory_evidence_invalid',integrity?'unknown':'fail',x.evidence_ref,'/value',{source_system:x.source_system,source_scope:x.source_scope});return integrity?x.coverage_status:'unavailable';});
  const required=stepResults.filter(s=>s.required),execution_status=required.some(s=>s.execution_status==='failed')?'failed':required.some(s=>s.execution_status==='unavailable')?'partial':'complete';
  const quality=stepResults.filter(s=>registry.entries.find(e=>e.skill===s.skill&&e.id===s.entrypoint).quality_check_id).map(s=>s.execution_status==='succeeded'?state.artifacts.get(s.output_evidence_ref).output.status:'unknown');
  return {contract_version:'0.1.0',audit_key:input.audit_key,execution_mode:'artifact_composition',fresh_upstream_calls:0,execution_status,quality_status:!quality.length?'not_requested':quality.includes('fail')?'fail':quality.includes('unknown')?'unknown':'pass',input,declaration_evidence:{evidence_ref:declarationRef,value:input,sha256:sha(canonical(input))},declarations_integrity_verified:[...recordIntegrity.values()].every(Boolean),data_coverage_status:coverage.every(x=>x==='complete')?'complete':coverage.every(x=>x==='unavailable')?'unavailable':'partial',declarations:{boundary:input.boundary,inventory:input.inventory,bridges:input.bridges},evidence_records:input.evidence_records,requested_steps:input.steps,artifacts:input.artifacts,steps:stepResults,native_outputs:outputs,findings,skill_coverage:state.skills.map(skill=>({skill,status:input.steps.some(s=>s.skill===skill)?'requested':'not_requested',step_ids:state.ordered.filter(s=>s.skill===skill).map(s=>s.step_id)})),limits:['artifact_integrity_not_execution_authentication','attested_coverage_not_independently_verified','no_semantic_recomputation','no_implicit_identity_or_campaign_bridge','no_fresh_upstream_execution']};
}
