import catalog from '../references/sql-rendering-schemas.json' with {type:'json'};
import {createHash} from 'node:crypto';
import {types} from 'node:util';
const own=(x,k)=>Object.hasOwn(x,k),fail=()=>{throw new TypeError('Invalid audit SQL rendering input');};
const sha=s=>createHash('sha256').update(s).digest('hex');
function capture(x,active=new Set()){
 if(x===null||typeof x==='boolean'||typeof x==='string')return x;
 if(typeof x==='number'){if(!Number.isFinite(x))fail();return x;}
 if(typeof x!=='object'||types.isProxy(x)||active.has(x))fail();const arr=Array.isArray(x);if(!arr&&![Object.prototype,null].includes(Object.getPrototypeOf(x)))fail();active.add(x);const result=arr?[]:{};
 for(const key of Reflect.ownKeys(x)){if(typeof key!=='string')fail();if(arr&&key==='length')continue;const d=Object.getOwnPropertyDescriptor(x,key);if(!d.enumerable||!own(d,'value')||(arr&&!/^(0|[1-9]\d*)$/.test(key)))fail();Object.defineProperty(result,key,{value:capture(d.value,active),enumerable:true,writable:true,configurable:true});}
 if(arr&&(result.length!==x.length||Object.keys(result).length!==x.length))fail();active.delete(x);return result;
}
function object(x){if(x===null||typeof x!=='object'||Array.isArray(x))fail();}
function shape(x,keys){object(x);if(Object.keys(x).sort().join('\0')!==[...keys].sort().join('\0'))fail();}
const scalarTypes=new Set(['STRING','BOOL','INT64','FLOAT64','NUMERIC','BIGNUMERIC','DATE','TIMESTAMP','DATETIME','TIME','BYTES','GEOGRAPHY','JSON']);
function typeName(t){if(Array.isArray(t)){if(t.length!==1)fail();return 'ARRAY<'+typeName(t[0])+'>';}
 if(t&&typeof t==='object'){if(!Object.keys(t).length)fail();return 'STRUCT<'+Object.entries(t).map(([k,v])=>{if(!/^[A-Za-z_][A-Za-z0-9_]*$/.test(k))fail();return k+' '+typeName(v);}).join(',')+'>';}
 if(!scalarTypes.has(t))fail();return t;
}
for(const e of Object.values(catalog.entries))for(const s of Object.values(e.tables??{parameters:e.parameters}))for(const t of Object.values(s))typeName(t);
function quote(s){if(typeof s!=='string')fail();let out="'";for(const c of s){const n=c.codePointAt(0);if(n>=0xd800&&n<=0xdfff)fail();if(c==='\\'||c==="'")out+='\\'+c;else if(n<32||(n>=127&&n<=159))out+='\\u'+n.toString(16).padStart(4,'0');else out+=c;}return out+"'";}
const decimal=/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/;
function numeric(v,t){if(typeof v==='number'){if(!Number.isFinite(v)||(t==='INT64'&&!Number.isSafeInteger(v)))fail();return String(v);}
 if(typeof v!=='string'||!(t==='INT64'?/^[+-]?\d+$/:decimal).test(v))fail();if(t==='FLOAT64'&&!Number.isFinite(Number(v)))fail();return v;
}
function literal(v,t){const name=typeName(t);if(v===null)return 'CAST(NULL AS '+name+')';
 if(Array.isArray(t)){if(!Array.isArray(v))fail();return v.length?'['+v.map(x=>literal(x,t[0])).join(',')+']':name+'[]';}
 if(t&&typeof t==='object'){object(v);return 'STRUCT('+Object.entries(t).map(([k,s])=>{if(!own(v,k))fail();return literal(v[k],s)+' AS '+k;}).join(',')+')';}
 if(t==='BOOL'){if(typeof v!=='boolean')fail();return v?'TRUE':'FALSE';}
 if(['INT64','NUMERIC','BIGNUMERIC','FLOAT64'].includes(t))return 'CAST('+quote(numeric(v,t))+' AS '+t+')';
 return 'CAST('+quote(v)+' AS '+t+')';
}
function table(name,rows,schema,namespace,metadata){if(!Array.isArray(rows))fail();const hasNamespace=own(schema,'invocation_key');
 const select=(r,empty=false)=>{object(r);return 'SELECT '+Object.entries(schema).map(([key,t])=>{let value;if(empty)value=null;else if(key==='invocation_key'&&hasNamespace){if(own(r,key)&&r[key]!==namespace)fail();value=namespace;}else{if(!own(r,key))fail();value=r[key];}return literal(value,t)+' AS '+key;}).join(', ');};
 metadata.table_projections.push({table:name,row_count:rows.length,columns:Object.keys(schema)});if(hasNamespace)metadata.namespace_copies.push({table:name,row_count:rows.length,from:'configuration.invocation_key',value:namespace});
 return 'CREATE TEMP TABLE '+name+' AS\n'+(rows.length?rows.map(r=>select(r)).join('\nUNION ALL\n'):select({},true)+' FROM UNNEST(ARRAY<INT64>[])')+';';
}
function parameterType(t){if(Array.isArray(t))return {type:'ARRAY',arrayType:parameterType(t[0])};return {type:typeName(t)};}
function parameterValue(v,t){if(v===null)return {value:null};if(Array.isArray(t)){if(!Array.isArray(v))fail();return {arrayValues:v.map(x=>parameterValue(x,t[0]))};}if(typeof v!=='string')fail();quote(v);return {value:v};}
const marker=/-- BEGIN REPLACEABLE INPUTS[\s\S]*?-- END REPLACEABLE INPUTS/g;
export function renderAuditSql(entryKey,sourceSql,rawInput){
 const input=capture(rawInput);if(typeof entryKey!=='string'||!own(catalog.entries,entryKey)||typeof sourceSql!=='string')fail();const entry=catalog.entries[entryKey];if(sha(sourceSql)!==entry.source_sha256)fail();
 const metadata={contract_version:catalog.contract_version,entry_key:entryKey,source_sha256:sha(sourceSql),query_sha256:null,captured_input:input,namespace_copies:[],table_projections:[],parameter_names:[],limits:['rendering_only_no_sql_executed','no_semantic_recomputation','monetary_numbers_preserve_only_existing_javascript_precision']};
 let query=sourceSql,queryParameters=[],parameterMode=null;
 if(entry.mode==='parameters'){
  shape(input,Object.keys(entry.parameters));parameterMode='NAMED';queryParameters=Object.entries(entry.parameters).map(([name,t])=>({name,parameterType:parameterType(t),parameterValue:parameterValue(input[name],t)}));metadata.parameter_names=Object.keys(entry.parameters);
 }else if(entry.mode==='crm'){
  shape(input,['leads','options']);object(input.options);if(!Array.isArray(input.leads))fail();input.leads.forEach(object);
  const configuration=table('crm_configuration',[{options_json:JSON.stringify(input.options)}],entry.tables.crm_configuration,null,metadata);
  const leads=table('crm_lead_input',input.leads.map((lead,input_position)=>({input_position,lead_json:JSON.stringify(lead)})),entry.tables.crm_lead_input,null,metadata);
  // These exact boundaries are pinned by source hash. No UDF/body regeneration.
  const start=sourceSql.indexOf('CREATE TEMP TABLE crm_configuration AS\n'),end=sourceSql.indexOf('\n\nASSERT ',start);if(start<0||end<0)fail();const block=sourceSql.slice(start,end);if(!block.includes('CREATE TEMP TABLE crm_lead_input AS\n'))fail();query=sourceSql.slice(0,start)+configuration+'\n'+leads+sourceSql.slice(end);
 }else if(entry.mode==='marked'){
  shape(input,Object.values(entry.input_keys));object(input.configuration);if(!own(input.configuration,'invocation_key')||typeof input.configuration.invocation_key!=='string')fail();const namespace=input.configuration.invocation_key;
  const tables=Object.entries(entry.tables).map(([name,schema])=>table(name,name===entry.configuration_table?[input.configuration]:input[entry.input_keys[name]],schema,namespace,metadata)).join('\n');
  if([...sourceSql.matchAll(marker)].length!==1)fail();query=sourceSql.replace(marker,()=>`-- BEGIN REPLACEABLE INPUTS\n${tables}\n-- END REPLACEABLE INPUTS`);
 }else fail();
 metadata.query_sha256=sha(query);return {query,queryParameters,parameterMode,resultKind:entry.result_kind,renderingMetadata:metadata};
}
