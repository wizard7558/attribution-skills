#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { buildManifest, GROUPS, writeManifest } from './build-eval-cases.mjs';

const here = path.dirname(new URL(import.meta.url).pathname);
const skillDir = path.resolve(here, '..');
const repoDir = path.resolve(skillDir, '../..');
const manifestPath = path.join(skillDir, 'references/eval-cases.json');
const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
assert.deepEqual(manifest, buildManifest(), 'manifest is stale; run build-eval-cases.mjs');
assert.deepEqual(manifest.context_files, ['SKILL.md', 'references/stage-contract.md', 'references/cost-contract.md', 'references/refresh-contract.md']);
assert.deepEqual(manifest.groups.map((g) => g.id), GROUPS.map((g) => g.id));
assert.deepEqual(manifest.groups.map((g) => g.input.cases.length), [4, 3, 3]);
assert.ok(manifest.groups.every((g) => g.input.cases.every((c, i) => c.case_id === String.fromCharCode(65 + i))));
assert.ok(manifest.groups.every((g) => g.input.cases.every((c) => !JSON.stringify(c.input).includes(g.id))));

// Literal source paths are mandatory: deleting a selected projection or changing its pointer
// must fail regeneration instead of silently learning a new answer or coercing it to null.
const fixtureFiles = Object.fromEntries(['stage-fixtures.json', 'cost-fixtures.json', 'refresh-fixtures.json'].map((file) => [file, JSON.parse(fs.readFileSync(path.join(skillDir, 'references', file), 'utf8')).cases]));
const missingLiteral = structuredClone(fixtureFiles);
delete missingLiteral['stage-fixtures.json'].find((f) => f.id === 'complete-snapshot-stage-gaps').expected.ledger;
assert.throws(() => buildManifest(missingLiteral), /Missing literal expected path/);
const changedPointer = structuredClone(fixtureFiles);
changedPointer['cost-fixtures.json'].find((f) => f.id === 'all-five-buckets').expected.report = undefined;
assert.throws(() => buildManifest(changedPointer), /Missing literal expected path/);
const changedLiteral = structuredClone(fixtureFiles);
changedLiteral['stage-fixtures.json'].find((f) => f.id === 'all-wins-survive-later-loss').expected.ledger[0].lead_key = '__changed__';
assert.throws(() => buildManifest(changedLiteral), /Pinned projection drift/);
const nonFiniteMoney = structuredClone(fixtureFiles);
nonFiniteMoney['stage-fixtures.json'].find((f) => f.id === 'all-wins-survive-later-loss').expected.ledger[3].value = Number.NaN;
assert.throws(() => buildManifest(nonFiniteMoney), /Invalid finite number/);
const infiniteMoney = structuredClone(fixtureFiles);
infiniteMoney['cost-fixtures.json'].find((f) => f.id === 'all-five-buckets').expected.report[2].spend = Number.POSITIVE_INFINITY;
assert.throws(() => buildManifest(infiniteMoney), /Invalid finite number/);
const wrongBoolean = structuredClone(fixtureFiles);
wrongBoolean['refresh-fixtures.json'].find((f) => f.id === 'late-won-rewrite-preserves-unaffected').expected.replacement_ledger[0].ledger.achieved = 'true';
assert.throws(() => buildManifest(wrongBoolean), /Invalid boolean/);
const missingNestedValue = structuredClone(fixtureFiles);
delete missingNestedValue['stage-fixtures.json'].find((f) => f.id === 'complete-snapshot-stage-gaps').expected.ledger[0].value;
assert.throws(() => buildManifest(missingNestedValue), /Invalid finite number/);
const explicitNullBoolean = structuredClone(fixtureFiles);
explicitNullBoolean['stage-fixtures.json'].find((f) => f.id === 'complete-snapshot-stage-gaps').expected.ledger[0].achieved = null;
assert.throws(() => buildManifest(explicitNullBoolean), /Pinned projection drift/);
const v1Path = path.join(skillDir, 'references/eval-cases-v1.json');
const v1Bytes = fs.readFileSync(v1Path);
assert.equal(crypto.createHash('sha256').update(v1Bytes).digest('hex'), '291dbf45c132f150b4be686b2319a3078b9ecd4981e212e25a1a6c1810c8f21d');
const v1 = JSON.parse(v1Bytes);
assert.deepEqual(manifest.context_files, v1.context_files);
for (const [index, g] of manifest.groups.entries()) {
  const prior = v1.groups[index];
  for (const key of ['id', 'prompt', 'input', 'output_schema']) assert.deepEqual(g[key], prior[key], `${key} must remain unchanged`);
  assert.ok(g.output_schema.properties.cases.items.properties.output.type === 'object');
  assert.ok(g.checks.some((c) => c.path === '/cases' && c.op === 'array_length_equals'));
  assert.ok(g.checks.every((c) => ['equals', 'approximately', 'array_length_equals'].includes(c.op)));
  assert.ok(g.checks.every((c) => /^(\/cases|\/cases\/\d+\/(case_id|output(?:\/[^/]+)*))$/.test(c.path)));
  assert.ok(g.checks.every((c) => ['fixture-literal', 'manifest-literal'].includes(c.provenance)));
  assert.ok(g.checks.every((c) => c.expected === null || typeof c.expected !== 'object'));
  for (const c of g.checks) {
    if (c.op === 'approximately') { assert.equal(c.tolerance, 1e-9); assert.match(c.path, /\/(value|revenue|spend|cost_per_stage)$/); }
    if (c.expected === null) assert.equal(c.op, 'equals');
  }
  const output = g.output_schema.properties.cases.items.properties.output;
  assert.equal(output.additionalProperties, false);
  assert.deepEqual(output.required, Object.keys(output.properties));
  for (const field of Object.values(output.properties)) {
    if (field.type === 'array' && field.items?.type === 'object') {
      assert.equal(field.items.additionalProperties, false);
      assert.deepEqual(field.items.required, Object.keys(field.items.properties));
    }
  }
}

// Use the real accepted scorer and immutable v1 literal projections. No expected
// result is learned from a model response or reconstructed from current checks.
const scorer = `import copy,importlib.util,json,pathlib,sys
spec=importlib.util.spec_from_file_location('h','scripts/run-skill-evals.py'); h=importlib.util.module_from_spec(spec); spec.loader.exec_module(h)
m=json.loads(pathlib.Path(sys.argv[1]).read_text()); old=json.loads(pathlib.Path(sys.argv[2]).read_text())
checks_run=0
def require(value):
 global checks_run
 checks_run+=1
 assert value

def assign(obj,pointer,value):
 parts=pointer.split('/')[1:]; target=obj
 for part in parts[:-1]: target=target[int(part)] if isinstance(target,list) else target[part]
 if isinstance(target,list): target[int(parts[-1])]=value
 else: target[parts[-1]]=value

def score(g,p):
 return h.schema_type_ok(p,g['output_schema']) and all(h.compare(c,p)['passed'] for c in g['checks'])

for g,prior in zip(m['groups'],old['groups']):
 p={'cases':next(c['expected'] for c in prior['checks'] if c['path']=='/cases')}
 require(score(g,p))
 expected_paths={}
 object_paths=[]
 def visit(value,path):
  if isinstance(value,list):
   expected_paths[path]=('array_length_equals',len(value))
   for i,item in enumerate(value):visit(item,path+'/'+str(i))
  elif isinstance(value,dict):
   object_paths.append(path)
   for k,item in value.items():visit(item,path+'/'+k)
  else:
   money=path.split('/')[-1] in {'value','revenue','spend','cost_per_stage'} and type(value) in (int,float)
   expected_paths[path]=('approximately' if money else 'equals',value)
 visit(p['cases'],'/cases')
 require(len(expected_paths)==len(g['checks']))
 require(set(expected_paths)=={c['path'] for c in g['checks']})
 for c in g['checks']:
  op,expected=expected_paths[c['path']]
  require(c['op']==op and h.strict_equal(c['expected'],expected))
  require(h.compare(c,p)['passed'])
  bad=copy.deepcopy(p);assign(bad,c['path'],'__mutated__')
  require(not h.compare(c,bad)['passed'])
  if c['op']=='array_length_equals':
   found,rows=h.json_pointer(p,c['path']);require(found and isinstance(rows,list))
   bad=copy.deepcopy(p);assign(bad,c['path'],rows+[copy.deepcopy(rows[-1]) if rows else '__extra__'])
   require(not score(g,bad))
   if rows:
    bad=copy.deepcopy(p);assign(bad,c['path'],rows[:-1]);require(not score(g,bad))
   if len(rows)>1:
    reordered=list(reversed(rows));require(reordered!=rows)
    bad=copy.deepcopy(p);assign(bad,c['path'],reordered);require(not score(g,bad))
  elif c['op']=='approximately':
   same=copy.deepcopy(p);assign(same,c['path'],float(c['expected']));require(score(g,same))
   for value in [None,True,'5.0',float('nan'),float('inf'),-float('inf'),c['expected']+1e-8]:
    bad=copy.deepcopy(p);assign(bad,c['path'],value);require(not score(g,bad))
   if c['expected']!=0:
    bad=copy.deepcopy(p);assign(bad,c['path'],-c['expected']);require(not score(g,bad))
  elif c['expected'] is None:
   bad=copy.deepcopy(p);assign(bad,c['path'],0);require(not score(g,bad))
  elif type(c['expected']) is bool:
   for value in [not c['expected'],int(c['expected']),None]:
    bad=copy.deepcopy(p);assign(bad,c['path'],value);require(not score(g,bad))
  elif type(c['expected']) is int:
   for value in [float(c['expected']),bool(c['expected']),c['expected']+1]:
    bad=copy.deepcopy(p);assign(bad,c['path'],value);require(not score(g,bad))
  elif c['path'].endswith(('/currency','/revenue_currency','/spend_currency','/cost_status','/value_status','/stage_truth_status')):
   bad=copy.deepcopy(p);assign(bad,c['path'],'__wrong_currency_or_status__');require(not score(g,bad))
 # Required/additionalProperties enforce objects without whole-object equality.
 for path in object_paths:
  found,obj=h.json_pointer(p,path);require(found)
  extra=copy.deepcopy(obj);extra['__extra_key__']=0
  bad=copy.deepcopy(p);assign(bad,path,extra);require(not score(g,bad))
  missing=copy.deepcopy(obj);del missing[next(iter(missing))]
  bad=copy.deepcopy(p);assign(bad,path,missing);require(not score(g,bad))
 # A caller-asserted row count cannot replace an actual array.
 first_array=next(c for c in g['checks'] if c['op']=='array_length_equals' and c['path']!='/cases')
 bad=copy.deepcopy(p);assign(bad,first_array['path'],{'count':first_array['expected']});require(not score(g,bad))

five={'path':'/money','op':'approximately','expected':5,'tolerance':1e-9}
require(h.compare(five,json.loads('{"money":5}'))['passed'])
require(h.compare(five,json.loads('{"money":5.0}'))['passed'])
require(not h.compare({'path':'/flag','op':'equals','expected':True},{'flag':1})['passed'])
print('PASS revised real scorer: '+str(checks_run)+' assertions; complete array/scalar coverage, monetary spelling equivalence, structural/cardinality/order/type/null/sign/status mutations')`;
const scored = spawnSync('python3', ['-c', scorer, manifestPath, v1Path], { cwd: repoDir, encoding: 'utf8' });
assert.equal(scored.status, 0, scored.stdout + scored.stderr);
process.stdout.write(scored.stdout);
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'funnel-eval-'));
const target = path.join(temp, 'eval-cases.json'); writeManifest({ target }); writeManifest({ check: true, target });
fs.appendFileSync(target, '\n'); assert.throws(() => writeManifest({ check: true, target }), /stale/); fs.rmSync(temp, { recursive: true, force: true });
console.log('PASS funnel evaluation manifest: fixed neutral groups, immutable v1 semantics, unchanged prompts/input/schema, freshness, and revised mutation-sensitive checks');
