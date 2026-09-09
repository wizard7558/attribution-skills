"""Execute independent framing goldens, pipeline integration and behavioral mutants."""
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
from datetime import datetime,timezone
sys.dont_write_bytecode=True
from framing import compare_attribution_shares,project_assumption_bands

ROOT=Path(__file__).resolve().parents[1]
SOURCE=ROOT/'scripts/framing.py'
FIXTURE=ROOT/'references/framing-fixtures.json'
DATA=json.loads(FIXTURE.read_text())


def compare(actual,expected,path='$'):
    if type(expected)in(int,float):
        assert type(actual)in(int,float)and math.isfinite(actual),path
        assert math.isclose(actual,expected,rel_tol=DATA['numeric_tolerance']['relative'],abs_tol=DATA['numeric_tolerance']['absolute']),f'{path}: {actual} != {expected}'
    elif type(expected)is dict:
        assert type(actual)is dict and actual.keys()==expected.keys(),path+': keys'
        for key in expected:compare(actual[key],expected[key],path+'.'+key)
    elif type(expected)is list:
        assert type(actual)is list and len(actual)==len(expected),path+': list length'
        for index,(a,e)in enumerate(zip(actual,expected)):compare(a,e,f'{path}[{index}]')
    else:assert type(actual)is type(expected)and actual==expected,path+': scalar'


def run_case(case,shares=compare_attribution_shares,bands=project_assumption_bands):
    payload=copy.deepcopy(case['input'])
    if'inject_nonfinite'in case:
        spec=case['inject_nonfinite'];target=payload
        for key in spec['path'][:-1]:target=target[key]
        target[spec['path'][-1]]=float(spec['value'])
    before=json.dumps(payload,sort_keys=True)
    try:actual=(shares if case['operation']=='compare_shares'else bands)(payload)
    except ValueError as error:assert str(error)==case.get('expected_error')
    else:
        assert'expected_error'not in case,'expected structural failure'
        compare(actual,case['expected']);json.dumps(actual,allow_nan=False)
    assert json.dumps(payload,sort_keys=True)==before,'input mutated'


def main():
    stamp=datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%S%fZ')
    report_path=Path.home()/'Downloads'/f'mmm-framing-evidence-{stamp}.json'
    report=dict(status='running',python=sys.version,platform=platform.platform(),command=[sys.executable,str(Path(__file__).resolve())],hashes={},cases=[],permutations=[],mutations=[],integration=[],cli=[])
    for file in(SOURCE,FIXTURE,Path(__file__).resolve(),ROOT/'references/framing-contract.md'):
        if file.exists():report['hashes'][str(file.relative_to(ROOT))]=hashlib.sha256(file.read_bytes()).hexdigest()
    try:
        byid={c['id']:c for c in DATA['cases']};assert len(byid)==len(DATA['cases'])
        for case in DATA['cases']:
            run_case(case);report['cases'].append(dict(id=case['id'],kind='error'if'expected_error'in case else'full_output_golden',status='passed'))
        case=byid['ratio-of-sums-disjoint-pieces']
        for permutation in itertools.permutations(case['input']['crm']['rows']):
            variant=copy.deepcopy(case);variant['input']['crm']['rows']=[dict(reversed(list(row.items())))for row in permutation]
            variant['input']['mmm']['rows'].reverse();variant['input']['config']=dict(reversed(list(variant['input']['config'].items())))
            run_case(variant);report['permutations'].append(dict(status='passed'))
        import numpy as np
        from weekly_mlr import fit_weekly_mlr
        from response_curves import calibrate_response_curves,evaluate_response_scenario
        report['numpy']=np.__version__;report['integration_source_hashes']={name:hashlib.sha256((ROOT/'scripts'/name).read_bytes()).hexdigest()for name in('weekly_mlr.py','response_curves.py')}
        for case in DATA['cases']:
            if'integration_input'not in case:continue
            fitted=fit_weekly_mlr(copy.deepcopy(case['integration_input']))
            curves=calibrate_response_curves(fitted)
            scenario=evaluate_response_scenario(curves,copy.deepcopy(case['integration_scenario']))
            actual=project_assumption_bands(dict(scenario_result=scenario,assumption=copy.deepcopy(case['input']['assumption'])))
            compare(actual,case['expected']);report['integration'].append(dict(id=case['id'],status='passed',kind='actual_weekly_mlr_response_curves_scenario_bands'))
        source=SOURCE.read_text()
        mutants=[
            ('inverse_factor','shares-factors-adjusted-cpa',"_ratio(ms['value'],cs['value'])","_ratio(cs['value'],ms['value'])"),
            ('multiply_adjusted_cpa','shares-factors-adjusted-cpa',"_ratio(cpa['value'],factor['value'])","_metric(cpa['value']*factor['value'])"),
            ('average_row_cpas','ratio-of-sums-disjoint-pieces',"cpa=_metric(reason=cpa_reason)if cpa_reason else _ratio(spend['value'],outcome_quantity['value'])","pieces=[r for r in payload['crm']['rows'] if r['channel_key']==key]\n        cpa=_metric(reason=cpa_reason)if cpa_reason else _metric(sum(r['spend']/r['outcome_quantity'] for r in pieces)/len(pieces))"),
            ('missing_channel_zero_fill','missing-model-channel-unknown',"if not values:return _metric(reason=missing_reason)","if not values:return _metric(0.0)"),
            ('negative_band_unsorted','negative-delta-ordered-range',"lower,upper=_converted(min(candidates)),_converted(max(candidates))","lower,upper=_converted(candidates[0]),_converted(candidates[1])"),
            ('fake_confidence_label','positive-delta-assumption-range',"'not_confidence_or_credible_interval'","'confidence_interval'"),
            ('underflow_zero_fill','band-positive-underflow-guard'," or (value != 0 and result == 0)",""),
        ]
        for name,fixture,old,new in mutants:
            assert source.count(old)==1,name+': anchor drift'
            namespace={'__name__':'mutant'};exec(compile(source.replace(old,new),'<isolated behavioral mutant>','exec'),namespace)
            try:run_case(byid[fixture],namespace['compare_attribution_shares'],namespace['project_assumption_bands'])
            except AssertionError:report['mutations'].append(dict(name=name,fixture=fixture,status='rejected'))
            else:raise AssertionError('surviving mutant '+name)
        with tempfile.TemporaryDirectory(prefix='mmm-framing-standalone-')as directory:
            isolated=Path(directory);shutil.copyfile(SOURCE,isolated/'framing.py')
            env=dict(os.environ,PYTHONDONTWRITEBYTECODE='1');env.pop('PYTHONPATH',None)
            for fixture in('shares-factors-adjusted-cpa','ratio-of-sums-disjoint-pieces','positive-delta-assumption-range','negative-delta-ordered-range'):
                case=byid[fixture];raw=json.dumps(dict(operation=case['operation'],input=case['input']))
                process=subprocess.run([sys.executable,'-I','-S',str(isolated/'framing.py')],input=raw,text=True,capture_output=True,cwd=isolated,env=env)
                assert process.returncode==0 and process.stderr=='',process.stderr
                compare(json.loads(process.stdout),case['expected']);report['cli'].append(dict(id=fixture,status='passed',isolated_stdlib_only=True))
            for name,raw in(('duplicate_json_key','{"operation":"compare_shares","operation":"project_bands","input":{}}'),('nonfinite_json','{"operation":"project_bands","input":NaN}'),('unknown_operation','{"operation":"allocate_budget","input":{}}')):
                process=subprocess.run([sys.executable,'-I','-S',str(isolated/'framing.py')],input=raw,text=True,capture_output=True,cwd=isolated,env=env)
                assert process.returncode==2 and process.stdout==''
                assert json.loads(process.stderr)=={'error':'invalid attribution framing input'}
                report['cli'].append(dict(id=name,status='passed',isolated_stdlib_only=True))
        report['status']='passed'
    except Exception as error:
        report.update(status='failed',error=f'{type(error).__name__}: {error}');raise
    finally:
        report['counts']=dict(cases=len(report['cases']),full_output_goldens=sum(c['kind']=='full_output_golden'for c in report['cases']),value_errors=sum(c['kind']=='error'for c in report['cases']),permutations=len(report['permutations']),rejected_mutations=len(report['mutations']),actual_pipeline_integrations=len(report['integration']),isolated_cli=len(report['cli']))
        report_path.parent.mkdir(parents=True,exist_ok=True);report_path.write_text(json.dumps(report,indent=2,allow_nan=False)+'\n')
        print(json.dumps(dict(status=report['status'],counts=report['counts'],evidence=str(report_path))))


if __name__=='__main__':main()
