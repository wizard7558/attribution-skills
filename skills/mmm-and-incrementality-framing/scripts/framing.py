"""Observational attribution-share ratios and explicit, nonstatistical delta bands."""
from __future__ import annotations
import copy
from decimal import Decimal, localcontext
from datetime import date, datetime, timezone
import json
import math
import re
import sys
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

_ERROR = 'invalid attribution framing input'
_COMMON = {'report_scope','timezone','start_week','end_week','outcome_name','outcome_kind','spend_currency','outcome_currency'}
_REG_EXTRA = {'as_of','control_keys','min_weeks','min_residual_df','max_condition_number'}
_SHARE_LIMITS = ['observational_share_ratio','not_causal_incrementality','no_budget_recommendation','no_population_join']
_BAND_LIMITS = ['user_supplied_assumption_range','not_confidence_or_credible_interval','not_causal_lift','media_response_change_only']
_SCENARIO_LIMITS = ['assumed_media_response_only','not_fitted_full_outcome','not_causal_lift','no_confidence_bands_or_budget_recommendations']


def _require(ok):
    if not ok: raise ValueError(_ERROR)


def _shape(value, keys):
    _require(type(value) is dict and set(value) == set(keys))


def _label(value):
    _require(type(value) is str and bool(value) and value == value.strip() and re.search(r'[\x00-\x1f\x7f-\x9f]',value) is None)


def _number(value, nullable=False, nonnegative=False):
    if nullable and value is None: return
    _require(type(value) in (int,float))
    try: finite = math.isfinite(value)
    except OverflowError: finite = False
    _require(finite and (not nonnegative or value >= 0))


def _inexact(value):
    return type(value) is int and float(value) != value


def _week(value):
    _require(type(value) is str and re.fullmatch(r'\d{4}-\d{2}-\d{2}',value) is not None)
    try: result = date.fromisoformat(value)
    except ValueError: raise ValueError(_ERROR) from None
    _require(result.weekday() == 0)
    return result


def _config(c, regression=False):
    _shape(c,_COMMON | {'channel_keys'} | (_REG_EXTRA if regression else set()))
    for key in ('report_scope','outcome_name'): _label(c[key])
    _require(type(c['timezone']) is str and re.fullmatch(r'[A-Za-z][A-Za-z0-9_+/-]*',c['timezone']) is not None)
    try: ZoneInfo(c['timezone'])
    except (ZoneInfoNotFoundError,ValueError): raise ValueError(_ERROR) from None
    _require(_week(c['start_week']) <= _week(c['end_week']))
    _require(c['outcome_kind'] in ('count','revenue'))
    _require(type(c['spend_currency']) is str and re.fullmatch(r'[A-Z]{3}',c['spend_currency']) is not None)
    _require(c['outcome_currency'] is None if c['outcome_kind']=='count' else type(c['outcome_currency']) is str and re.fullmatch(r'[A-Z]{3}',c['outcome_currency']) is not None)
    for field in ('channel_keys','control_keys') if regression else ('channel_keys',):
        _require(type(c[field]) is list)
        for key in c[field]: _label(key)
        _require(len(c[field]) == len(set(c[field])))
    if regression:
        _require(not set(c['channel_keys']) & set(c['control_keys']))
        for field in ('min_weeks','min_residual_df'): _require(type(c[field]) is int and c[field]>=1)
        _number(c['max_condition_number']);_require(c['max_condition_number']>1)
        stamp=c['as_of']
        _require(type(stamp)is str and re.fullmatch(r'\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|[+-]\d{2}:\d{2})',stamp)is not None)
        if not stamp.endswith('Z'):
            hour,minute=int(stamp[-5:-3]),int(stamp[-2:]);_require(hour<=14 and minute<=59 and(hour!=14 or minute==0))
        try:datetime.fromisoformat(stamp.replace('Z','+00:00')).astimezone(timezone.utc)
        except(ValueError,OverflowError):raise ValueError(_ERROR)from None


def _metric(value=None, reason=None): return dict(value=value,reason=reason)


def _decimal(value): return Decimal(value) if type(value) is int else Decimal.from_float(value)


def _converted(value):
    try: result=float(value)
    except(OverflowError,ValueError): return _metric(reason='numerical_failure')
    if not math.isfinite(result) or (value != 0 and result == 0): return _metric(reason='numerical_failure')
    return _metric(result)


def _sum(values, missing_reason='missing_channel'):
    if not values:return _metric(reason=missing_reason)
    if any(value is not None and _inexact(value) for value in values):return _metric(reason='numerical_failure')
    if any(value is None for value in values):return _metric(reason='unknown_value')
    with localcontext()as ctx:
        ctx.prec=2000
        return _converted(sum((_decimal(value)for value in values),Decimal(0)))


def _ratio(numerator,denominator):
    with localcontext()as ctx:
        ctx.prec=2000
        return _converted(_decimal(numerator)/_decimal(denominator))


def _source(source, config, mmm):
    _shape(source,{'metadata','complete','rows'})
    _shape(source['metadata'],_COMMON)
    _require(source['metadata']=={key:config[key]for key in _COMMON})
    _require(type(source['complete'])is bool and type(source['rows'])is list)
    unique={};duplicates=0;negative=[]
    fields=('contribution',)if mmm else('spend','outcome_quantity')
    for row in source['rows']:
        _shape(row,{'source_system','source_scope','row_key','channel_key'}|set(fields))
        for key in ('source_system','source_scope','row_key','channel_key'):_label(row[key])
        _require(row['channel_key']in config['channel_keys'])
        for key in fields:_number(row[key],nullable=True,nonnegative=not mmm)
        identity=tuple(row[key]for key in ('source_system','source_scope','row_key'))
        if identity in unique:
            _require(row==unique[identity]);duplicates+=1
        else:unique[identity]=copy.deepcopy(row)
    rows=[unique[key]for key in sorted(unique)]
    if mmm:
        negative=[{key:row[key]for key in ('source_system','source_scope','row_key')}for row in rows if row['contribution']is not None and row['contribution']<0]
    grouped={key:[r for r in rows if r['channel_key']==key]for key in config['channel_keys']}
    aggregates={key:{field:_sum([r[field]for r in group])for field in fields}for key,group in grouped.items()}
    share_field='contribution'if mmm else'outcome_quantity'
    metrics=[aggregates[key][share_field]for key in config['channel_keys']]
    missing=[key for key in config['channel_keys']if not grouped[key]]
    failures=[m['reason']for m in metrics if m['reason']]
    denominator=_metric(reason=next((reason for reason in ('numerical_failure','missing_channel','unknown_value')if reason in failures),None))if failures else _sum([m['value']for m in metrics],missing_reason='zero_total')
    if not config['channel_keys']:denominator=_metric(0.0)
    reason='source_incomplete'if not source['complete']else'negative_model_contribution'if negative else denominator['reason'] or ('zero_total'if denominator['value']==0 else None)
    diagnostic=dict(complete=source['complete'],denominator=denominator,share_reason=reason,duplicate_rows_collapsed=duplicates,missing_channels=missing)
    if mmm:diagnostic['negative_contribution_keys']=negative
    return aggregates,diagnostic


def compare_attribution_shares(payload):
    """Compare declared observed/model shares without joining or inventing populations."""
    _shape(payload,{'config','mmm','crm'});c=payload['config'];_config(c)
    mmm,md=_source(payload['mmm'],c,True);crm,cd=_source(payload['crm'],c,False)
    channels=[]
    for key in c['channel_keys']:
        contribution=mmm[key]['contribution'];spend=crm[key]['spend'];outcome_quantity=crm[key]['outcome_quantity']
        ms=_metric(reason=md['share_reason'])if md['share_reason']else _ratio(contribution['value'],md['denominator']['value'])
        cs=_metric(reason=cd['share_reason'])if cd['share_reason']else _ratio(outcome_quantity['value'],cd['denominator']['value'])
        factor=_metric(reason='shares_unavailable')if ms['reason']or cs['reason']else _metric(reason='zero_crm_share')if cs['value']==0 else _ratio(ms['value'],cs['value'])
        cpa_reason='not_conversion_count'if c['outcome_kind']!='count'else'source_incomplete'if not cd['complete']else spend['reason']or outcome_quantity['reason']or('zero_outcome_quantity'if outcome_quantity['value']==0 else None)
        cpa=_metric(reason=cpa_reason)if cpa_reason else _ratio(spend['value'],outcome_quantity['value'])
        adjusted=_metric(reason='not_conversion_count')if c['outcome_kind']!='count'else _metric(reason='cpa_unavailable')if cpa['reason']else _metric(reason='factor_unavailable')if factor['reason']else _metric(reason='zero_factor')if factor['value']==0 else _ratio(cpa['value'],factor['value'])
        channels.append(dict(key=key,mmm_contribution=contribution,crm_spend=spend,crm_outcome_quantity=outcome_quantity,mmm_share=ms,crm_share=cs,factor=factor,crm_cpa=cpa,adjusted_cpa=adjusted))
    status='complete'if not md['share_reason']and not cd['share_reason']and all(not row[field]['reason']for row in channels for field in (('factor','crm_cpa','adjusted_cpa')if c['outcome_kind']=='count'else('factor',)))else'incomplete'
    return dict(contract_version='0.1.0',config=copy.deepcopy(c),status=status,channels=channels,diagnostics=dict(mmm=md,crm=cd),limits=list(_SHARE_LIMITS))


def _scenario(s):
    _shape(s,{'contract_version','status','config','channels','totals','limits'});_config(s['config'],regression=True)
    _require(s['contract_version']=='0.1.0'and s['status']in('complete','incomplete'))
    _require(type(s['channels'])is list and len(s['channels'])==len(s['config']['channel_keys']))
    _require(s['limits']==_SCENARIO_LIMITS+([]if s['channels']else['no_media_curves']))
    for row,key in zip(s['channels'],s['config']['channel_keys']):
        _shape(row,{'key','baseline_spend','proposed_spend','status','baseline_response','proposed_response','response_delta'})
        _require(row['key']==key and row['status']in('ready','flat','unsupported_negative_coefficient','unsupported_zero_mean','regression_unavailable','numerical_failure'))
        _number(row['baseline_spend'],nonnegative=True);_number(row['proposed_spend'],nonnegative=True)
        supported=row['status']in('ready','flat')
        for field in ('baseline_response','proposed_response','response_delta'):
            _number(row[field],nullable=not supported,nonnegative=field!='response_delta')
            if not supported:_require(row[field]is None)
            if row['status']=='flat':_require(row[field]==0)
        if s['status']=='complete':_require(supported)
    _shape(s['totals'],{'baseline_response','proposed_response','response_delta'})
    for field,value in s['totals'].items():
        _number(value,nullable=s['status']=='incomplete',nonnegative=field!='response_delta')
        if s['status']=='incomplete':_require(value is None)
        else:
            _require(not _inexact(value))
            try:expected=math.fsum(row[field]for row in s['channels'])
            except OverflowError:raise ValueError(_ERROR)from None
            _require(math.isfinite(expected)and(value==0 if expected==0 else math.isclose(value,expected,rel_tol=8*sys.float_info.epsilon,abs_tol=0)))
    if s['status']=='complete':
        for row in s['channels']:
            for field in ('baseline_spend','proposed_spend','baseline_response','proposed_response','response_delta'):_require(not _inexact(row[field]))


def project_assumption_bands(payload):
    """Apply explicit multipliers to media response delta, not an uncertainty interval."""
    _shape(payload,{'scenario_result','assumption'});scenario=payload['scenario_result'];assumption=payload['assumption'];_scenario(scenario)
    _shape(assumption,{'label','lower_multiplier','upper_multiplier'});_label(assumption['label'])
    for key in ('lower_multiplier','upper_multiplier'):_number(assumption[key],nonnegative=True)
    _require(assumption['lower_multiplier']<=1<=assumption['upper_multiplier'])
    point=scenario['totals']['response_delta']
    result=dict(contract_version='0.1.0',config=copy.deepcopy(scenario['config']),status='unavailable',label=assumption['label'],lower_multiplier=assumption['lower_multiplier'],upper_multiplier=assumption['upper_multiplier'],point_delta=point,lower_delta=None,upper_delta=None,reason='scenario_incomplete',limits=list(_BAND_LIMITS))
    if scenario['status']=='incomplete':return result
    result['reason']='numerical_failure'
    if any(_inexact(value)for value in assumption.values()if type(value)in(int,float)):return result
    with localcontext()as ctx:
        ctx.prec=2000
        candidates=[_decimal(point)*_decimal(assumption[key])for key in ('lower_multiplier','upper_multiplier')]
        lower,upper=_converted(min(candidates)),_converted(max(candidates))
    if lower['reason']or upper['reason']:return result
    result.update(status='available',lower_delta=lower['value'],upper_delta=upper['value'],reason=None)
    return result


def _object(pairs):
    result={}
    for key,value in pairs:_require(key not in result);result[key]=value
    return result


def main():
    try:
        payload=json.load(sys.stdin,object_pairs_hook=_object,parse_constant=lambda _:(_ for _ in()).throw(ValueError(_ERROR)))
        _shape(payload,{'operation','input'});_require(payload['operation']in('compare_shares','project_bands'))
        result=(compare_attribution_shares if payload['operation']=='compare_shares'else project_assumption_bands)(payload['input'])
        print(json.dumps(result,sort_keys=True,allow_nan=False))
    except(ValueError,TypeError,OverflowError):
        print(json.dumps({'error':_ERROR}),file=sys.stderr);return 2
    return 0


if __name__=='__main__':raise SystemExit(main())
