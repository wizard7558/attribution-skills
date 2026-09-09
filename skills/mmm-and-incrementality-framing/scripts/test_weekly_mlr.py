"""Execute literal analytical goldens, negative cases, mutations and isolated CLI."""
import copy
import hashlib
import itertools
import json
import math
import os
from pathlib import Path
import platform
import shutil
import subprocess
import sys
import tempfile
from datetime import datetime, timezone

sys.dont_write_bytecode = True
import numpy as np
from weekly_mlr import fit_weekly_mlr

ROOT = Path(__file__).resolve().parents[1]
FIXTURE = ROOT / 'references/regression-fixtures.json'
SOURCE = ROOT / 'scripts/weekly_mlr.py'
DATA = json.loads(FIXTURE.read_text())
TOL = DATA['numeric_tolerance']


def compare(actual, expected, path='$'):
    if type(expected) in (int, float):
        assert type(actual) in (int, float) and math.isfinite(actual), path
        # Counts and explicitly encoded integer data must remain exact; solver floats have tolerance.
        if path.endswith('.rcond') or (type(actual) is int and type(expected) is int):
            assert actual == expected, f'{path}: {actual} != {expected}'
        else:
            assert math.isclose(actual, expected, rel_tol=TOL['relative'], abs_tol=TOL['absolute']), f'{path}: {actual} != {expected}'
    elif isinstance(expected, dict):
        assert isinstance(actual, dict) and actual.keys() == expected.keys(), path + ': keys'
        for key in expected:
            compare(actual[key], expected[key], path + '.' + key)
    elif isinstance(expected, list):
        assert isinstance(actual, list) and len(actual) == len(expected), path + ': list length'
        for i, (a, e) in enumerate(zip(actual, expected)):
            compare(a, e, f'{path}[{i}]')
    else:
        assert type(actual) is type(expected) and actual == expected, f'{path}: scalar'


def run_case(case, fit=fit_weekly_mlr):
    payload = copy.deepcopy(case['input'])
    if 'inject_nonfinite' in case:
        spec = case['inject_nonfinite']; target = payload
        for key in spec['path'][:-1]:
            target = target[key]
        target[spec['path'][-1]] = float(spec['value'])
    before = json.dumps(payload, sort_keys=True)
    if 'expected_error' in case:
        try:
            fit(payload)
        except ValueError as error:
            assert str(error) == case['expected_error']
        else:
            raise AssertionError('expected ValueError')
    else:
        actual = fit(payload)
        compare(actual, case['expected'])
        json.dumps(actual, allow_nan=False)
    assert json.dumps(payload, sort_keys=True) == before, 'input mutated'


def main():
    timestamp = datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%S%fZ')
    report_path = Path.home() / 'Downloads' / f'mmm-weekly-regression-evidence-{timestamp}.json'
    report = dict(status='running', started_at=timestamp, python=sys.version, numpy=np.__version__, platform=platform.platform(),
                  command=[sys.executable, str(Path(__file__).resolve())], hashes={}, cases=[], permutations=[], mutations=[], cli=[])
    for file in (SOURCE, FIXTURE, Path(__file__).resolve(), ROOT / 'requirements.txt', ROOT / 'references/regression-contract.md'):
        report['hashes'][str(file.relative_to(ROOT))] = hashlib.sha256(file.read_bytes()).hexdigest()
    try:
        ids = [c['id'] for c in DATA['cases']]
        assert len(ids) == len(set(ids))
        for case in DATA['cases']:
            run_case(case)
            report['cases'].append(dict(id=case['id'], status='passed', kind='error' if 'expected_error' in case else 'full_output_golden'))
        by_id = {c['id']: c for c in DATA['cases']}
        base = by_id['orthogonal-spend-and-control']
        for index, permutation in enumerate(itertools.permutations(base['input']['rows'])):
            case = copy.deepcopy(base)
            case['input']['rows'] = [{key: copy.deepcopy(row[key]) for key in reversed(row)} for row in permutation]
            case['input']['config'] = dict(reversed(list(case['input']['config'].items())))
            run_case(case)
            report['permutations'].append(dict(index=index, status='passed'))
        source = SOURCE.read_text()
        mutations = [
            ('clipped_negative_coefficient', 'negative-coefficient-not-clipped', 'coefficients = beta_standard[1:] / stds', 'coefficients = np.maximum(0, beta_standard[1:] / stds)'),
            ('absent_intercept', 'exact-line-original-units', 'intercept = float(beta_standard[0] - np.dot(means, coefficients))', 'intercept = 0.0'),
            ('wrong_original_units', 'spend-unit-rescaling', 'coefficients = beta_standard[1:] / stds', 'coefficients = beta_standard[1:]'),
            ('zero_fill_unknown_spend', 'unknown-spend-never-zero-filled', 'c, unique, duplicates, zone, start, end, as_of = _validated(payload)', 'c, unique, duplicates, zone, start, end, as_of = _validated(payload)\n    for row in unique.values():\n        row["spend"] = {k: (0 if v is None else v) for k, v in row["spend"].items()}'),
            ('drop_missing_week', 'missing-week-never-dropped', 'predictors = [("channel", key)', 'selected = [w for w in selected if w in unique]\n    predictors = [("channel", key)'),
            ('include_future_week', 'completed-week-exact-dst-boundary', '(selected if completed else incomplete).append(week)', 'selected.append(week)'),
        ]
        for name, fixture_id, old, new in mutations:
            assert source.count(old) == 1, name + ': mutation anchor drift'
            namespace = {'__name__': 'mutant'}
            exec(compile(source.replace(old, new), '<isolated mutation>', 'exec'), namespace)
            try:
                run_case(by_id[fixture_id], namespace['fit_weekly_mlr'])
            except AssertionError:
                report['mutations'].append(dict(name=name, fixture=fixture_id, status='rejected'))
            else:
                raise AssertionError('surviving mutation: ' + name)
        with tempfile.TemporaryDirectory(prefix='weekly-mlr-standalone-') as directory:
            isolated = Path(directory)
            shutil.copyfile(SOURCE, isolated / 'weekly_mlr.py')
            shutil.copyfile(ROOT / 'requirements.txt', isolated / 'requirements.txt')
            env = dict(os.environ, PYTHONDONTWRITEBYTECODE='1'); env.pop('PYTHONPATH', None)
            for fixture_id in ('exact-line-original-units', 'orthogonal-spend-and-control', 'completed-week-exact-dst-boundary'):
                case = by_id[fixture_id]
                process = subprocess.run([sys.executable, '-I', str(isolated / 'weekly_mlr.py')], input=json.dumps(case['input']), text=True, capture_output=True, cwd=isolated, env=env)
                assert process.returncode == 0 and process.stderr == '', fixture_id
                compare(json.loads(process.stdout), case['expected'])
                report['cli'].append(dict(id=fixture_id, status='passed', mode='isolated_copied_directory'))
            for name, raw in (('duplicate_json_key', '{"config":{},"config":{},"rows":[]}'), ('nonfinite_json', '{"config":NaN,"rows":[]}'), ('malformed_json', '{')):
                process = subprocess.run([sys.executable, '-I', str(isolated / 'weekly_mlr.py')], input=raw, text=True, capture_output=True, cwd=isolated, env=env)
                assert process.returncode == 2 and process.stdout == ''
                assert json.loads(process.stderr) == {'error': 'invalid weekly regression input'}
                report['cli'].append(dict(id=name, status='passed', mode='isolated_copied_directory_error'))
        report['status'] = 'passed'
    except Exception as error:
        report.update(status='failed', error=f'{type(error).__name__}: {error}')
        raise
    finally:
        report['counts'] = dict(cases=len(report['cases']), full_output_goldens=sum(c['kind'] == 'full_output_golden' for c in report['cases']), value_errors=sum(c['kind'] == 'error' for c in report['cases']), permutations=len(report['permutations']), rejected_mutations=len(report['mutations']), isolated_cli=len(report['cli']))
        report_path.parent.mkdir(parents=True, exist_ok=True)
        report_path.write_text(json.dumps(report, indent=2, allow_nan=False) + '\n')
        print(json.dumps(dict(status=report['status'], counts=report['counts'], evidence=str(report_path))))


if __name__ == '__main__':
    main()
