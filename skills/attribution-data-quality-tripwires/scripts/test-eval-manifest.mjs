import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,mkdtempSync,rmSync,existsSync,mkdirSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {join,resolve,dirname} from 'node:path';
import {tmpdir,homedir} from 'node:os';
import {buildArtifacts,readFixtures,SELECTION,CHECK_IDS,CONTEXT_FILES,neutralize,pointer,skillRoot,writeManifest} from './build-eval-cases.mjs';
const PINNED_SOURCES={
  "references/deleted-ad-coverage-contract.md": "4308afc384b9065735abfcfdd02e0206cefab8725f450a2b3de32688f80ddc43",
  "references/deleted-ad-coverage-fixtures.json": "932e4dadbc9d6570b3e6bd5405fce22c4ac2d8727674b0358f9fa901308d267e",
  "references/empty-column-contract.md": "4d95753833d2e13b28885d1e35ed42243a60e6c164fec0aade91c9a90e370453",
  "references/empty-column-fixtures.json": "4adcc5533be8a71fa6d352d4ead1e3f8b784ab25a5a5b42828a4da460e2886a8",
  "references/population-contract.md": "f5771e2d6b2bcb7d96dd27ab1fbc5ed0b127e78283c59521049cb28ad2c6cf13",
  "references/population-fixtures.json": "88e561bd4e1d0086e6a7934986a4b0cac014860958c2401be5c31b0fa7eef7da",
  "references/reconciliation-contract.md": "6e6667fba99d54759ed4f0d62ae5ab8a979cd3cad7861aba136341af9ee27c87",
  "references/reconciliation-fixtures.json": "b6705f4bbd56012a8e0c0bf14c5bdfe99315b2006f888eabd311d457a5cc82e9",
  "references/schema-contract.md": "e6d5e8193047a9aa34b9339dae6ce62a231e2a6a105f02da25829c88e3326dbe",
  "references/schema-fixtures.json": "5b5cbe7c67bc3e1769c3c847ac6e5e0f59489de87ff27d32cf47e518a4daabf1",
  "scripts/deleted-ad-coverage.sql": "abed98f034ce895284a8e5b1039d7f681a1697ed06d15d12c541f77b60349256",
  "scripts/empty-column-probe.sql": "92b23fb4cb3e5cd735e002b884f37c86bae34fbb3ef155aa96fa9a8fddca89a1",
  "scripts/funnel-additivity.sql": "330f372ca987210cdc1599eae2c117499798d961cacc84f689bb861dd9a89ed4",
  "scripts/inspect-column-population.sql": "2e4d22e033b77edd4d2cbac802b9178f49df8a63a5d36b14782033ea02828fd6",
  "scripts/inspect-schema.sql": "c5c71c5265c34c93240ebd5383e6c543e96cac1db6f881ed818fa6b7ad5f24a7",
  "scripts/match-rate.sql": "9c574a429119029c74abbd32abf57133424233efe019db37572b3d96577d4e07",
  "scripts/no-pii-columns.sql": "2c3fed3dfa233f4b11f531f6f26258cb08765a5780422dfab47c27b51b90340b",
  "scripts/primary-uniqueness.sql": "fa1821d6528b15009122fefc0ba60a99f907de73774e8ce5781ec8f81e0bf940",
  "scripts/source-parity.sql": "b4483f986cde5d7d16916e886ba9d4855600f7c3d5f5ea1c02e6053a0371e861",
  "scripts/spend-conservation.sql": "1243c093c40f857678df9b73071a268a0bce2591e1729d636503944bbffb2a24",
  "scripts/test-deleted-ad-coverage.mjs": "f1781126ceb7d8bff6c845f4fdd59321c5a79ec85abbd6585e675302144c97f6",
  "scripts/test-empty-columns.mjs": "f242953f86b51be25340a87f7f83b893d555801b25f58ff0a2dbb120d9cd6ecf",
  "scripts/test-population-checks.mjs": "40233c7c9caf539d8e75b5f327ecb6ef65946e36b48941fd1e709527554c104e",
  "scripts/test-reconciliation.mjs": "9a0663bbd2eb261728d36bd1f7868b43ee86aedc4deba5c3eeb21292667f739a",
  "scripts/test-schema-checks.mjs": "7de3a365856c4f5c74acb7f207571d9294ca080f9baf1e4ffc69e4ebe6013678",
  "scripts/unmapped-share.sql": "220b4a8d9d6b88f6c7237971d7093ccec4d7c30ecaf4a00ec1d3e2fef1f30a26"
};
const hash=x=>createHash('sha256').update(x).digest('hex');
const read=path=>readFileSync(join(skillRoot,path));
for(const [path,sha]of Object.entries(PINNED_SOURCES))assert.equal(hash(read(path)),sha,'accepted source changed: '+path);
assert.equal(Object.keys(PINNED_SOURCES).length,26);
const files=readFixtures(),before=JSON.stringify(files),{manifest,expected}=buildArtifacts(files);
assert.equal(JSON.stringify(files),before,'fixture mutation');writeManifest(true);
assert.deepEqual(manifest.context_files,['SKILL.md','references/quality-quick-reference.md','references/evaluation-output-contract.md','references/channel-contract.md']);
assert.deepEqual(manifest.groups.map(g=>g.id),['reconciliation','population','schema_history']);
assert.deepEqual(manifest.groups.map(g=>g.input.cases.length),[4,4,5]);
assert.deepEqual(manifest.groups.flatMap(g=>g.input.cases.map(c=>c.case_id)),['r1','r2','r3','r4','p1','p2','p3','p4','s1','s2','s3','s4','s5']);
assert.equal(new Set(manifest.groups.flatMap(g=>g.input.cases.map(c=>c.check_id))).size,9);
assert.deepEqual(manifest.groups.flatMap(g=>g.input.cases.map(c=>c.requested_paths.length)),[6,5,17,17,8,8,5,8,5,6,6,10,10]);
const selectedIds=SELECTION.flatMap(g=>g.cases.map(c=>c[2]));
assert.deepEqual(selectedIds,['spend-repeated-other-stage-excluded','spend-unknown-count-mismatch-still-fails','funnel-unknown-nonprimary-undated','funnel-drop-ambiguous','unmapped-uncertain-interval','match-unknown-proves-pass','primary-multiple-partial','parity-incomplete-missing-unknown','partial-forbidden-fails','whole-table','empty-table','backfill-gap','short-backfill']);
for(const [gi,group]of manifest.groups.entries())for(const [ci,modelCase]of group.input.cases.entries()){
 const [id,file,fixtureId,paths]=SELECTION[gi].cases[ci],f=files[file].cases.find(x=>x.id===fixtureId);
 // Verify the only changes recursively, independently of the builder's neutralizer.
 function exactRename(original,actual,key=''){
  if(key==='invocation_key'){assert.equal(actual,id);assert.equal(original,f.input.configuration.invocation_key);return;}
  if(Array.isArray(original)){assert.ok(Array.isArray(actual));assert.equal(actual.length,original.length);original.forEach((v,i)=>exactRename(v,actual[i]));}
  else if(original&&typeof original==='object'){assert.deepEqual(Object.keys(actual),Object.keys(original));for(const k of Object.keys(original))exactRename(original[k],actual[k],k);}
  else assert.deepEqual(actual,original);
 }
 exactRename(f.input,modelCase.inputs);assert.deepEqual(Object.keys(modelCase),['case_id','check_id','inputs','requested_paths']);
 assert.equal(modelCase.check_id,CHECK_IDS[id]);assert.deepEqual(modelCase.requested_paths,paths);
 assert.deepEqual(expected[gi].cases[ci],{case_id:id,check_id:f.expected.check_id,status:f.expected.status,reasons:f.expected.reasons,values:paths.map(path=>({path,value:pointer(f.expected,path)}))});
 const missing=structuredClone(files);delete missing[file].cases.find(x=>x.id===fixtureId).expected.details;assert.throws(()=>buildArtifacts(missing),/missing literal fixture path/);
}
const tagged=structuredClone(files['population-fixtures.json'].cases.find(f=>f.id==='primary-multiple-partial').input);tagged.source[0].invocation_key=tagged.configuration.invocation_key;
assert.equal(neutralize(tagged,'neutral').source[0].invocation_key,'neutral');tagged.source[0].invocation_key='unrelated';assert.throws(()=>neutralize(tagged,'neutral'),/unrelated row invocation tag/);
assert.throws(()=>pointer({value:null},'/absent'),/missing literal fixture path/);assert.equal(pointer({value:null},'/value'),null);
const canonical=resolve(skillRoot,'../channel-taxonomy/references/channel-contract.md');assert.equal(hash(read('references/channel-contract.md')),'c0ec46a712e49ca4fc4428367ee8a04458874de218396a0eb8e0b753f98cd13b');
if(existsSync(canonical))assert.deepEqual(read('references/channel-contract.md'),readFileSync(canonical));
const skill=read('SKILL.md').toString();assert.ok(skill.split('\n').length<500);assert.match(skill,/^---\nname: attribution-data-quality-tripwires\n/);assert.match(skill,/license: MIT/);assert.match(skill,/author: Riley Sorenson/);assert.match(skill,/version: "0.1.0"/);
const scripts=['spend-conservation.sql','funnel-additivity.sql','unmapped-share.sql','match-rate.sql','primary-uniqueness.sql','source-parity.sql','no-pii-columns.sql','empty-column-probe.sql','deleted-ad-coverage.sql','inspect-schema.sql','inspect-column-population.sql'];
for(const path of scripts)assert.ok(skill.includes('scripts/'+path),'undiscoverable native path');
for(const match of skill.matchAll(/\]\(([^)]+)\)/g))assert.ok(existsSync(join(skillRoot,match[1])),'broken SKILL link');
for(const path of CONTEXT_FILES){const content=read(path).toString();for(const id of selectedIds)assert.ok(!content.includes(id),'fixture identifier in context: '+id);}
const harness=process.env.QUALITY_EVAL_HARNESS??resolve(skillRoot,'../../scripts/run-skill-evals.py');assert.equal(hash(readFileSync(harness)),'b12f6051d57135d23bdf5e4204c6d4866ddbb41d5602bb4ea63972ab45567b45');
const temp=mkdtempSync(join(tmpdir(),'quality-eval-manifest-'));
try{
 writeFileSync(join(temp,'expected.json'),JSON.stringify(expected));writeFileSync(join(temp,'selection.json'),JSON.stringify(selectedIds));
 const python=String.raw`
import copy,hashlib,importlib.util,json,math,pathlib,sys
try: import tiktoken
except ImportError: raise SystemExit('Pre-live token estimation requires tiktoken; no model or SQL calls are performed.')
spec=importlib.util.spec_from_file_location('harness',sys.argv[1]);h=importlib.util.module_from_spec(spec);spec.loader.exec_module(h)
assert hashlib.sha256(pathlib.Path(sys.argv[1]).read_bytes()).hexdigest()=='b12f6051d57135d23bdf5e4204c6d4866ddbb41d5602bb4ea63972ab45567b45'
root=pathlib.Path(sys.argv[2]);manifest,context_hashes,manifest_hash=h.validate_manifest(root);expected=json.load(open(sys.argv[3]));fixture_ids=json.load(open(sys.argv[4]))
contexts={p:(root/p).read_text() for p in manifest['context_files']};enc=tiktoken.get_encoding('cl100k_base');sizes=[];mutations=[];groups=[]
def evaluate(g,value):return h.evaluate_call({'transport_exit_code':0,'raw_envelope':{'model':'qwen3:4b','message':{'content':json.dumps(value)}}},'qwen3:4b',g,h.prompt_for(g),'offline','offline','offline')
def reject(g,value,label):
 result=evaluate(g,value);assert result['errors'] or any(not c['passed'] for c in result['check_status']),label
 mutations.append({'group':g['id'],'name':label,'rejected':True})
def setvalue(x,path,value):
 parts=path.split('/')[1:];current=x
 for part in parts[:-1]:current=current[int(part)] if isinstance(current,list) else current[part]
 if isinstance(current,list):current[int(parts[-1])]=value
 else:current[parts[-1]]=value
for g,golden in zip(manifest['groups'],expected):
 result=evaluate(g,golden);assert not result['errors'];assert all(c['passed'] for c in result['check_status']);assert h.schema_type_ok(golden,g['output_schema'])
 prompt=h.prompt_for(g);changed=copy.deepcopy(g);changed['checks']=[{'path':'/sentinel','op':'equals','expected':'ANSWER_SENTINEL'}];assert h.prompt_for(changed)==prompt
 for condition in ('without-skill','with-skill'):
  system=h.system_prompt(condition,contexts if condition=='with-skill' else {});payload=prompt+system
  assert 'ANSWER_SENTINEL'not in payload;assert all(fid not in payload for fid in fixture_ids)
  if condition=='without-skill':assert system==h.system_prompt(condition,contexts)
  assert 'checks'not in json.loads(prompt)
  # The transport carries a types-only format schema as well as the schema in the prompt.
  raw=len(enc.encode(payload+json.dumps(h.types_only_schema(g['output_schema']))));buffered=math.ceil(raw*1.20)+512
  assert buffered+8192<=28000,(g['id'],condition,buffered)
  sizes.append({'group':g['id'],'condition':condition,'raw_estimated_input_tokens':raw,'buffered_input_tokens':buffered,'reserved_output_tokens':8192,'buffered_total_tokens':buffered+8192})
 output_tokens=len(enc.encode(json.dumps(golden,indent=2)));buffered_output=math.ceil(output_tokens*1.20)+256;assert buffered_output<=8192-1024,(g['id'],buffered_output)
 groups.append({'id':g['id'],'cases':len(golden['cases']),'requested_values':sum(len(c['values'])for c in golden['cases']),'checks':len(g['checks']),'expected_output_tokens':output_tokens,'buffered_expected_output_tokens':buffered_output})
 for label,action in [('drop_case',lambda x:x['cases'].pop()),('reorder_cases',lambda x:x['cases'].reverse()),('extra_case',lambda x:x['cases'].append(copy.deepcopy(x['cases'][0])))]:
  x=copy.deepcopy(golden);action(x);reject(g,x,label)
 for ci,c in enumerate(golden['cases']):
  for field in ('case_id','check_id','status'):
   assert sum(ch['path']==f'/cases/{ci}/{field}' and ch['op']=='equals'for ch in g['checks'])==1
  for ri in range(len(c['reasons'])):
   assert sum(ch['path']==f'/cases/{ci}/reasons/{ri}' and ch['op']=='equals'for ch in g['checks'])==1
  for label,action in [('drop_requested_path',lambda x:x['cases'][ci]['values'].pop()),('reorder_requested_paths',lambda x:x['cases'][ci]['values'].reverse()),('extra_requested_path',lambda x:x['cases'][ci]['values'].append(copy.deepcopy(x['cases'][ci]['values'][0]))),('missing_reasons_field',lambda x:x['cases'][ci].pop('reasons'))]:
   x=copy.deepcopy(golden);action(x);reject(g,x,label+'_'+c['case_id'])
  if c['reasons']:
   x=copy.deepcopy(golden);x['cases'][ci]['reasons'].pop();reject(g,x,'missing_reason_'+c['case_id'])
  if c['status']=='unknown':
   x=copy.deepcopy(golden);x['cases'][ci]['status']='pass';reject(g,x,'unknown_promoted_'+c['case_id'])
  # Each requested scalar has its own independent equality check after parsing.
  for vi,item in enumerate(c['values']):
   path=f'/cases/{ci}/values/{vi}/value';assert sum(ch['path']==path and ch['op']=='equals'for ch in g['checks'])==1
   v=item['value'];bad='0' if v is None else not v if isinstance(v,bool) else v+'INVALID'
   x=copy.deepcopy(golden);setvalue(x,path,bad);reject(g,x,'scalar_'+c['case_id']+'_'+str(vi))
   if v is None:
    x=copy.deepcopy(golden);setvalue(x,path,0);reject(g,x,'null_to_numeric_zero_'+c['case_id']+'_'+str(vi))
   elif isinstance(v,str):
    try: number=float(v)
    except ValueError: continue
    x=copy.deepcopy(golden);setvalue(x,path,number);reject(g,x,'decimal_string_to_number_'+c['case_id']+'_'+str(vi))
  for array_path in [f'/cases/{ci}/reasons',f'/cases/{ci}/values']:
   assert sum(ch['path']==array_path and ch['op']=='array_length_equals'for ch in g['checks'])==1
 assert sum(ch['path']=='/cases' and ch['op']=='array_length_equals'for ch in g['checks'])==1
 x=copy.deepcopy(golden);x['extra']=True;reject(g,x,'extra_root_field')
# Named plausible omissions use selected case roles, not a substitute quality engine.
for gi,ci,label,status in [(0,1,'unknown_money_hides_complete_count_defect','unknown'),(1,2,'ignore_observed_duplicate_primary','unknown'),(1,3,'ignore_partial_reference','pass'),(2,0,'ignore_partial_schema_policy_hit','unknown'),(2,3,'history_auto_exempts_gap','pass'),(2,4,'ignore_short_history','pass')]:
 x=copy.deepcopy(expected[gi]);x['cases'][ci]['status']=status;x['cases'][ci]['reasons']=[];reject(manifest['groups'][gi],x,label)
print(json.dumps({'status':'passed','groups':groups,'group_count':3,'case_count':13,'check_coverage':sorted({c['check_id']for g in manifest['groups']for c in g['input']['cases']}),'context_hashes':context_hashes,'manifest_sha256':manifest_hash,'harness_sha256':hashlib.sha256(pathlib.Path(sys.argv[1]).read_bytes()).hexdigest(),'tokenizer':f'cl100k_base via tiktoken {tiktoken.__version__}; provider-independent estimate','input_buffer':'20 percent plus 512 tokens; duplicate transport schema included','output_buffer':'20 percent plus 256 tokens','sizes':sizes,'mutations':mutations,'mutation_count':len(mutations),'condition_neutrality_verified':True,'model_calls':0,'sql_execution':'NO SQL EXECUTED'}))
`;
 const result=spawnSync(process.env.QUALITY_PYTHON??'python3',['-c',python,harness,skillRoot,join(temp,'expected.json'),join(temp,'selection.json')],{encoding:'utf8',maxBuffer:20*1024*1024});
 if(result.status!==0){process.stderr.write(result.stderr);throw new Error('frozen scorer or pre-live boundary validation failed');}
 const report=JSON.parse(result.stdout);report.verified_at=new Date().toISOString();report.node_version=process.version;report.frozen_source_hashes=PINNED_SOURCES;report.selection=SELECTION;report.skill_lines=skill.split('\n').length;
 for(const [path,sha]of Object.entries(PINNED_SOURCES))assert.equal(hash(read(path)),sha,'source mutation during test');
 report.package_hashes=Object.fromEntries(['SKILL.md','references/implementation.md','references/quality-quick-reference.md','references/evaluation-output-contract.md','references/eval.md','references/eval-cases.json','references/channel-contract.md','scripts/build-eval-cases.mjs','scripts/test-eval-manifest.mjs'].map(p=>[p,hash(read(p))]));
 const n=process.argv.indexOf('--evidence');const destination=n>=0?process.argv[n+1]:join(homedir(),'Downloads','attribution-quality-pre-live-evidence-'+new Date().toISOString().replaceAll(/[^0-9]/g,'')+'.json');assert.ok(destination);assert.ok(!existsSync(destination),'preserve existing evidence');mkdirSync(dirname(destination),{recursive:true});writeFileSync(destination,JSON.stringify(report,null,2)+'\n');
 console.log('PASS '+JSON.stringify({groups:report.group_count,cases:report.case_count,checks:report.groups.reduce((n,g)=>n+g.checks,0),requested_values:111,mutations:report.mutation_count,max_buffered_total_tokens:Math.max(...report.sizes.map(s=>s.buffered_total_tokens)),model_calls:0,sql_execution:report.sql_execution,evidence:destination}));
}finally{rmSync(temp,{recursive:true,force:true});}
