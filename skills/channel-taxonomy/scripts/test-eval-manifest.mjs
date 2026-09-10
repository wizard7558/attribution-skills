#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
import {classify} from './channel-taxonomy.mjs';
const root=fileURLToPath(new URL('..',import.meta.url));
const hash=x=>crypto.createHash('sha256').update(x).digest('hex');
const clone=structuredClone;
const option=k=>process.argv.includes(k)?process.argv[process.argv.indexOf(k)+1]:null;
const inputs=[
  [
    {
      "utm_source": "google",
      "utm_medium": "email",
      "click_ids": {
        "fbclid": "fb-123"
      },
      "native_channel": "Direct"
    },
    {
      "utm_source": "google",
      "utm_medium": "organic",
      "click_ids": {
        "gclid": null
      },
      "landing_url": "https://shop.example/search?q=shoes",
      "referrer": "https://www.google.com/search?q=shoes"
    },
    {
      "utm_source": "newsletter",
      "utm_medium": "organic",
      "network_id": "google_ads",
      "referrer": "https://www.google.com/search?q=coat"
    },
    {
      "utm_source": "display-partner",
      "utm_medium": "referral",
      "click_ids": {
        "dclid": "D-987"
      },
      "landing_url": "https://shop.example/"
    },
    {
      "utm_source": "google",
      "utm_medium": "organic",
      "click_ids": {
        "srsltid": "SR-abc"
      },
      "referrer": "https://www.google.com/search?q=hat"
    },
    {
      "landing_url": "https://shop.example/landing",
      "native_channel": null,
      "utm_source": null,
      "utm_medium": null,
      "referrer": null
    },
    {
      "utm_source": "facebook",
      "utm_medium": "organic",
      "click_ids": {
        "fbclid": "fb-456"
      },
      "native_channel": "Organic Social",
      "raw_source": "facebook"
    },
    {
      "landing_url": "https://shop.example/a",
      "referrer": "https://partner.example/article",
      "utm_source": "",
      "utm_medium": ""
    }
  ],
  [
    {
      "native_channel": "Cross-network",
      "campaign_id": "pmax-1"
    },
    {
      "network_id": "google_ads_pmax",
      "utm_medium": "paid_search",
      "campaign": "Performance Max"
    },
    {
      "shopify_source_type": "sms",
      "shopify_source": "klaviyo",
      "utm_medium": "sms"
    },
    {
      "shopify_source_type": "affiliate",
      "shopify_source": "partner-network"
    },
    {
      "shopify_source_type": "search",
      "shopify_source": "google"
    },
    {
      "shopify_source_type": "social",
      "shopify_source": "instagram"
    },
    {
      "native_channel": "unknown",
      "shopify_source_type": "mystery",
      "utm_source": "unmapped",
      "utm_medium": "weird"
    },
    {
      "native_channel": "AI Assistant",
      "utm_source": "chatgpt",
      "utm_medium": "referral"
    }
  ],
  [
    {
      "ga4": {
        "source_scope": "web",
        "session_key": "42",
        "visitor_key": "g1"
      },
      "pixel": {
        "source_scope": "web",
        "session_key": "42",
        "visitor_key": "p1"
      },
      "currencies": [
        "USD"
      ]
    },
    {
      "ga4": {
        "source_scope": "web",
        "session_key": "7"
      },
      "pixel": {
        "source_scope": "app",
        "session_key": "7"
      },
      "currencies": [
        "USD"
      ]
    },
    {
      "ga4_population": "sessions A,B",
      "pixel_population": "touchpoints A,B",
      "overlap": true,
      "currencies": [
        "USD"
      ]
    },
    {
      "ga4_revenue": {
        "value": 100,
        "currency": "USD"
      },
      "pixel_value": {
        "value": 90,
        "currency": "EUR"
      },
      "currencies": [
        "USD",
        "EUR"
      ]
    },
    {
      "ga4_revenue": {
        "value": 100,
        "currency": null
      },
      "pixel_value": {
        "value": null,
        "currency": null
      },
      "currencies": []
    },
    {
      "ga4": {
        "attribution": "session last-click"
      },
      "pixel": {
        "attribution": "first collected touch"
      },
      "same_session_id": true,
      "currencies": [
        "USD"
      ]
    },
    {
      "event_dates": [
        "2026-01-01",
        "2026-01-02"
      ],
      "channels": [
        "Paid Search",
        "Direct"
      ],
      "sources": [
        "ga4",
        "first-party-pixel"
      ]
    },
    {
      "available_metrics": [
        "sessions",
        "engaged_sessions",
        "new_users",
        "key_events",
        "purchase_revenue_usd"
      ],
      "source_scopes": [
        "web",
        "app"
      ],
      "currencies": [
        "USD",
        "CAD"
      ]
    }
  ]
];
const channels=[["Paid Social", "Organic Search", "Paid Search", "Paid Other", "Organic Search", "Direct", "Paid Social", "Referral"], ["Paid Other", "Paid Search", "SMS", "Affiliate", "Organic Search", "Organic Social", "Other", "Referral"]];
const ids=['conflicting-acquisition-evidence','native-shopify-network-normalization','cross-source-interoperability'];
const reviews=['identity','identity','population','money','money','attribution','daily_grain','metrics'];
const absent=()=>({observations:[],total:null});
// Independently authored contract projections. These are reviewed interpretations, not a JS join engine.
const decisions=[
 {identity_fields:['source_system','source_scope','session_key','visitor_key'],same_session_token:true,same_scope_token:true,identity_bridge_established:false},
 {identity_fields:['source_system','source_scope','session_key','visitor_key'],same_session_token:true,same_scope_token:false,identity_bridge_established:false},
 {source_measures:{ga4:'sessions',first_party_pixel:'touchpoints'},can_sum_populations:false,purchase_equivalence_established:false},
 {declared_currencies:['USD','EUR'],fx_conversion_supplied:false},
 {declared_currencies:[],fx_conversion_supplied:false},
 {attribution_bases:{ga4:'session_last_click',first_party_pixel:'first_touch'},parity_established:false,identity_bridge_established:false},
 {daily_grain:['source_system','source_scope','event_date','channel'],can_sum_populations:false},
 {common_metrics:['sessions','engaged_sessions','new_users','key_events'],new_users_basis:'source_native_first_observed_sessions',cross_source_people_count:false,declared_currencies:['USD','CAD'],unconverted_currency_pool_status:'mixed_currency'}
];
const money=[absent(),absent(),absent(),
 {observations:[{source_field:'ga4_revenue',value:100,currency:'USD',status:'known'},{source_field:'pixel_value',value:90,currency:'EUR',status:'known'}],total:{value:null,currency:null,status:'mixed_currency'}},
 {observations:[{source_field:'ga4_revenue',value:null,currency:null,status:'unknown'},{source_field:'pixel_value',value:null,currency:null,status:'unknown'}],total:{value:null,currency:null,status:'unknown'}},absent(),absent(),absent()];
const expected=inputs.map((g,gi)=>({cases:g.map((input,i)=>({case:String.fromCharCode(65+i),result:gi<2?{channel:channels[gi][i],taxonomy_version:'0.1.0',paid_evidence_proven:false,preserve_raw:true}:{decision:decisions[i],money:money[i]}}))}));
let nativeCount=0;const nativeRecords=[];
for(let gi=0;gi<2;gi++)for(let i=0;i<8;i++){const raw=clone(inputs[gi][i]);const actual=classify(raw);assert.equal(actual.channel,channels[gi][i]);assert.equal(actual.taxonomy_version,'0.1.0');assert.deepEqual(raw,inputs[gi][i]);nativeRecords.push({group:ids[gi],case:String.fromCharCode(65+i),input:raw,actual});nativeCount++;}
const pins={
  "SKILL.md": "2c075029304a26e572a1e0f98624ee812c2588d191eb4cfd44331848acd03f7c",
  "references/channel-contract.md": "c0ec46a712e49ca4fc4428367ee8a04458874de218396a0eb8e0b753f98cd13b",
  "references/source-mappings.md": "a40a6162f9b0d8eac5cdb7d9f80098d74005910953f9c15673c42ffb2a4058c6",
  "scripts/channel-taxonomy.mjs": "c2d0034a533385cf1aa6475009f47d11d3f8a60ce5be96e629ea340e78a69299"
};
for(const [p,h] of Object.entries(pins))assert.equal(hash(fs.readFileSync(path.join(root,p))),h,p);
const contract=fs.readFileSync(path.join(root,'references/evaluation-output-contract.md'),'utf8');
const header=contract.split('## Classification')[0];
const classifierText=contract.split('## Classification')[1].split('## Contract review')[0];
const reviewText=contract.split('## Contract review')[1];
const pointer=s=>s.replaceAll('~','~0').replaceAll('/','~1');
function checks(v,p=''){if(Array.isArray(v))return [{path:p,op:'array_length_equals',expected:v.length},...v.flatMap((x,i)=>checks(x,p+'/'+i))];if(v&&typeof v==='object')return Object.entries(v).flatMap(([k,x])=>checks(x,p+'/'+pointer(k)));return [{path:p,op:typeof v==='number'?'approximately':'equals',expected:v,...(typeof v==='number'?{tolerance:1e-9}:{})}];}
function schema(values,key=''){
 if(key==='value')return {type:['number','null']};if(key==='currency')return {type:['string','null']};
 const kinds=new Map();for(const v of values){const t=v===null?'null':Array.isArray(v)?'array':typeof v;const k=t==='object'?t+Object.keys(v).sort().join('|'):t;if(!kinds.has(k))kinds.set(k,{t,vs:[]});kinds.get(k).vs.push(v);}
 const choices=[...kinds.values()].map(({t,vs})=>{if(t==='object'){const keys=Object.keys(vs[0]);return {type:t,properties:Object.fromEntries(keys.map(k=>[k,schema(vs.map(v=>v[k]),k)])),required:keys,additionalProperties:false};}if(t==='array')return {type:t,items:vs.flat().length?schema(vs.flat()):{type:'string'}};return {type:t};});return choices.length===1?choices[0]:{anyOf:choices};
}
const manifest={context_files:['SKILL.md','references/channel-contract.md','references/source-mappings.md'],groups:ids.map((id,gi)=>({id,prompt:'Apply the supplied evidence and return the declared projection.\n\n'+header+(gi<2?'## Classification'+classifierText:'## Contract review'+reviewText),input:{cases:inputs[gi].map((input,i)=>({case:String.fromCharCode(65+i),...(gi===2?{review:reviews[i]}:{}),input}))},output_schema:schema([expected[gi]]),checks:checks(expected[gi])}))};
const serialized=JSON.stringify(manifest,null,2)+'\n';const file=path.join(root,'references/eval-cases.json');
if(process.argv.includes('--write'))fs.writeFileSync(file,serialized);
assert.equal(fs.readFileSync(file,'utf8'),serialized,'deterministic manifest freshness');
const harness=process.env.TAXONOMY_EVAL_HARNESS??path.resolve(root,'../../scripts/run-skill-evals.py');
assert.equal(hash(fs.readFileSync(harness)),'b12f6051d57135d23bdf5e4204c6d4866ddbb41d5602bb4ea63972ab45567b45');
const temp=fs.mkdtempSync(path.join(os.tmpdir(),'taxonomy-eval-'));
try{
 fs.writeFileSync(path.join(temp,'expected.json'),JSON.stringify(expected));
 const python="import sys,json,copy,hashlib,importlib.util,re\nfrom pathlib import Path\nspec=importlib.util.spec_from_file_location('h',sys.argv[1]);h=importlib.util.module_from_spec(spec);spec.loader.exec_module(h)\nroot=Path(sys.argv[2]);expected=json.loads(Path(sys.argv[3]).read_text());manifest,hashes,sha=h.validate_manifest(root)\ncontexts={p:(root/p).read_text() for p in manifest['context_files']}\ntry:\n import tiktoken\n enc=tiktoken.get_encoding('cl100k_base');tokens=lambda s:len(enc.encode(s));tokenizer='cl100k_base estimate, not Qwen tokenizer'\nexcept ImportError:\n tokens=lambda s:(len(s.encode('utf-8'))+2)//3;tokenizer='conservative UTF-8 bytes/3 estimate, not Qwen tokenizer'\nmutants=[];sizes=[];summaries=[]\ndef put(x,p,v,delete=False):\n ts=p[1:].split('/');a=x\n for t in ts[:-1]:a=a[int(t)] if isinstance(a,list) else a[t]\n t=int(ts[-1]) if isinstance(a,list) else ts[-1]\n if delete:del a[t]\n else:a[t]=v\nfor gi,(g,e) in enumerate(zip(manifest['groups'],expected)):\n prompt=h.prompt_for(g)\n # Shared interface must not copy substantive policy paragraphs from the treatment context.\n for paragraph in contexts['references/channel-contract.md'].split('\\n\\n'):\n  if len(paragraph)>100 and not paragraph.startswith('#'):assert paragraph not in prompt\n for policy in ['known requires a finite amount', 'Unknown or mixed currency produces', 'Never sum GA4 and pixel populations', 'not a cross-source deduplicated people count', 'A matching local session token does not itself supply a bridge', 'Distinct known currencies without supplied conversion']:\n  assert policy.lower() not in prompt.lower(),policy\n sentinel=copy.deepcopy(g);sentinel['checks'][0]['expected']='SECRET_EXPECTATION_SENTINEL'\n assert h.prompt_for(sentinel)==prompt\n assert 'SECRET_EXPECTATION_SENTINEL' not in ''.join(contexts.values())\n assert json.loads(prompt)['input']==g['input']\n assert json.loads(prompt)['output_schema']==g['output_schema']\n assert h.system_prompt('without-skill',contexts)==h.system_prompt('without-skill',{})\n assert all(v in h.system_prompt('with-skill',contexts) for v in contexts.values())\n assert h.schema_type_ok(e,g['output_schema'])\n def evaluate(x):\n  return h.evaluate_call({'transport_exit_code':0,'raw_envelope':{'model':'qwen3:4b','done':True,'done_reason':'stop','message':{'content':json.dumps(x)}}},'qwen3:4b',g,prompt,'offline','offline',sha)\n def score(x):return sum(c['passed'] for c in evaluate(x)['check_status'])\n good=evaluate(e);assert not good['errors'];assert score(e)==len(g['checks'])\n def fail(name,p,v,delete=False,schema=False):\n  x=copy.deepcopy(e);put(x,p,v,delete);r=evaluate(x);assert score(x)<len(g['checks']),name\n  if schema:assert r['errors'] and not r['schema_status']['passed'],name\n  mutants.append(g['id']+':'+name)\n fail('wrong_case','/cases/0/case','Z')\n fail('missing_nested','/cases/0/result',None,delete=True,schema=True)\n fail('extra_nested','/cases/0/extra',True,schema=True)\n fail('extra_case','/cases',e['cases']+[e['cases'][0]])\n fail('drop_case','/cases',e['cases'][:-1])\n fail('order','/cases',list(reversed(e['cases'])))\n fail('wrong_string_type','/cases/0/case',True,schema=True)\n for n,v in [('nan',float('nan')),('infinity',float('inf')),('minus_infinity',float('-inf'))]:fail(n,'/cases/0/case',v,schema=True)\n malformed=h.evaluate_call({'transport_exit_code':0,'raw_envelope':{'model':'qwen3:4b','message':{'content':'{broken'}}},'qwen3:4b',g,prompt,'offline','offline',sha);assert malformed['errors'];mutants.append(g['id']+':malformed_json')\n if gi<2:\n  for name,p,v in [('wrong_channel','/cases/0/result/channel','Direct'),('paid_proof','/cases/0/result/paid_evidence_proven',True),('drop_raw','/cases/0/result/preserve_raw',False),('wrong_version','/cases/0/result/taxonomy_version','9'),('bool_as_int','/cases/0/result/preserve_raw',1)]:fail(name,p,v)\n else:\n  for name,p,v in [\n   ('implicit_bridge','/cases/0/result/decision/identity_bridge_established',True),\n   ('drop_scope','/cases/0/result/decision/identity_fields',['source_system','session_key','visitor_key']),\n   ('scope_equivalence','/cases/1/result/decision/same_scope_token',True),\n   ('overlap_sum','/cases/2/result/decision/can_sum_populations',True),\n   ('purchase_equivalence','/cases/2/result/decision/purchase_equivalence_established',True),\n   ('mixed_sum','/cases/3/result/money/total/value',190),\n   ('unknown_zero','/cases/4/result/money/observations/0/value',0),\n   ('legacy_status','/cases/4/result/money/total/status','unknown_or_mixed_currency'),\n   ('attribution_parity','/cases/5/result/decision/parity_established',True),\n   ('wrong_basis','/cases/5/result/decision/attribution_bases/first_party_pixel','session_last_click'),\n   ('missing_grain_scope','/cases/6/result/decision/daily_grain',['source_system','event_date','channel']),\n   ('people_equivalence','/cases/7/result/decision/cross_source_people_count',True),\n   ('missing_metric','/cases/7/result/decision/common_metrics',['sessions','new_users','key_events']),\n   ('fabricated_measurement','/cases/7/result/money/total',{'value':0,'currency':'USD','status':'known'}),\n   ('money_observation_order','/cases/3/result/money/observations',list(reversed(e['cases'][3]['result']['money']['observations'])))]:fail(name,p,v)\n for c in g['checks']:\n  if c['op']=='approximately':assert h.compare({**c,'path':''},float(c['expected']))['passed'];assert not h.compare({**c,'path':''},True)['passed']\n  if c['op']=='array_length_equals':assert not h.compare({**c,'path':''},None)['passed']\n  if isinstance(c['expected'],str):assert c['expected'] in prompt+'\\n'+'\\n'.join(contexts.values()),(g['id'],c)\n # One scalar/path check and one cardinality check for every output leaf/array.\n def paths(v,p=''):\n  if isinstance(v,list):return [(p,'array_length_equals')]+sum([paths(x,p+'/'+str(i)) for i,x in enumerate(v)],[])\n  if isinstance(v,dict):return sum([paths(x,p+'/'+k.replace('~','~0').replace('/','~1')) for k,x in v.items()],[])\n  return [(p,'approximately' if type(v) in (int,float) else 'equals')]\n assert paths(e)==[(c['path'],c['op']) for c in g['checks']]\n n=tokens(prompt+h.system_prompt('with-skill',contexts));o=tokens(json.dumps(e,indent=2,ensure_ascii=False));assert n+8192<=28000;assert o<=5000\n sizes.append({'group':g['id'],'request_system_estimated_tokens':n,'plus_8192':n+8192,'expected_output_estimated_tokens':o,'output_headroom':8192-o})\n summaries.append({'group':g['id'],'cases':len(e['cases']),'checks':len(g['checks'])})\nprint(json.dumps({'status':'passed','manifest_sha256':sha,'context_hashes':hashes,'harness_sha256':h.harness_hash(),'groups':summaries,'mutations':len(mutants),'mutation_names':mutants,'sizes':sizes,'tokenizer':tokenizer,'request_separation':'identical user prompts/types-only schema/input both conditions; sentinel hidden; context only with-skill','vocabulary_audit':'all checked strings available in input/interface/context','scalar_and_array_coverage':'complete','shared_policy_audit':'No substantive channel-contract paragraph or former leaked decision rule in either shared prompt; candidate vocabulary and shapes only, manually reviewed.'}))\n";
 const run=spawnSync(process.env.TAXONOMY_EVAL_PYTHON??'python3',['-c',python,harness,root,path.join(temp,'expected.json')],{encoding:'utf8',maxBuffer:8*1024*1024});
 assert.equal(run.status,0,run.stderr);const report=JSON.parse(run.stdout);report.native_classifications=nativeCount;report.native_outputs=nativeRecords;report.literal_expected_projections=expected;report.model_calls=0;report.sql_execution='NO SQL EXECUTED';report.pinned_sources=pins;
 report.source_hashes=Object.fromEntries(['scripts/test-eval-manifest.mjs','references/eval-cases.json','references/eval.md','references/evaluation-output-contract.md'].map(p=>[p,hash(fs.readFileSync(path.join(root,p)))]));
 if(option('--evidence'))fs.writeFileSync(option('--evidence'),JSON.stringify(report,null,2)+'\n',{flag:'wx',mode:0o600});
 console.log(JSON.stringify({status:report.status,manifest_sha256:report.manifest_sha256,groups:report.groups,mutations:report.mutations,sizes:report.sizes,native_classifications:nativeCount,model_calls:0,sql_execution:report.sql_execution},null,2));
 if(!process.argv.includes('--standalone-child')){const copy=path.join(temp,'skill');fs.mkdirSync(copy);for(const p of ['scripts','references'])fs.cpSync(path.join(root,p),path.join(copy,p),{recursive:true});fs.copyFileSync(path.join(root,'SKILL.md'),path.join(copy,'SKILL.md'));const child=spawnSync(process.execPath,[path.join(copy,'scripts/test-eval-manifest.mjs'),'--standalone-child'],{encoding:'utf8',maxBuffer:8*1024*1024,env:{...process.env,TAXONOMY_EVAL_HARNESS:harness}});assert.equal(child.status,0,child.stderr);console.log('PASS copied standalone; explicit shared scorer. NO SQL EXECUTED; no model calls.');}
}finally{fs.rmSync(temp,{recursive:true,force:true});}
