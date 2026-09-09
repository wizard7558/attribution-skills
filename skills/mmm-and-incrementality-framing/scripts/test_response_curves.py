"""Run literal response goldens, real regression integration, CLI and mutation guards."""
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
from response_curves import calibrate_response_curves, evaluate_response_scenario

ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / 'scripts/response_curves.py'
FIXTURE = ROOT / 'references/response-curve-fixtures.json'
DATA = json.loads(FIXTURE.read_text())


def compare(a, e, path='$'):
    if type(e) in (int,float):
        assert type(a) in (int,float) and math.isfinite(a), path
        assert math.isclose(a,e,rel_tol=DATA['numeric_tolerance']['relative'],abs_tol=DATA['numeric_tolerance']['absolute']), f'{path}: {a} != {e}'
    elif type(e) is dict:
        assert type(a) is dict and a.keys()==e.keys(), path+': keys'
        for key in e: compare(a[key],e[key],path+'.'+key)
    elif type(e) is list:
        assert type(a) is list and len(a)==len(e),path+': list length'
        for index,(aa,ee)in enumerate(zip(a,e)):compare(aa,ee,f'{path}[{index}]')
    else:
        assert type(a)is type(e) and a==e,path+': scalar'


def run_case(case, calibrate=calibrate_response_curves, evaluate=evaluate_response_scenario):
    payload=copy.deepcopy(case['input'])
    if 'inject_nonfinite'in case:
        spec=case['inject_nonfinite'];target=payload
        for key in spec['path'][:-1]:target=target[key]
        target[spec['path'][-1]]=float(spec['value'])
    before=json.dumps(payload,sort_keys=True)
    try:
        if case['operation']=='evaluate':
            actual=evaluate(payload['curves_result'],payload['scenario'])
        else:
            curves=calibrate(payload['regression_result'])
            actual=dict(curves=curves,scenario=evaluate(curves,payload['scenario']))
    except ValueError as error:
        assert case.get('expected_error')==str(error)
    else:
        assert 'expected_error'not in case,'expected structural failure'
        compare(actual,case['expected']);json.dumps(actual,allow_nan=False)
    assert json.dumps(payload,sort_keys=True)==before,'input mutated'


def main():
    timestamp=datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%S%fZ')
    report_path=Path.home()/'Downloads'/f'mmm-response-curves-evidence-{timestamp}.json'
    report=dict(status='running',python=sys.version,platform=platform.platform(),command=[sys.executable,str(Path(__file__).resolve())],hashes={},cases=[],permutations=[],mutations=[],integration=[],cli=[])
    for file in (SOURCE,FIXTURE,Path(__file__).resolve(),ROOT/'references/response-curve-contract.md'):
        if file.exists():report['hashes'][str(file.relative_to(ROOT))]=hashlib.sha256(file.read_bytes()).hexdigest()
    try:
        byid={c['id']:c for c in DATA['cases']};assert len(byid)==len(DATA['cases'])
        for case in DATA['cases']:
            run_case(case);report['cases'].append(dict(id=case['id'],kind='error'if'expected_error'in case else'full_output_golden',status='passed'))
        case=byid['two-channel-conservation']
        for permutation in itertools.permutations(case['input']['scenario']['spend_by_channel'].items()):
            variant=copy.deepcopy(case);variant['input']['scenario']['spend_by_channel']=dict(permutation)
            variant['input']['regression_result']['config']=dict(reversed(list(variant['input']['regression_result']['config'].items())))
            run_case(variant);report['permutations'].append(dict(status='passed'))
        # The production response module itself uses only stdlib. This test intentionally imports the accepted sibling.
        import numpy as np
        from weekly_mlr import fit_weekly_mlr
        report['numpy']=np.__version__
        report['integration_source_sha256']=hashlib.sha256((ROOT/'scripts/weekly_mlr.py').read_bytes()).hexdigest()
        for case in DATA['cases']:
            if'integration_input'not in case:continue
            regression=fit_weekly_mlr(copy.deepcopy(case['integration_input']))
            curves=calibrate_response_curves(regression)
            actual=dict(curves=curves,scenario=evaluate_response_scenario(curves,case['input']['scenario']))
            compare(actual,case['expected'])
            channel=curves['channels'][0]
            assert math.isclose(channel['a']*channel['b']/(channel['b']+10)**2,3,rel_tol=1e-12)
            report['integration'].append(dict(id=case['id'],status='passed',kind='actual_weekly_mlr_then_curves_then_scenario'))
        source=SOURCE.read_text()
        mutations=[
            ('wrong_a_factor','local-marginal-calibration','me + ce + 2','me + ce + 1'),
            ('negative_clipping','negative-coefficient-not-clipped',"elif coefficient < 0:\n        row['status'] = 'unsupported_negative_coefficient'","elif coefficient < 0:\n        row.update(coefficient=0, status='flat', a=0.0, b=mean)"),
            ('missing_channel_zero_fill','missing-channel',"_shape(scenario['spend_by_channel'], curves_result['config']['channel_keys'])","scenario = copy.deepcopy(scenario)\n    for key in curves_result['config']['channel_keys']:\n        scenario['spend_by_channel'].setdefault(key, {'baseline':0,'proposed':0})\n    _shape(scenario['spend_by_channel'], curves_result['config']['channel_keys'])"),
            ('unsupported_zero_totals','partial-support-no-partial-total',"totals = dict(baseline_response=None, proposed_response=None, response_delta=None)","totals = dict(baseline_response=0, proposed_response=0, response_delta=0)"),
            ('wrong_delta_sign','declining-spend-signed-delta',"delta = _delta(curve['a'], curve['b'], spend['baseline'], spend['proposed'])","delta = -_delta(curve['a'], curve['b'], spend['baseline'], spend['proposed'])"),
            ('naive_overflow_product','large-product-safe-evaluation','response = math.ldexp(am * xm / sm / denominator, ae + xe - se)','response = a*x/(b+x)'),
            ('subtraction_cancellation','large-neighboring-spends-direct-delta',"delta = _delta(curve['a'], curve['b'], spend['baseline'], spend['proposed'])",'delta = proposed-baseline'),
        ]
        for name,fixture,old,new in mutations:
            assert source.count(old)==1,name+': anchor drift'
            namespace={'__name__':'mutant'};exec(compile(source.replace(old,new),'<behavioral mutant>','exec'),namespace)
            try:run_case(byid[fixture],namespace['calibrate_response_curves'],namespace['evaluate_response_scenario'])
            except AssertionError:report['mutations'].append(dict(name=name,fixture=fixture,status='rejected'))
            else:raise AssertionError('surviving mutation '+name)
        with tempfile.TemporaryDirectory(prefix='response-curves-standalone-')as directory:
            isolated=Path(directory);shutil.copyfile(SOURCE,isolated/'response_curves.py')
            env=dict(os.environ,PYTHONDONTWRITEBYTECODE='1');env.pop('PYTHONPATH',None)
            for fixture in ('local-marginal-calibration','two-channel-conservation','large-product-safe-evaluation'):
                case=byid[fixture]
                process=subprocess.run([sys.executable,'-I','-S',str(isolated/'response_curves.py')],input=json.dumps(case['input']),text=True,capture_output=True,cwd=isolated,env=env)
                assert process.returncode==0 and process.stderr=='',process.stderr
                compare(json.loads(process.stdout),case['expected']);report['cli'].append(dict(id=fixture,status='passed',isolated_stdlib_only=True))
            for name,raw in (('duplicate_json_key','{"regression_result":{},"regression_result":{},"scenario":{}}'),('nonfinite_json','{"regression_result":NaN,"scenario":{}}'),('missing_channel',json.dumps(byid['missing-channel']['input']))):
                process=subprocess.run([sys.executable,'-I','-S',str(isolated/'response_curves.py')],input=raw,text=True,capture_output=True,cwd=isolated,env=env)
                assert process.returncode==2 and process.stdout==''
                assert json.loads(process.stderr)=={'error':'invalid response curve input'}
                report['cli'].append(dict(id=name,status='passed',isolated_stdlib_only=True))
        report['status']='passed'
    except Exception as error:
        report.update(status='failed',error=f'{type(error).__name__}: {error}');raise
    finally:
        report['counts']=dict(cases=len(report['cases']),full_output_goldens=sum(c['kind']=='full_output_golden'for c in report['cases']),value_errors=sum(c['kind']=='error'for c in report['cases']),permutations=len(report['permutations']),rejected_mutations=len(report['mutations']),actual_regression_integrations=len(report['integration']),isolated_cli=len(report['cli']))
        report_path.parent.mkdir(parents=True,exist_ok=True);report_path.write_text(json.dumps(report,indent=2,allow_nan=False)+'\n')
        print(json.dumps(dict(status=report['status'],counts=report['counts'],evidence=str(report_path))))


if __name__=='__main__':main()
