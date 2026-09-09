#!/usr/bin/env python3
"""Offline MTA manifest, projection, scorer and request-boundary tests. No model calls."""
from __future__ import annotations

import ast
import copy
import hashlib
import importlib.util
import json
import math
import re
from pathlib import Path


def load_builder():
    path = Path(__file__).with_name('build-eval-cases.py')
    spec = importlib.util.spec_from_file_location('mta_eval_builder', path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def set_pointer(value, pointer, replacement):
    parts = [part.replace('~1', '/').replace('~0', '~') for part in pointer[1:].split('/')]
    current = value
    for part in parts[:-1]:
        current = current[int(part)] if isinstance(current, list) else current[part]
    if isinstance(current, list):
        current[int(parts[-1])] = replacement
    else:
        current[parts[-1]] = replacement


def score(harness, group, output):
    prompt = harness.prompt_for(group)
    result = harness.evaluate_call({'transport_exit_code': 0, 'raw_envelope': {
        'model': 'qwen3:4b', 'message': {'content': json.dumps(output)}}, 'elapsed_seconds': 0},
        'qwen3:4b', group, prompt, 'offline-prompt', 'offline-context', 'offline-manifest')
    return sum(check['passed'] for check in result['check_status']), result


def all_nodes(schema):
    yield schema
    for value in schema.get('properties', {}).values():
        yield from all_nodes(value)
    if 'items' in schema:
        yield from all_nodes(schema['items'])


def audit_requests(builder, harness, manifest, contexts):
    # cl100k is an offline estimate, not a claim about a vendor's exact tokenizer.
    # The byte/character counts remain available when the optional tokenizer is absent.
    try:
        import tiktoken
        encoding = tiktoken.get_encoding('cl100k_base')
    except ImportError:
        encoding = None
    context_text = '\n'.join(contexts.values())
    counts = []
    for group in manifest['groups']:
        prompt = harness.prompt_for(group)
        decoded = json.loads(prompt)
        assert set(decoded) == {'prompt', 'input', 'output_schema'}
        assert decoded['input'] == group['input']
        assert decoded['output_schema'] == group['output_schema']
        assert 'checks' not in decoded and 'expected' not in decoded
        for _, selected in builder.SELECTIONS:
            for _, fixture_id in selected:
                assert fixture_id not in prompt, fixture_id
        sentinel = 'PRIVATE_EXPECTED_SENTINEL_927391'
        changed = copy.deepcopy(group)
        changed['checks'] = [{'path': '/secret', 'op': 'equals', 'expected': sentinel}]
        assert harness.prompt_for(changed) == prompt
        baseline = harness.system_prompt('without-skill', {})
        supplied = harness.system_prompt('with-skill', contexts)
        assert 'Skill context files:' not in baseline and 'Skill context files:' in supplied
        assert sentinel not in prompt + baseline + supplied
        # Strict schema object keys are public types, never per-case answer constraints.
        for node in all_nodes(group['output_schema']):
            if 'properties' in node:
                assert node['additionalProperties'] is False
                assert set(node['required']) == set(node['properties'])
        input_text = json.dumps(group['input'])
        for check in group['checks']:
            if isinstance(check['expected'], str):
                if check['path'].rsplit('/',1)[-1] in {'allocated_value','allocated_revenue','observed_spend','final_spend','cost_per_attributed_conversion','cac','roas'}:
                    assert re.fullmatch(r'-?(?:0|[1-9][0-9]*)(?:\.[0-9]*[1-9])?', check['expected']) and check['expected'] != '-0', check
                else:
                    assert check['expected'] in context_text + input_text, check
        # Account for schema appearing both in prompt and transport, plus framing overhead.
        transport_schema = json.dumps(group['output_schema'], sort_keys=True)
        row = {'group': group['id'], 'checks': len(group['checks']), 'input_cases': len(group['input']['cases']),
               'prompt_bytes': len(prompt.encode()), 'schema_bytes': len(transport_schema.encode())}
        for condition, system in [('without_skill', baseline), ('with_skill', supplied)]:
            request = system + prompt + transport_schema
            row[condition + '_request_bytes'] = len(request.encode())
            if encoding:
                estimate = len(encoding.encode(request)) + 256
                row[condition + '_cl100k_estimated_tokens'] = estimate
                row[condition + '_guarded_request_plus_8192'] = math.ceil(estimate * 1.2) + 8192
                assert row[condition + '_guarded_request_plus_8192'] < 32768, row
        counts.append(row)
    return {'context_bytes': sum(len(text.encode()) for text in contexts.values()),
            'context_sha256': {name: hashlib.sha256(text.encode()).hexdigest() for name, text in contexts.items()},
            'token_estimator': 'cl100k_base + 256 framing tokens, 20% input margin, 8192 output reserve' if encoding else 'unavailable; byte counts only',
            'groups': counts}


def main():
    builder = load_builder(); harness = builder.load_harness()
    manifest, projections = builder.build(); builder.validate(manifest, projections)
    assert builder.MANIFEST.read_text() == builder.serialized(manifest), 'stale manifest'
    loaded, _, sha = harness.validate_manifest(builder.SKILL)
    assert loaded == manifest and len(manifest['groups']) == 3
    contexts = {p: (builder.SKILL / p).read_text() for p in manifest['context_files']}
    assert manifest['context_files'] == builder.CONTEXT_FILES
    assert all('fixture' not in name and 'implementation' not in name and 'eval-cases' not in name for name in contexts)
    # Audit against immutable literal fixture inputs and projections, without importing SQL runners.
    fixtures = {family: {x['id']: x for x in builder.read_json(builder.SKILL / f'references/{family}-fixtures.json')['cases']} for family in ('ledger','metrics')}
    for group, selections in builder.SELECTIONS:
        stored = next(g for g in manifest['groups'] if g['id']==group)
        for index, (family, fixture_id) in enumerate(selections):
            raw = fixtures[family][fixture_id]
            assert stored['input']['cases'][index]['input'] == builder.neutralize(raw['input'], 'ABCD'[index])
            assert projections[group]['cases'][index]['result'] == builder.project(group, family, raw['expected'])
    tested_mutations = []
    for group in manifest['groups']:
        expected = projections[group['id']]; total, result = score(harness, group, expected)
        assert total == len(group['checks']) and not result['errors']
        assert group['checks'] == builder.checks_for(expected)
        assert not any(isinstance(c['expected'], (list,dict)) for c in group['checks'])
        equivalent = copy.deepcopy(expected)
        for check in group['checks']:
            if check['op']=='approximately' and isinstance(check['expected'],int): set_pointer(equivalent,check['path'],float(check['expected']))
        assert score(harness,group,equivalent)[0] == total
        number = next(c for c in group['checks'] if c['op']=='approximately')
        for label, value in [('nan',float('nan')),('infinity',float('inf')),('numeric-boolean',True),('numeric-string','1')]:
            changed=copy.deepcopy(expected);set_pointer(changed,number['path'],value)
            count,bad=score(harness,group,changed);assert count<total and bad['errors'];tested_mutations.append(group['id']+':'+label)
        first=next(iter(expected['cases'][0]['result']))
        for label in ('missing-nested-field','extra-nested-field','case-order','case-cardinality'):
            changed=copy.deepcopy(expected)
            if label=='missing-nested-field':del changed['cases'][0]['result'][first]
            if label=='extra-nested-field':changed['cases'][0]['result']['unexpected']=False
            if label=='case-order':changed['cases'].reverse()
            if label=='case-cardinality':changed['cases'].pop()
            assert score(harness,group,changed)[0]<total;tested_mutations.append(group['id']+':'+label)
        rows_key='allocation_ledger' if group['id']=='money-and-coverage' else 'coverage'
        for label in ('row-order','row-cardinality'):
            changed=copy.deepcopy(expected);rows=changed['cases'][0]['result'][rows_key]
            if label=='row-order':rows.reverse()
            else:rows.append(copy.deepcopy(rows[0]))
            assert score(harness,group,changed)[0]<total;tested_mutations.append(group['id']+':'+label)
    mutations=[
      ('model-credits','/cases/1/result/ledger/0/credit',0.5,'wrong-credit'),
      ('model-credits','/cases/0/result/coverage/0/eligible_touch_count',1.0,'count-float'),
      ('model-credits','/cases/0/result/diagnostics/clamped',0,'boolean-type'),
      ('conversion-boundaries','/cases/1/result/coverage/0/status','credited','repeat-credited'),
      ('conversion-boundaries','/cases/2/result/coverage/0/status','credited','unresolved-credited'),
      ('money-and-coverage','/cases/3/result/channel_metrics/0/allocated_revenue','0','unknown-zero'),
      ('money-and-coverage','/cases/2/result/channel_metrics/0/final_spend','25','partial-known'),
      ('money-and-coverage','/cases/1/result/allocation_ledger/0/allocated_value','-100','primary-money'),
      ('money-and-coverage','/cases/1/result/channel_metrics/0/roas','4','refund-sign'),
      ('money-and-coverage','/cases/0/result/allocation_ledger/0/allocated_value','0.000000001','rounding-endpoint'),
      ('money-and-coverage','/cases/0/result/channel_metrics/0/allocated_revenue','0','conservation'),
      ('money-and-coverage','/cases/1/result/channel_metrics/0/final_spend','50','join-inflation'),
      ('money-and-coverage','/cases/2/result/channel_metrics/0/cost_reason',None,'reason'),
      ('money-and-coverage','/cases/0/result/allocation_ledger/0/allocated_value',0,'money-numeric-type'),
      ('money-and-coverage','/cases/0/result/channel_metrics/0/allocated_revenue','1e-9','money-exponent'),
      ('money-and-coverage','/cases/1/result/channel_metrics/0/allocated_revenue','-100.0','money-noncanonical'),
    ]
    groups={g['id']:g for g in manifest['groups']}
    for group,path,value,label in mutations:
        changed=copy.deepcopy(projections[group]);set_pointer(changed,path,value)
        assert score(harness,groups[group],changed)[0]<len(groups[group]['checks']),label
        tested_mutations.append(group+':'+label)
    audit=audit_requests(builder,harness,manifest,contexts)
    # Goldens also fit the output reserve; this is capacity evidence, not completion evidence.
    try:
        import tiktoken
        encoding=tiktoken.get_encoding('cl100k_base')
        for row in audit['groups']:
            row['compact_expected_output_estimated_tokens']=len(encoding.encode(json.dumps(projections[row['group']],separators=(',',':'))))
            row['pretty_expected_output_estimated_tokens']=len(encoding.encode(json.dumps(projections[row['group']],indent=2)))
            row['pretty_output_plus_20_percent']=math.ceil(row['pretty_expected_output_estimated_tokens']*1.2)
            assert row['pretty_output_plus_20_percent']<8192,row
    except ImportError: pass
    evaluation_doc=(builder.SKILL/'references/eval.md').read_text()
    assert sha in evaluation_doc and harness.harness_hash() in evaluation_doc
    assert f"{audit['context_bytes']:,} UTF-8 bytes" in evaluation_doc
    for name,digest in audit['context_sha256'].items():assert name in evaluation_doc and digest in evaluation_doc
    if audit['token_estimator']!='unavailable; byte counts only':
        for row in audit['groups']:
            table='| '+row['group']+' | '+' | '.join(f"{row[k]:,}" for k in ('without_skill_cl100k_estimated_tokens','with_skill_cl100k_estimated_tokens','with_skill_guarded_request_plus_8192'))+' |'
            assert table in evaluation_doc,'stale token audit'
    audit.update(manifest_sha256=sha,total_checks=sum(len(g['checks']) for g in manifest['groups']),all_projected_cases=12,targeted_mutations=len(tested_mutations),model_calls=0)
    print(json.dumps(audit,indent=2,sort_keys=True))
    print('PASS MTA projections, scalar/array coverage, real scorer and request separation; NO SQL EXECUTED; NO MODEL CALLS')
if __name__=='__main__':main()
