import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir, mkdtemp, cp, rm } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { tmpdir, homedir } from 'node:os';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { composeAudit, canonicalHash } from './compose-audit.mjs';
const root=fileURLToPath(new URL('../',import.meta.url)),repo=resolve(root,'../..');
const fixtures=JSON.parse(await readFile(join(root,'references/audit-fixtures.json'),'utf8'));
const registry=JSON.parse(await readFile(join(root,'references/entrypoints.json'),'utf8'));
const sha=v=>createHash('sha256').update(v).digest('hex');
const scratch=await mkdtemp(join(tmpdir(),'audit-composition-'));
const suppliedRoot=process.argv.indexOf('--skill-roots');
const originalRoots=suppliedRoot>=0?JSON.parse(await readFile(process.argv[suppliedRoot+1],'utf8')):Object.fromEntries([...new Set(registry.entries.map(e=>e.skill))].map(s=>[s,join(repo,'skills',s)]));
const copyRoots={};const paths=new Map();for(const entry of registry.entries)for(const ref of entry.source_refs)paths.set(ref.skill+'/'+ref.path,ref);
const results={mode:'artifact_composition_only',fresh_upstream_calls:0,sql_executed:false,model_calls:0,network_calls:0,node_version:process.version,fixture_sha256:sha(await readFile(join(root,'references/audit-fixtures.json'))),source_hashes:{},goldens:[],structural_errors:[],integrity_checks:[],mutations:[],special_checks:[]};
let passed=false;
try {
  for(const [key,ref] of paths){const from=join(originalRoots[ref.skill],ref.path),target=join(scratch,'installed',ref.skill,ref.path);await mkdir(dirname(target),{recursive:true});await cp(from,target);copyRoots[ref.skill]=join(scratch,'installed',ref.skill);results.source_hashes[key]=sha(await readFile(from));}
  assert.equal(Object.keys(copyRoots).length,11);
  for(const c of fixtures.cases){const skillRoots={...copyRoots};for(const k of c.omit_skill_roots??[])delete skillRoots[k];const before=structuredClone(c.input),actual=await composeAudit(c.input,{skillRoots});assert.deepEqual(actual,c.expected,c.id);assert.deepEqual(c.input,before);for(const f of actual.findings){const source=f.evidence_ref===actual.declaration_evidence.evidence_ref?actual.declaration_evidence.value:actual.evidence_records.find(e=>e.evidence_ref===f.evidence_ref)??actual.artifacts.find(a=>a.evidence_ref===f.evidence_ref);assert.ok(source,'resolvable finding evidence');let cursor=source;for(const k of f.json_pointer.slice(1).split('/')){assert.ok(Object.hasOwn(cursor,k));cursor=cursor[k];}}results.goldens.push(c.id);}
  const base=fixtures.cases[0].input;
  async function error(name,mutate){const input=structuredClone(base);mutate(input);await assert.rejects(composeAudit(input,{skillRoots:copyRoots}),e=>e instanceof TypeError&&e.message==='Invalid audit composition input',name);results.structural_errors.push(name);}
  await error('unknown-entrypoint-path-traversal',x=>x.steps[0].entrypoint='../../etc/passwd');
  await error('unknown-skill',x=>x.steps[0].skill='other');
  await error('duplicate-qualified-scope',x=>x.inventory.push(structuredClone(x.inventory[0])));
  await error('conflicting-artifact-identity',x=>x.artifacts.push(structuredClone(x.artifacts[0])));
  await error('global-catalog-artifact-collision',x=>x.evidence_records[0].evidence_ref=x.artifacts[0].evidence_ref);
  await error('reserved-declaration-ref-collision',x=>x.evidence_records[0].evidence_ref='audit_declaration:'+x.audit_key);
  await error('dependency-cycle',x=>x.steps[0].depends_on=['quality']);
  await error('missing-dependency',x=>x.steps[0].depends_on=['missing']);
  await error('dangling-input-evidence',x=>x.steps[0].input_evidence_refs[0].evidence_ref='missing');
  await error('dangling-artifact-ref',x=>x.steps[0].artifact_ref='missing');
  await error('artifact-ref-without-direct-dependency',x=>x.steps[1].depends_on=[]);
  await error('declared-report-boundary-conflict',x=>x.artifacts[0].declaration.boundary.end='2026-02-01');
  await error('native-cost-input-boundary-conflict',x=>{x.artifacts[0].input.configuration.report_end='2026-02-01';x.artifacts[0].input_sha256=canonicalHash(x.artifacts[0].input);});
  await error('native-cost-output-timezone-conflict',x=>{x.artifacts[0].output.report[0].report_timezone='America/Los_Angeles';x.artifacts[0].output_sha256=canonicalHash(x.artifacts[0].output);});
  await error('native-quality-boundary-conflict',x=>{x.artifacts[1].output.configuration.date_mode='activity';x.artifacts[1].output_sha256=canonicalHash(x.artifacts[1].output);});
  await error('missing-native-json-pointer',x=>x.artifacts[0].observations=[{pointer:'/report/1000'}]);
  await error('invalid-json-pointer-escape',x=>x.artifacts[0].observations=[{pointer:'/report/~2'}]);
  await error('undeclared-native-origin',x=>{x.artifacts[0].input.configuration.source_scope='elsewhere';x.artifacts[0].input_sha256=canonicalHash(x.artifacts[0].input);});
  await error('bridge-unknown-endpoint',x=>x.bridges[0].to_source_scope='elsewhere');
  await error('bridge-not-declared-by-artifact',x=>x.artifacts[0].declaration.bridge_keys=[]);
  await error('incorrect-bridge-kind',x=>x.bridges[0].kind='identity');
  await error('known-binding-endpoint-mismatch',x=>{x.artifacts[0].input.binding_input[0].ad_source_scope='unbound';x.artifacts[0].input_sha256=canonicalHash(x.artifacts[0].input);});
  await error('native-quality-wrong-status',x=>x.artifacts[1].output.status='fitted');
  await error('native-quality-wrong-check',x=>x.artifacts[1].output.check_id='match_rate');
  await error('native-quality-not-full-finding',x=>delete x.artifacts[1].output.diagnostics);
  await error('failed-artifact-nonnull-output',x=>{x.artifacts[0].execution_status='failed';x.artifacts[0].reason_codes=['query_failed'];});
  await error('invalid-calendar',x=>x.boundary.start='2026-02-30');
  await error('invalid-offset',x=>x.boundary.as_of='2026-02-01T00:00:00+01:99');
  await error('numeric-timezone',x=>x.boundary.timezone='+00:00');
  await error('mixed-currency-with-native-currency',x=>x.boundary.currency_status='mixed_currency');
  await error('count-has-revenue-currency',x=>x.boundary.outcome_currency='USD');
  await error('nonfinite',x=>x.artifacts[0].input.bad=Infinity);
  await error('cycle-in-plain-json',x=>x.artifacts[0].input.cycle=x);
  await error('sparse-array',x=>delete x.inventory[1]);
  await error('getter-not-executed',x=>Object.defineProperty(x,'audit_key',{enumerable:true,get(){throw Error('getter executed');}}));
  await error('unused-accessor-not-executed',x=>Object.defineProperty(x.artifacts[0].input,'unused',{enumerable:true,get(){throw Error('getter executed');}}));
  await error('non-enumerable-property',x=>Object.defineProperty(x,'unused',{value:1}));
  await error('symbol-property',x=>x[Symbol('unused')]=true);
  await error('proxy-trap-not-executed',x=>x.artifacts[0].input=new Proxy({},{getPrototypeOf(){throw Error('proxy trap executed');}}));
  await error('date-object',x=>x.artifacts[0].input.bad=new Date());
  await error('undefined-value',x=>x.artifacts[0].input.bad=undefined);
  await error('known-identity-binding-wrong-kind',x=>{x.artifacts[0].input.identity_scope_bindings=[{source_system:'synthetic_crm',source_scope:'crm-a',contact_source_system:'synthetic_ads',contact_source_scope:'ads-a'}];x.artifacts[0].input_sha256=canonicalHash(x.artifacts[0].input);});
  {const x=structuredClone(fixtures.cases[3].input);x.artifacts[0].output.config.end_week='2026-02-02';x.artifacts[0].output_sha256=canonicalHash(x.artifacts[0].output);await assert.rejects(composeAudit(x,{skillRoots:copyRoots}),TypeError);results.structural_errors.push('native-mmm-output-window-conflict');}
  {const x=structuredClone(base),a=x.artifacts[0];x.steps[0].skill='multi-touch-models-sql';x.steps[0].entrypoint='credit_ledger';const entry=registry.entries.find(e=>e.skill===x.steps[0].skill&&e.id===x.steps[0].entrypoint);a.source_hashes=Object.fromEntries(await Promise.all(entry.source_refs.map(async r=>[r.skill+'/'+r.path,sha(await readFile(join(copyRoots[r.skill],r.path)))])));a.input={configuration:{report_timezone:'UTC',report_start_date:'2026-01-01',report_end_date:'2026-02-01',as_of:base.boundary.as_of}};a.input_sha256=canonicalHash(a.input);await assert.rejects(composeAudit(x,{skillRoots:copyRoots}),TypeError);results.structural_errors.push('native-mta-report-end-date-conflict');}
  assert.deepEqual(new Set(fixtures.cases[0].expected.native_outputs['cost-evidence'].output.report.map(r=>r.bucket)),new Set(['matched','unmatched','ambiguous','unattributed','spend_only']));
  assert.ok(fixtures.cases[0].input.artifacts[2].input.source.some(r=>r.achieved===true&&r.is_attribution_primary===false));assert.ok(fixtures.cases[0].input.artifacts[2].input.source.some(r=>r.achieved===null));assert.equal(fixtures.cases[0].expected.native_outputs['undated-evidence'].output.details[0].report_date,null);
  for(const [name,field,code] of [['input-hash','input_sha256','input_hash_mismatch'],['output-hash','output_sha256','output_hash_mismatch']]){const x=structuredClone(base);x.artifacts[0][field]='0'.repeat(64);const actual=await composeAudit(x,{skillRoots:copyRoots});assert.equal(actual.execution_status,'failed');assert.ok(actual.steps[0].reason_codes.includes(code));assert.equal(actual.steps[1].execution_status,'failed');assert.deepEqual(actual.native_outputs['cost-evidence'].output,x.artifacts[0].output);results.integrity_checks.push(name);}
  {const x=structuredClone(base);x.steps[1].input_evidence_refs[1].content_sha256='0'.repeat(64);const actual=await composeAudit(x,{skillRoots:copyRoots});assert.equal(actual.execution_status,'failed');assert.ok(actual.steps[1].reason_codes.includes('dependency_hash_mismatch'));results.integrity_checks.push('cited-upstream-output-hash');}
  {const x=structuredClone(base),options={skillRoots:{...copyRoots}},before=structuredClone(x);const pending=composeAudit(x,options);x.audit_key='caller-mutated';x.artifacts[0].output.report=[];options.skillRoots['funnel-truth-and-cost-per-stage']='/missing';const out=await pending;assert.deepEqual(out,fixtures.cases[0].expected);assert.notEqual(x.audit_key,before.audit_key);out.artifacts[0].input.mutated=true;assert.equal(before.artifacts[0].input.mutated,undefined);results.special_checks.push('synchronous-capture-before-await-and-return-no-caller-alias');}
  {const modulePath=join(copyRoots['attribution-data-quality-tripwires'],'scripts/funnel-additivity.sql'),original=await readFile(modulePath);await writeFile(modulePath,Buffer.concat([original,Buffer.from('\n-- copied source changed\n')]));const out=await composeAudit(base,{skillRoots:copyRoots});assert.equal(out.execution_status,'failed');assert.ok(out.steps.find(s=>s.step_id==='quality').reason_codes.includes('source_hash_mismatch'));await writeFile(modulePath,original);results.special_checks.push('installed-byte-change-detected');}
  // Verify a real cross-root transitive dependency without executing its producer.
  {const x=structuredClone(fixtures.cases[5].input),entry=registry.entries.find(e=>e.skill==='first-party-pixel'&&e.id==='identity_projection');x.steps[0].skill=entry.skill;x.steps[0].entrypoint=entry.id;const a=x.artifacts[0];a.input={};a.input_sha256=canonicalHash(a.input);a.source_hashes=Object.fromEntries(await Promise.all(entry.source_refs.map(async r=>[r.skill+'/'+r.path,sha(await readFile(join(copyRoots[r.skill],r.path)))])));const helper=join(copyRoots['clickstream-identity-stitching'],'scripts/identity-normalization.mjs'),original=await readFile(helper);await writeFile(helper,Buffer.concat([original,Buffer.from('\n// test copied helper only\n')]));const out=await composeAudit(x,{skillRoots:copyRoots});assert.equal(out.execution_status,'failed');assert.ok(out.steps[0].reason_codes.includes('source_hash_mismatch'));await writeFile(helper,original);const missing={...copyRoots};delete missing['clickstream-identity-stitching'];const unavailable=await composeAudit(x,{skillRoots:missing});assert.equal(unavailable.execution_status,'partial');assert.ok(unavailable.steps[0].reason_codes.includes('installed_source_missing'));results.special_checks.push('actual-cross-root-transitive-helper-change-and-missing-root');}
  // Execute semantic composer mutants from isolated copies; each must fail the exact full golden.
  const source=await readFile(join(root,'scripts/compose-audit.mjs'),'utf8');
  const mutants=[
    ['drop-ambiguous-bucket',"if(a)Object.defineProperty(outputs", "if(a?.output?.report)a.output.report=a.output.report.filter(r=>r.bucket!=='ambiguous'); if(a)Object.defineProperty(outputs",0],
    ['drop-spend-only-bucket',"if(a)Object.defineProperty(outputs", "if(a?.output?.report)a.output.report=a.output.report.filter(r=>r.bucket!=='spend_only'); if(a)Object.defineProperty(outputs",0],
    ['null-to-zero',"output:a.output,runtime_provenance", "output:a.output===null?0:JSON.parse(JSON.stringify(a.output).replace(/:null/g,':0')),runtime_provenance",0],
    ['infer-subject-from-bare-lead-key',"if(a)Object.defineProperty(outputs", "if(a?.output?.stage_evidence)for(const row of a.output.stage_evidence)row.subject_key=row.lead_key; if(a)Object.defineProperty(outputs",0],
    ['native-fail-promoted-pass',"quality.includes('fail')?'fail'", "quality.includes('fail')?'pass'",0],
    ['missing-artifact-promoted-success',"if(!a)issue('artifact_missing','unavailable');", "if(!a){}",2],
    ['failed-evidence-promoted-success',"if(a.execution_status!=='succeeded')issue('recorded_'+a.execution_status,a.execution_status);", "if(a.execution_status!=='succeeded'){}",4],
  ];
  for(const [name,old,replacement,index] of mutants){assert.equal(source.split(old).length,2,'exact mutation patch '+name);const dir=join(scratch,'mutants',name);await mkdir(join(dir,'scripts'),{recursive:true});await mkdir(join(dir,'references'));await cp(join(root,'references/entrypoints.json'),join(dir,'references/entrypoints.json'));const target=join(dir,'scripts/compose-audit.mjs');await writeFile(target,source.replace(old,()=>replacement));const module=await import(pathToFileURL(target));let rejected=false;try{const actual=await module.composeAudit(fixtures.cases[index].input,{skillRoots:copyRoots});try{assert.deepEqual(actual,fixtures.cases[index].expected);}catch{rejected=true;}}catch{rejected=true;}assert.ok(rejected,'executed mutant rejected: '+name);results.mutations.push(name);}
  results.special_checks.push('all-eleven-explicit-independent-installed-roots','all-findings-resolve-existing-evidence-pointers','complete-native-five-buckets-and-undated-nonprimary-retained');
  for(const path of ['scripts/compose-audit.mjs','scripts/test-compose-audit.mjs','references/audit-contract.md','references/audit-fixtures.json','references/entrypoints.json'])results.source_hashes['attribution-audit/'+path]=sha(await readFile(join(root,path)));
  passed=true;
} catch(error){results.error={name:error.name,message:error.message,stack:error.stack};throw error;} finally {
  results.status=passed?'passed':'failed';results.completed_at=new Date().toISOString();results.counts={full_golden_reports:results.goldens.length,structural_errors:results.structural_errors.length,integrity_checks:results.integrity_checks.length,semantic_mutations:results.mutations.length,special_checks:results.special_checks.length};
  const output=process.argv.includes('--report')?process.argv[process.argv.indexOf('--report')+1]:join(homedir(),'Downloads','attribution-audit-composition-evidence-'+new Date().toISOString().replace(/[-:.]/g,'')+'.json');await mkdir(dirname(output),{recursive:true});await writeFile(output,JSON.stringify(results,null,2)+'\n',{flag:'wx'});console.log(JSON.stringify({status:results.status,counts:results.counts,evidence:output,mode:results.mode},null,2));await rm(scratch,{recursive:true,force:true});
}
