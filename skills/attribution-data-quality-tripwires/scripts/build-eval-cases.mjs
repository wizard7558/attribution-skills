import assert from 'node:assert/strict';
import {readFileSync,writeFileSync} from 'node:fs';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {resolve,join} from 'node:path';
export const skillRoot=fileURLToPath(new URL('..',import.meta.url));
export const CONTEXT_FILES=['SKILL.md','references/quality-quick-reference.md','references/evaluation-output-contract.md','references/channel-contract.md'];
const detail=(...fields)=>fields.map(x=>'/details/0/'+x);
const metrics=['/details/0/report_date',...[0,1,2,3].flatMap(i=>['source_count','report_count','difference','status'].map(k=>`/details/0/metrics/${i}/${k}`))];
const rates=detail('eligible_count','true_count','false_count','unknown_count','point_rate','lower_rate','upper_rate','unknown_conditions_present');
const columns=['/configuration/population_mode',...detail('row_count','non_null_count','observed_start','observed_end','scan_complete')];
const coverage=[...detail('comparable','ad_fact_count','reference_fact_count'),...['ad_known_spend','reference_known_spend','ad_spend','reference_spend','difference','allowed_tolerance','status'].map(x=>'/details/0/comparisons/0/'+x)];
// Selection provenance stays in this builder and offline evidence, never in model input/context.
export const SELECTION=[
 {id:'reconciliation',cases:[
  ['r1','reconciliation-fixtures.json','spend-repeated-other-stage-excluded',[...detail('source_fact_count','report_fact_count'),...['source_known_amount','report_known_amount','amount_difference'].map(x=>'/details/0/currency_comparisons/0/'+x),'/diagnostics/report_other_stage_rows']],
  ['r2','reconciliation-fixtures.json','spend-unknown-count-mismatch-still-fails',detail('source_fact_count','report_fact_count','fact_count_difference','source_unknown_fact_count','report_present')],
  ['r3','reconciliation-fixtures.json','funnel-unknown-nonprimary-undated',metrics],
  ['r4','reconciliation-fixtures.json','funnel-drop-ambiguous',metrics]
 ]},
 {id:'population',cases:[
  ['p1','population-fixtures.json','unmapped-uncertain-interval',rates],
  ['p2','population-fixtures.json','match-unknown-proves-pass',rates],
  ['p3','population-fixtures.json','primary-multiple-partial',detail('source_system','source_scope','member_count','primary_count','status')],
  ['p4','population-fixtures.json','parity-incomplete-missing-unknown',detail('reference_complete','observed_complete','reference_present','observed_present','reference_count','observed_count','difference','allowed_difference')]
 ]},
 {id:'schema_history',cases:[
  ['s1','schema-fixtures.json','partial-forbidden-fails',[...detail('schema_complete','table_exists','observed_column_count'),'/details/0/matching_paths/0/field_path','/details/0/matching_paths/0/matched_rule_ids/0']],
  ['s2','empty-column-fixtures.json','whole-table',columns],
  ['s3','empty-column-fixtures.json','empty-table',columns],
  ['s4','deleted-ad-coverage-fixtures.json','backfill-gap',coverage],
  ['s5','deleted-ad-coverage-fixtures.json','short-backfill',coverage]
 ]}
];
export const CHECK_IDS={r1:'spend_conservation',r2:'spend_conservation',r3:'funnel_additivity',r4:'funnel_additivity',p1:'unmapped_share',p2:'match_rate',p3:'primary_uniqueness',p4:'source_parity',s1:'no_pii_columns',s2:'empty_column_probe',s3:'empty_column_probe',s4:'deleted_ad_coverage',s5:'deleted_ad_coverage'};
export function readFixtures(){return Object.fromEntries([...new Set(SELECTION.flatMap(g=>g.cases.map(c=>c[1])))].map(f=>[f,JSON.parse(readFileSync(join(skillRoot,'references',f),'utf8'))]));}
export function pointer(value,path){
 assert.ok(path.startsWith('/'),'invalid requested pointer');let current=value;
 for(const token of path.slice(1).split('/').map(x=>x.replaceAll('~1','/').replaceAll('~0','~'))){assert.ok(current!==null&&typeof current==='object'&&Object.hasOwn(current,token),'missing literal fixture path '+path);current=current[token];}
 assert.ok(current===null||typeof current==='string'||typeof current==='boolean','unsupported projected scalar');return current;
}
export function neutralize(input,id){
 const original=input.configuration.invocation_key;assert.equal(typeof original,'string');const result=structuredClone(input);
 function walk(x){if(Array.isArray(x))x.forEach(walk);else if(x&&typeof x==='object')for(const [k,v]of Object.entries(x)){if(k==='invocation_key'){assert.equal(v,original,'unrelated row invocation tag');x[k]=id;}else walk(v);}}
 walk(result);return result;
}
const object=properties=>({type:'object',properties,required:Object.keys(properties),additionalProperties:false});
export const OUTPUT_SCHEMA=object({cases:{type:'array',items:object({case_id:{type:'string'},check_id:{type:'string'},status:{type:'string'},reasons:{type:'array',items:{type:'string'}},values:{type:'array',items:object({path:{type:'string'},value:{type:['string','boolean','null']}})}})}});
const escape=x=>x.replaceAll('~','~0').replaceAll('/','~1');
function checks(value,path=''){
 if(Array.isArray(value))return [{path,op:'array_length_equals',expected:value.length},...value.flatMap((v,i)=>checks(v,path+'/'+i))];
 if(value&&typeof value==='object')return Object.entries(value).flatMap(([k,v])=>checks(v,path+'/'+escape(k)));
 return [{path,op:'equals',expected:value}];
}
export function buildArtifacts(files=readFixtures()){
 const expected=[];
 const groups=SELECTION.map(g=>{
  const inputs=[],outputs=[];
  for(const [id,file,fixtureId,paths]of g.cases){
   const f=files[file].cases.find(x=>x.id===fixtureId);assert.ok(f?.input&&f.expected&&!f.expectedError,'selected literal success fixture missing');assert.equal(new Set(paths).size,paths.length);
   assert.equal(f.expected.check_id,CHECK_IDS[id]);const input=neutralize(f.input,id);assert.ok(!JSON.stringify(input).includes(fixtureId),'descriptive fixture identity leaked');
   inputs.push({case_id:id,check_id:CHECK_IDS[id],inputs:input,requested_paths:[...paths]});
   outputs.push({case_id:id,check_id:f.expected.check_id,status:f.expected.status,reasons:structuredClone(f.expected.reasons),values:paths.map(path=>({path,value:pointer(f.expected,path)}))});
  }
  const golden={cases:outputs};expected.push(golden);
  return {id:g.id,prompt:'Evaluate each supplied check independently from its explicit inputs. Return cases in input order, with the native finding check_id, overall status, sorted overall reasons, and the scalar values at exactly the requested native JSON paths in request order. Return only the specified compact JSON projection. Preserve decimal strings, booleans, and nulls.',input:{cases:inputs},output_schema:structuredClone(OUTPUT_SCHEMA),checks:checks(golden)};
 });
 return {manifest:{context_files:[...CONTEXT_FILES],groups},expected};
}
export function writeManifest(check=false){const {manifest}=buildArtifacts();const path=join(skillRoot,'references/eval-cases.json'),bytes=JSON.stringify(manifest,null,2)+'\n';if(check)assert.equal(readFileSync(path,'utf8'),bytes,'manifest drift');else writeFileSync(path,bytes);return manifest;}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){const m=writeManifest(process.argv.includes('--check'));console.log((process.argv.includes('--check')?'CHECKED':'WROTE')+' '+m.groups.length+' groups / '+m.groups.reduce((n,g)=>n+g.input.cases.length,0)+' cases; NO SQL OR MODEL CALLS');}
