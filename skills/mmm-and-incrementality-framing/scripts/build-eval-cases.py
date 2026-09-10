#!/usr/bin/env python3
"""Build fixed MMM evaluation projections from accepted literal goldens; no producers/models."""
from __future__ import annotations

import argparse
import copy
import hashlib
import importlib.util
import json
from pathlib import Path

SKILL = Path(__file__).resolve().parents[1]
MANIFEST = SKILL / 'references/eval-cases.json'
CONTEXT_FILES = ['SKILL.md', 'references/regression-contract.md', 'references/response-curve-contract.md',
                 'references/framing-contract.md', 'references/evaluation-output-contract.md']
SELECTIONS = [
    ('regression-guards', [('regression', name) for name in (
        'orthogonal-spend-and-control', 'negative-coefficient-not-clipped',
        'missing-week-never-dropped', 'perfect-collinearity')]),
    ('response-and-assumptions', [('response-curve', 'local-marginal-calibration'),
        ('response-curve', 'negative-coefficient-not-clipped'),
        ('framing', 'negative-delta-ordered-range'), ('framing', 'incomplete-scenario-unavailable')]),
    ('observational-shares', [('framing', name) for name in (
        'shares-factors-adjusted-cpa', 'revenue-aligned-shares-no-cpa',
        'partial-crm-source', 'negative-piece-even-with-positive-net')]),
]
PROMPTS = {
    'regression-guards': 'For every labeled input, fit the guarded weekly observational regression and return the specified regression projection in input case order. Use the declared complete-week grid, predictors and guards. Return only the required JSON.',
    'response-and-assumptions': 'For every labeled input, perform its declared operation and return the specified response/assumption projection in input case order. Use the full supplied producer input and explicit scenario or assumption. Return only the required JSON.',
    'observational-shares': 'For every labeled input, compare the declared observational MMM and CRM shares and return the specified share projection in input case order. Use the supplied population, outcome units and completeness declarations. Return only the required JSON.',
}
COUNT_FIELDS = {'n', 'p', 'residual_df'}
CHECK_COUNTS = {'regression-guards': 88, 'response-and-assumptions': 81, 'observational-shares': 192}


def read_json(path):
    return json.loads(path.read_text(), parse_constant=lambda value: (_ for _ in ()).throw(ValueError('non-finite fixture JSON')))


def obj(properties, nullable=False):
    return {'type': ['object', 'null'] if nullable else 'object', 'properties': properties,
            'required': list(properties), 'additionalProperties': False}


def arr(items):
    return {'type': 'array', 'items': items}


def scalar(kind, nullable=False):
    return {'type': [kind, 'null'] if nullable else kind}


def schemas():
    text, num, maybe, integer, boolean = scalar('string'), scalar('number'), scalar('number', True), scalar('integer'), scalar('boolean')
    limits = arr(text)
    regression = obj({
        'status': text, 'intercept': maybe,
        'channel_coefficients': arr(obj({'key': text, 'coefficient': maybe, 'mean_spend': maybe})),
        'control_coefficients': arr(obj({'key': text, 'coefficient': maybe})),
        'diagnostics': obj({'n': integer, 'p': integer, 'residual_df': integer,
            'missing_weeks': arr(text), 'negative_coefficients': arr(obj({'kind': text, 'key': text})), 'flags': arr(text)}),
        'limits': limits,
    })
    response = obj({
        'curves': obj({'status': text, 'channels': arr(obj({'key': text, 'coefficient': maybe,
            'mean_spend': maybe, 'status': text, 'a': maybe, 'b': maybe}))}, True),
        'scenario': obj({'status': text, 'channels': arr(obj({'key': text, 'baseline_spend': num,
            'proposed_spend': num, 'status': text, 'baseline_response': maybe, 'proposed_response': maybe,
            'response_delta': maybe})), 'totals': obj({'baseline_response': maybe, 'proposed_response': maybe,
            'response_delta': maybe}), 'limits': limits}, True),
        'bands': obj({'status': text, 'point_delta': maybe, 'lower_delta': maybe, 'upper_delta': maybe,
            'reason': scalar('string', True), 'limits': limits}, True),
    })
    metric = obj({'value': maybe, 'reason': scalar('string', True)})
    shares = obj({'status': text,
        'channels': arr(obj({'key': text, **{key: metric for key in ('mmm_contribution', 'crm_spend',
            'crm_outcome_quantity', 'mmm_share', 'crm_share', 'factor', 'crm_cpa', 'adjusted_cpa')}})),
        'diagnostics': obj({'mmm': obj({'complete': boolean, 'share_reason': scalar('string', True),
            'negative_contribution_keys': arr(obj({'source_system': text, 'source_scope': text, 'row_key': text}))}),
            'crm': obj({'complete': boolean, 'share_reason': scalar('string', True)})}), 'limits': limits})
    return {name: obj({'cases': arr(obj({'case': text, 'result': shape}))})
            for name, shape in zip(PROMPTS, (regression, response, shares))}


def take(value, fields):
    return {key: copy.deepcopy(value[key]) for key in fields}


def project(group_id, family, expected):
    if group_id == 'regression-guards':
        result = take(expected, ('status', 'intercept', 'channel_coefficients', 'control_coefficients', 'limits'))
        result['diagnostics'] = take(expected['diagnostics'], ('n', 'p', 'residual_df', 'missing_weeks', 'negative_coefficients', 'flags'))
        return result
    if group_id == 'response-and-assumptions':
        if family == 'response-curve':
            return {'curves': take(expected['curves'], ('status', 'channels')),
                    'scenario': take(expected['scenario'], ('status', 'channels', 'totals', 'limits')), 'bands': None}
        return {'curves': None, 'scenario': None,
                'bands': take(expected, ('status', 'point_delta', 'lower_delta', 'upper_delta', 'reason', 'limits'))}
    result = take(expected, ('status', 'channels', 'limits'))
    result['diagnostics'] = {'mmm': take(expected['diagnostics']['mmm'], ('complete', 'share_reason', 'negative_contribution_keys')),
                             'crm': take(expected['diagnostics']['crm'], ('complete', 'share_reason'))}
    return result


def pointer_token(value):
    return str(value).replace('~', '~0').replace('/', '~1')


def checks_for(value, path=''):
    """Score structure separately, then every scalar; never strict-compare numeric arrays."""
    if isinstance(value, dict):
        return [check for key, child in value.items() for check in checks_for(child, path + '/' + pointer_token(key))]
    if isinstance(value, list):
        return [{'path': path, 'op': 'array_length_equals', 'expected': len(value)}] + [
            check for index, child in enumerate(value) for check in checks_for(child, path + '/' + str(index))]
    numeric = type(value) in (int, float) and path.rsplit('/', 1)[-1] not in COUNT_FIELDS
    return [{'path': path, 'op': 'approximately' if numeric else 'equals', 'expected': value,
             **({'tolerance': 1e-9} if numeric else {})}]


def build():
    fixtures = {family: {case['id']: case for case in read_json(SKILL / f'references/{family}-fixtures.json')['cases']}
                for family in ('regression', 'response-curve', 'framing')}
    output_schemas = schemas()
    groups, projections = [], {}
    for group_id, selected in SELECTIONS:
        inputs, outputs = [], []
        for label, (family, fixture_id) in zip('ABCD', selected):
            fixture = fixtures[family][fixture_id]
            item = {'case': label, 'input': copy.deepcopy(fixture['input'])}
            if group_id == 'response-and-assumptions':
                item['operation'] = 'calibrate_and_evaluate' if family == 'response-curve' else 'project_bands'
            inputs.append(item)
            outputs.append({'case': label, 'result': project(group_id, family, fixture['expected'])})
        projected = {'cases': outputs}
        projections[group_id] = projected
        groups.append({'id': group_id, 'prompt': PROMPTS[group_id], 'input': {'cases': inputs},
                       'output_schema': output_schemas[group_id], 'checks': checks_for(projected)})
    return {'context_files': CONTEXT_FILES, 'groups': groups}, projections


def serialized(manifest):
    return json.dumps(manifest, indent=2, sort_keys=True, allow_nan=False) + '\n'


def load_harness():
    path = SKILL.parents[1] / 'scripts/run-skill-evals.py'
    spec = importlib.util.spec_from_file_location('mmm_generic_evaluation_harness', path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def validate(manifest, projections):
    harness = load_harness()
    assert set(manifest) == {'context_files', 'groups'}
    assert manifest['context_files'] == CONTEXT_FILES
    assert [g['id'] for g in manifest['groups']] == list(PROMPTS)
    for group in manifest['groups']:
        projected = projections[group['id']]
        assert [row['case'] for row in group['input']['cases']] == list('ABCD')
        assert [row['case'] for row in projected['cases']] == list('ABCD')
        assert len(group['checks']) == CHECK_COUNTS[group['id']]
        harness.validate_types_only_schema(group['output_schema'], group['id'])
        harness.ensure_finite(projected)
        assert harness.schema_type_ok(projected, group['output_schema']), group['id']
        assert group['checks'] == checks_for(projected), 'every scalar and array cardinality must be scored'
        for check in group['checks']:
            harness.validate_check(check, group['id'])
            assert harness.compare(check, projected)['passed'], check['path']


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--check', action='store_true')
    args = parser.parse_args()
    manifest, projections = build()
    validate(manifest, projections)
    text = serialized(manifest)
    if args.check:
        if not MANIFEST.is_file() or MANIFEST.read_text() != text:
            raise SystemExit('stale MMM manifest; run scripts/build-eval-cases.py from the skill directory')
    else:
        MANIFEST.write_text(text)
    print('PASS deterministic MMM manifest; 3 groups / 12 cases; NO MODEL CALLS')
    print('SHA256', hashlib.sha256(text.encode()).hexdigest())
    print('Checks', ', '.join(f"{group['id']}={len(group['checks'])}" for group in manifest['groups']))


if __name__ == '__main__':
    main()
