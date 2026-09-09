#!/usr/bin/env python3
"""Offline MMM manifest, projection, scorer and request-boundary tests. No model calls."""
from __future__ import annotations

import ast
import copy
import hashlib
import importlib.util
import json
import math
from pathlib import Path


def load_builder():
    path = Path(__file__).with_name('build-eval-cases.py')
    spec = importlib.util.spec_from_file_location('mmm_eval_builder', path)
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
    builder = load_builder()
    harness = builder.load_harness()
    manifest, projections = builder.build()
    builder.validate(manifest, projections)
    assert builder.MANIFEST.read_text() == builder.serialized(manifest), 'stale deterministic manifest'
    loaded, _, sha = harness.validate_manifest(builder.SKILL)
    assert loaded == manifest and len(manifest['groups']) == 3
    assert sum(len(g['input']['cases']) for g in manifest['groups']) == 12
    contexts = {path: (builder.SKILL / path).read_text() for path in manifest['context_files']}
    assert manifest['context_files'] == builder.CONTEXT_FILES
    assert all('fixture' not in name and 'implementation' not in name and 'eval-cases' not in name for name in contexts)
    output_contract = contexts['references/evaluation-output-contract.md']
    for filename, constants in [('weekly_mlr.py', ['_LIMITS']), ('response_curves.py', ['_LIMITS']),
                                 ('framing.py', ['_SHARE_LIMITS', '_BAND_LIMITS'])]:
        tree = ast.parse((builder.SKILL / 'scripts' / filename).read_text())
        literals = {target.id: ast.literal_eval(node.value) for node in tree.body if isinstance(node, ast.Assign)
                    for target in node.targets if isinstance(target, ast.Name) and target.id in constants}
        assert set(literals) == set(constants)
        for literal in literals.values():
            assert json.dumps(literal, separators=(',', ':')) in output_contract, (filename, literal)
    tested_mutations = []
    for group in manifest['groups']:
        expected = projections[group['id']]
        assert group['checks'] == builder.checks_for(expected)
        assert not any(isinstance(c['expected'], (dict, list)) for c in group['checks'])
        total, result = score(harness, group, expected)
        assert total == len(group['checks']) and not result['errors'], group['id']
        equivalent = copy.deepcopy(expected)
        for check in group['checks']:
            if check['op'] == 'approximately' and isinstance(check['expected'], int):
                set_pointer(equivalent, check['path'], float(check['expected']))
        assert score(harness, group, equivalent)[0] == total, 'int/float numeric equivalence'
        # One representative missing nested field, nonfinite scalar, numeric bool, and extra field per group.
        number = next(c for c in group['checks'] if c['op'] == 'approximately')
        for label, value in [('nan', float('nan')), ('infinity', float('inf')), ('wrong-numeric-boolean', True), ('numeric-string', '5')]:
            changed = copy.deepcopy(expected)
            set_pointer(changed, number['path'], value)
            count, bad = score(harness, group, changed)
            assert count < total and bad['errors'], (group['id'], label)
            tested_mutations.append(group['id'] + ':' + label)
        changed = copy.deepcopy(expected)
        del changed['cases'][0]['result']['status' if group['id'] != 'response-and-assumptions' else 'bands']
        assert score(harness, group, changed)[0] < total
        tested_mutations.append(group['id'] + ':missing-nested-field')
        changed = copy.deepcopy(expected)
        changed['cases'][0]['result']['unexpected'] = False
        assert score(harness, group, changed)[0] < total
        tested_mutations.append(group['id'] + ':extra-nested-field')
        for label, transform in [('case-order', lambda cases: list(reversed(cases))),
                                 ('case-cardinality', lambda cases: cases[:-1])]:
            changed = copy.deepcopy(expected)
            changed['cases'] = transform(changed['cases'])
            assert score(harness, group, changed)[0] < total, label
            tested_mutations.append(group['id'] + ':' + label)
    groups = {g['id']: g for g in manifest['groups']}
    mutations = [
        ('regression-guards', '/cases/1/result/channel_coefficients/0/coefficient', 2, 'wrong-sign'),
        ('regression-guards', '/cases/0/result/diagnostics/n', 4.0, 'noninteger-count'),
        ('response-and-assumptions', '/cases/2/result/bands/lower_delta', -15, 'unordered-negative-band'),
        ('response-and-assumptions', '/cases/3/result/bands/reason', 'confidence_interval', 'wrong-reason'),
        ('observational-shares', '/cases/0/result/channels/0/factor/value', 0.5, 'inverted-factor'),
        ('observational-shares', '/cases/0/result/channels/0/adjusted_cpa/value', 20, 'multiplied-adjustment'),
        ('observational-shares', '/cases/2/result/diagnostics/crm/complete', 0, 'wrong-boolean-type'),
        ('observational-shares', '/cases/2/result/diagnostics/crm/complete', True, 'wrong-boolean-value'),
    ]
    for group_id, path, value, label in mutations:
        changed = copy.deepcopy(projections[group_id])
        set_pointer(changed, path, value)
        assert score(harness, groups[group_id], changed)[0] < len(groups[group_id]['checks']), label
        tested_mutations.append(group_id + ':' + label)
    for label, transform in [('channel-order', lambda rows: rows[::-1]), ('channel-cardinality', lambda rows: rows + [rows[0]])]:
        changed = copy.deepcopy(projections['observational-shares'])
        changed['cases'][0]['result']['channels'] = transform(changed['cases'][0]['result']['channels'])
        assert score(harness, groups['observational-shares'], changed)[0] < len(groups['observational-shares']['checks'])
        tested_mutations.append(label)
    audit = audit_requests(builder, harness, manifest, contexts)
    evaluation_doc = (builder.SKILL / 'references/eval.md').read_text()
    assert sha in evaluation_doc and harness.harness_hash() in evaluation_doc
    assert f"{audit['context_bytes']:,} UTF-8 bytes" in evaluation_doc
    for name, digest in audit['context_sha256'].items():
        assert name in evaluation_doc and digest in evaluation_doc, 'stale documented context hash'
    if audit['token_estimator'] != 'unavailable; byte counts only':
        for row in audit['groups']:
            table_row = '| ' + row['group'] + ' | ' + ' | '.join(f"{row[key]:,}" for key in ('without_skill_cl100k_estimated_tokens', 'with_skill_cl100k_estimated_tokens', 'with_skill_guarded_request_plus_8192')) + ' |'
            assert table_row in evaluation_doc, 'stale documented request-size audit'
    audit.update(manifest_sha256=sha, total_checks=sum(len(g['checks']) for g in manifest['groups']),
                 all_projected_cases=12, targeted_mutations=len(tested_mutations), model_calls=0)
    print(json.dumps(audit, indent=2, sort_keys=True))
    print('PASS MMM manifest projections, complete scalar/structure coverage, generic scoring and request separation; NO MODEL CALLS')


if __name__ == '__main__':
    main()
