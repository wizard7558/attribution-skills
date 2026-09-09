#!/usr/bin/env python3
"""Build fixed MTA projections from accepted literal goldens; no SQL or model calls."""
from __future__ import annotations
import argparse
import copy
import hashlib
import importlib.util
import json
from pathlib import Path

SKILL = Path(__file__).resolve().parents[1]
MANIFEST = SKILL / 'references/eval-cases.json'
CONTEXT_FILES = ['SKILL.md', 'references/ledger-contract.md', 'references/metrics-contract.md', 'references/evaluation-output-contract.md']
SELECTIONS = [
 ('model-credits', [('ledger', x) for x in ('one-touch-all-models', 'two-touch-fractional-decay', 'four-touch-qualified-provenance', 'full-window-microsecond-inclusive')]),
 ('conversion-boundaries', [('ledger', x) for x in ('segmented-history-outside-report', 'acquisition-first-observed-outside-report', 'null-subjects-tagged-collision-protection', 'no-lookback-touch-and-unresolved-touch')]),
 ('money-and-coverage', [('metrics', x) for x in ('thirds-one-unit', 'signed-refund', 'partial-observed', 'spend-only-uncredited')]),
]
PROMPTS = {
 'model-credits': 'For each labeled raw input, apply the five attribution models and return the specified ledger, coverage and diagnostics projection. Preserve qualified identities and deterministic native output order. Return only the required JSON.',
 'conversion-boundaries': 'For each labeled raw input, apply its declared conversion window and all five attribution models, then return the specified ledger, coverage and diagnostics projection. Preserve uncovered conversions and deterministic native output order. Return only the required JSON.',
 'money-and-coverage': 'For each labeled raw input, consume its selected ledger and coverage with the declared source memberships and spend. Return the specified monetary allocation, channel metrics and uncredited coverage projection in deterministic native output order. Return only the required JSON.',
}
QUALIFIED = ('source_system', 'source_scope', 'conversion_key')
TOUCH = ('touch_source_system', 'touch_source_scope', 'touch_key')
LEDGER = QUALIFIED + TOUCH + ('model', 'credit')
COVERAGE = QUALIFIED + ('model', 'eligible_touch_count', 'total_credit', 'status')
DIAGNOSTICS = ('requested_lookback_days', 'effective_lookback_days', 'clamped', 'future_touches_excluded', 'future_conversions_excluded', 'outside_report_conversions', 'unresolved_touch_count')
ALLOCATION = LEDGER + ('allocated_value', 'allocated_currency', 'allocation_status')
METRICS = ('event_date', 'channel', 'credited_conversion_count', 'qualified_conversion_count', 'qualified_touch_count', 'zero_credit_row_count', 'row_kind', 'revenue_status', 'revenue_currency', 'allocated_revenue', 'spend_fact_count', 'observed_spend_status', 'observed_spend_currency', 'observed_spend', 'spend_status', 'spend_currency', 'final_spend', 'spend_reason', 'cost_reason', 'roas_reason', 'revenue_reason', 'cost_per_attributed_conversion', 'cac', 'cac_reason', 'roas')
UNCREDITED = QUALIFIED + ('model', 'status')
FLOAT_FIELDS = {'credit', 'total_credit', 'credited_conversion_count'}
COUNT_FIELDS = set(DIAGNOSTICS) - {'clamped'} | {'eligible_touch_count', 'qualified_conversion_count', 'qualified_touch_count', 'zero_credit_row_count', 'spend_fact_count'}
NULLABLE_FIELDS = {'allocated_value', 'allocated_currency', 'revenue_currency', 'allocated_revenue', 'observed_spend_currency', 'observed_spend', 'spend_currency', 'final_spend', 'spend_reason', 'cost_reason', 'roas_reason', 'revenue_reason', 'cost_per_attributed_conversion', 'cac', 'cac_reason', 'roas'}
CHECK_COUNTS = {'model-credits': 541, 'conversion-boundaries': 366, 'money-and-coverage': 199}

def read_json(path):
 return json.loads(path.read_text(), parse_constant=lambda x: (_ for _ in ()).throw(ValueError('nonfinite JSON')))
def obj(properties):
 return {'type':'object', 'properties':properties, 'required':list(properties), 'additionalProperties':False}
def arr(items):
 return {'type':'array', 'items':items}
def fields_schema(fields):
 return obj({k:{'type': ['string','null'] if k in NULLABLE_FIELDS else 'number' if k in FLOAT_FIELDS else 'integer' if k in COUNT_FIELDS else 'boolean' if k=='clamped' else 'string'} for k in fields})
def schemas():
 ledger = obj({'ledger':arr(fields_schema(LEDGER)), 'coverage':arr(fields_schema(COVERAGE)), 'diagnostics':fields_schema(DIAGNOSTICS)})
 money = obj({'allocation_ledger':arr(fields_schema(ALLOCATION)), 'channel_metrics':arr(fields_schema(METRICS)), 'uncredited_coverage':arr(fields_schema(UNCREDITED))})
 return {key:obj({'cases':arr(obj({'case':{'type':'string'},'result':money if key=='money-and-coverage' else ledger}))}) for key in PROMPTS}
def take(row, fields):
 return {key:copy.deepcopy(row[key]) for key in fields}
def project(group, family, expected):
 if family=='ledger':
  return {'ledger':[take(x,LEDGER) for x in expected['ledger']], 'coverage':[take(x,COVERAGE) for x in expected['coverage']], 'diagnostics':take(expected['diagnostics'],DIAGNOSTICS)}
 return {'allocation_ledger':[take(x,ALLOCATION) for x in expected['allocation_ledger']], 'channel_metrics':[take(x,METRICS) for x in expected['channel_metrics']], 'uncredited_coverage':[take(x,UNCREDITED) for x in expected['uncredited_coverage']]}
def neutralize(value, label):
 if isinstance(value,dict):
  return {key:label if key=='invocation_key' else neutralize(child,label) for key,child in value.items()}
 if isinstance(value,list): return [neutralize(x,label) for x in value]
 return copy.deepcopy(value)
def checks_for(value,path=''):
 if isinstance(value,dict): return [c for k,v in value.items() for c in checks_for(v,path+'/'+str(k).replace('~','~0').replace('/','~1'))]
 if isinstance(value,list): return [{'path':path,'op':'array_length_equals','expected':len(value)}]+[c for i,v in enumerate(value) for c in checks_for(v,path+'/'+str(i))]
 floating=path.rsplit('/',1)[-1] in FLOAT_FIELDS
 return [{'path':path,'op':'approximately' if floating else 'equals','expected':value,**({'tolerance':1e-12} if floating else {})}]
def build():
 fixtures={family:{x['id']:x for x in read_json(SKILL/f'references/{family}-fixtures.json')['cases']} for family in ('ledger','metrics')}
 groups=[]; projections={}; shapes=schemas()
 for group,selection in SELECTIONS:
  inputs=[];outputs=[]
  for label,(family,name) in zip('ABCD',selection):
   fixture=fixtures[family][name]
   inputs.append({'case':label,'input':neutralize(fixture['input'],label)})
   outputs.append({'case':label,'result':project(group,family,fixture['expected'])})
  expected={'cases':outputs};projections[group]=expected
  groups.append({'id':group,'prompt':PROMPTS[group],'input':{'cases':inputs},'output_schema':shapes[group],'checks':checks_for(expected)})
 return {'context_files':CONTEXT_FILES,'groups':groups},projections
def serialized(value): return json.dumps(value,indent=2,sort_keys=True,allow_nan=False)+'\n'
def load_harness():
 spec=importlib.util.spec_from_file_location('mta_harness',SKILL.parents[1]/'scripts/run-skill-evals.py');m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m);return m
def validate(manifest,projections):
 h=load_harness();assert set(manifest)=={'context_files','groups'};assert manifest['context_files']==CONTEXT_FILES
 assert [g['id'] for g in manifest['groups']]==list(PROMPTS)
 for group in manifest['groups']:
  output=projections[group['id']]
  assert [x['case'] for x in group['input']['cases']]==list('ABCD')
  assert [x['case'] for x in output['cases']]==list('ABCD')
  if CHECK_COUNTS: assert len(group['checks'])==CHECK_COUNTS[group['id']]
  h.validate_types_only_schema(group['output_schema'],group['id']);h.ensure_finite(output)
  assert h.schema_type_ok(output,group['output_schema']);assert group['checks']==checks_for(output)
  for check in group['checks']: h.validate_check(check,group['id']);assert h.compare(check,output)['passed'],check

def main():
 p=argparse.ArgumentParser(description=__doc__);p.add_argument('--check',action='store_true');args=p.parse_args()
 manifest,projections=build();validate(manifest,projections);text=serialized(manifest)
 if args.check:
  assert MANIFEST.is_file() and MANIFEST.read_text()==text,'stale manifest; run build-eval-cases.py'
 else: MANIFEST.write_text(text)
 print('PASS deterministic MTA manifest; 3 groups / 12 cases; NO SQL EXECUTED; NO MODEL CALLS')
 print('SHA256',hashlib.sha256(text.encode()).hexdigest());print('Checks', {g['id']:len(g['checks']) for g in manifest['groups']})
if __name__=='__main__':main()
