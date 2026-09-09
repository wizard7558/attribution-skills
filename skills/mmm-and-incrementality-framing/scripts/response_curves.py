"""Explicit observational local-marginal response assumptions; no causal inference."""
from __future__ import annotations
import copy
import json
import math
import re
import sys
from datetime import date, datetime, timezone
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

_ERROR = 'invalid response curve input'
_CONFIG = {'report_scope','timezone','start_week','end_week','as_of','outcome_name','outcome_kind','spend_currency','outcome_currency','channel_keys','control_keys','min_weeks','min_residual_df','max_condition_number'}
_REG = {'contract_version','config','status','intercept','channel_coefficients','control_coefficients','weeks','diagnostics','limits'}
_DIAG = {'n','p','residual_df','rank','singular_values','condition_number','r2','rcond','missing_weeks','missing_fields','excluded_outside_window','excluded_incomplete','duplicate_weeks_collapsed','zero_variance_predictors','negative_coefficients','flags'}
_REG_LIMITS = ['observational_association','not_causal_lift','no_p_values_or_confidence_intervals','in_sample_fit_only']
_STATUSES = ('fitted','insufficient_input','rank_deficient','ill_conditioned','numerical_failure')
_ASSUMPTIONS = ['observational_association','local_marginal_calibration','hill_exponent_fixed_one','curve_at_mean_not_ols_contribution','no_intercept_or_control_allocation','not_causal_lift']
_LIMITS = ['assumed_media_response_only','not_fitted_full_outcome','not_causal_lift','no_confidence_bands_or_budget_recommendations']


def _require(ok):
    if not ok:
        raise ValueError(_ERROR)


def _shape(value, keys):
    _require(type(value) is dict and set(value) == set(keys))


def _label(value):
    _require(type(value) is str and bool(value) and value == value.strip() and re.search(r'[\x00-\x1f\x7f-\x9f]', value) is None)


def _number(value, nullable=False, nonnegative=False):
    if nullable and value is None:
        return
    _require(type(value) in (int, float))
    try:
        _require(math.isfinite(value) and (not nonnegative or value >= 0))
    except OverflowError:
        raise ValueError(_ERROR) from None


def _finite_tree(value):
    if type(value) is dict:
        for child in value.values():
            _finite_tree(child)
    elif type(value) is list:
        for child in value:
            _finite_tree(child)
    elif type(value) in (int, float):
        _number(value)
    else:
        _require(value is None or type(value) in (str, bool))


def _week(value):
    _require(type(value) is str and re.fullmatch(r'\d{4}-\d{2}-\d{2}', value) is not None)
    try:
        parsed = date.fromisoformat(value)
    except ValueError:
        raise ValueError(_ERROR) from None
    _require(parsed.weekday() == 0)
    return parsed


def _config(c):
    _shape(c, _CONFIG)
    for key in ('report_scope','outcome_name'):
        _label(c[key])
    _require(type(c['timezone']) is str and re.fullmatch(r'[A-Za-z][A-Za-z0-9_+/-]*', c['timezone']) is not None)
    try:
        ZoneInfo(c['timezone'])
    except (ZoneInfoNotFoundError, ValueError):
        raise ValueError(_ERROR) from None
    _require(_week(c['start_week']) <= _week(c['end_week']))
    stamp = c['as_of']
    _require(type(stamp) is str and re.fullmatch(r'\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|[+-]\d{2}:\d{2})', stamp) is not None)
    if not stamp.endswith('Z'):
        hour, minute = int(stamp[-5:-3]), int(stamp[-2:])
        _require(hour <= 14 and minute <= 59 and (hour != 14 or minute == 0))
    try:
        datetime.fromisoformat(stamp.replace('Z','+00:00')).astimezone(timezone.utc)
    except (ValueError, OverflowError):
        raise ValueError(_ERROR) from None
    _require(c['outcome_kind'] in ('count','revenue'))
    _require(type(c['spend_currency']) is str and re.fullmatch(r'[A-Z]{3}', c['spend_currency']) is not None)
    _require(c['outcome_currency'] is None if c['outcome_kind'] == 'count' else type(c['outcome_currency']) is str and re.fullmatch(r'[A-Z]{3}', c['outcome_currency']) is not None)
    for field in ('channel_keys','control_keys'):
        _require(type(c[field]) is list)
        for key in c[field]:
            _label(key)
        _require(len(set(c[field])) == len(c[field]))
    _require(not set(c['channel_keys']) & set(c['control_keys']))
    for field in ('min_weeks','min_residual_df'):
        _require(type(c[field]) is int and c[field] >= 1)
    _number(c['max_condition_number'])
    _require(c['max_condition_number'] > 1)


def _regression(r):
    _shape(r, _REG)
    _finite_tree(r)
    _require(r['contract_version'] == '0.1.0' and r['status'] in _STATUSES and r['limits'] == _REG_LIMITS)
    _config(r['config'])
    fitted = r['status'] == 'fitted'
    _number(r['intercept'], nullable=not fitted)
    if not fitted:
        _require(r['intercept'] is None)
    for field, keys, fields in (('channel_coefficients','channel_keys',{'key','coefficient','mean_spend'}), ('control_coefficients','control_keys',{'key','coefficient'})):
        _require(type(r[field]) is list and len(r[field]) == len(r['config'][keys]))
        for row, key in zip(r[field], r['config'][keys]):
            _shape(row, fields)
            _require(row['key'] == key)
            _number(row['coefficient'], nullable=not fitted)
            if not fitted:
                _require(row['coefficient'] is None)
            if field == 'channel_coefficients':
                _number(row['mean_spend'], nullable=not fitted, nonnegative=True)
    d = r['diagnostics']; _shape(d, _DIAG)
    for field in ('n','p','duplicate_weeks_collapsed'):
        _require(type(d[field]) is int and d[field] >= 0)
    _require(type(d['residual_df']) is int and d['p'] == len(r['config']['channel_keys']) + len(r['config']['control_keys']) and d['residual_df'] == d['n'] - d['p'] - 1)
    _number(d['rcond']); _require(d['rcond'] > 0)
    _number(d['condition_number'], nullable=True, nonnegative=True)
    _number(d['r2'], nullable=True)
    _require(d['rank'] is None or type(d['rank']) is int and 0 <= d['rank'] <= min(d['n'], d['p']+1))
    _require(d['singular_values'] is None or type(d['singular_values']) is list)
    if d['singular_values'] is not None:
        for value in d['singular_values']:
            _number(value, nonnegative=True)
    for field in ('missing_weeks','excluded_outside_window','excluded_incomplete'):
        _require(type(d[field]) is list)
        for week in d[field]:
            _week(week)
    for field in ('flags','missing_fields','zero_variance_predictors','negative_coefficients'):
        _require(type(d[field]) is list)
    for flag in d['flags']:
        _label(flag)
    for row in d['missing_fields']:
        _shape(row, {'week','fields'}); _week(row['week'])
        _require(type(row['fields']) is list)
        for field in row['fields']:
            _label(field)
    for field in ('zero_variance_predictors','negative_coefficients'):
        for row in d[field]:
            _shape(row, {'kind','key'})
            _require(row['kind'] in ('channel','control'))
            _require(row['key'] in r['config']['channel_keys' if row['kind'] == 'channel' else 'control_keys'])
    if fitted:
        _require(d['n'] >= r['config']['min_weeks'] and d['residual_df'] >= r['config']['min_residual_df'] and d['rank'] == d['p'] + 1)
        _require(d['condition_number'] is not None and 1 <= d['condition_number'] <= r['config']['max_condition_number'])
        _require(not d['missing_weeks'] and not d['missing_fields'] and not d['zero_variance_predictors'])
    _require(type(r['weeks']) is list and len(r['weeks']) == d['n'])
    prior = None
    for row in r['weeks']:
        _shape(row, {'week','actual','predicted','residual'})
        week = _week(row['week'])
        _require(r['config']['start_week'] <= row['week'] <= r['config']['end_week'] and (prior is None or week > prior)); prior = week
        _number(row['actual'], nullable=not fitted, nonnegative=True)
        for field in ('predicted','residual'):
            _number(row[field], nullable=not fitted)
            if not fitted:
                _require(row[field] is None)


def _parameters(mean, coefficient):
    """Evaluate 4*mean*coefficient without intermediate product overflow."""
    mm, me = math.frexp(mean); cm, ce = math.frexp(coefficient)
    a = math.ldexp(mm * cm, me + ce + 2)
    if not math.isfinite(a) or a == 0:
        raise ArithmeticError
    return a, float(mean)


def _channel(key, coefficient, mean, regression_status):
    row = dict(key=key, coefficient=coefficient, mean_spend=mean, status='regression_unavailable', a=None, b=None)
    if regression_status != 'fitted':
        return row
    if any(type(value) is int and float(value) != value for value in (coefficient, mean)):
        row['status'] = 'numerical_failure'
    elif coefficient < 0:
        row['status'] = 'unsupported_negative_coefficient'
    elif mean == 0:
        row['status'] = 'unsupported_zero_mean'
    elif coefficient == 0:
        row.update(status='flat', a=0.0, b=mean)
    else:
        try:
            a, b = _parameters(mean, coefficient)
            row.update(status='ready', a=a, b=b)
        except (ArithmeticError, OverflowError):
            row['status'] = 'numerical_failure'
    return row


def calibrate_response_curves(regression_result):
    """Calibrate local marginal assumptions; never reinterpret a failed OLS fit."""
    _regression(regression_result)
    channels = [_channel(row['key'], row['coefficient'], row['mean_spend'], regression_result['status']) for row in regression_result['channel_coefficients']]
    status = 'regression_unavailable' if regression_result['status'] != 'fitted' else 'ready' if all(c['status'] in ('ready','flat') for c in channels) else 'incomplete'
    return dict(contract_version='0.1.0', status=status, regression_status=regression_result['status'], config=copy.deepcopy(regression_result['config']), channels=channels, assumptions=_ASSUMPTIONS + ([] if channels else ['no_media_curves']))


def _curves(curves):
    _shape(curves, {'contract_version','status','regression_status','config','channels','assumptions'})
    _finite_tree(curves); _config(curves['config'])
    _require(curves['contract_version'] == '0.1.0' and curves['regression_status'] in _STATUSES)
    _require(type(curves['channels']) is list and len(curves['channels']) == len(curves['config']['channel_keys']))
    for row, key in zip(curves['channels'], curves['config']['channel_keys']):
        _shape(row, {'key','coefficient','mean_spend','status','a','b'})
        _require(row['key'] == key)
        fitted = curves['regression_status'] == 'fitted'
        _number(row['coefficient'], nullable=not fitted); _number(row['mean_spend'], nullable=not fitted, nonnegative=True)
        if not fitted:
            _require(row['coefficient'] is None)
        expected = _channel(key, row['coefficient'], row['mean_spend'], curves['regression_status'])
        _require(row['status'] == expected['status'])
        for field in ('a','b'):
            _number(row[field], nullable=True, nonnegative=True)
            _require(not (type(row[field]) is int and float(row[field]) != row[field]))
            if expected[field] is None:
                _require(row[field] is None)
            else:
                _require(row[field] is not None and math.isclose(row[field], expected[field], rel_tol=8*sys.float_info.epsilon, abs_tol=0))
    expected_status = 'regression_unavailable' if curves['regression_status'] != 'fitted' else 'ready' if all(c['status'] in ('ready','flat') for c in curves['channels']) else 'incomplete'
    _require(curves['status'] == expected_status and curves['assumptions'] == _ASSUMPTIONS + ([] if curves['channels'] else ['no_media_curves']))


def _response(a, b, x):
    if x == 0 or a == 0:
        return 0.0
    # Exponent arithmetic prevents overflow of a*x and underflow of x/(b+x).
    scale = max(b, x)
    denominator = b / scale + x / scale
    am, ae = math.frexp(a); xm, xe = math.frexp(x); sm, se = math.frexp(scale)
    response = math.ldexp(am * xm / sm / denominator, ae + xe - se)
    if not math.isfinite(response) or response == 0:
        raise ArithmeticError
    return response



def _delta(a, b, baseline, proposed):
    """Evaluate the signed rational difference without cancellation of response levels."""
    if baseline == proposed or a == 0:
        return 0.0
    difference = proposed - baseline
    first_scale, second_scale = max(b, baseline), max(b, proposed)
    first_denominator = b / first_scale + baseline / first_scale
    second_denominator = b / second_scale + proposed / second_scale
    am, ae = math.frexp(a); bm, be = math.frexp(b); dm, de = math.frexp(abs(difference))
    fm, fe = math.frexp(first_scale); sm, se = math.frexp(second_scale)
    magnitude = math.ldexp(am * bm * dm / fm / sm / first_denominator / second_denominator, ae + be + de - fe - se)
    if not math.isfinite(magnitude) or magnitude == 0:
        raise ArithmeticError
    return math.copysign(magnitude, difference)


def evaluate_response_scenario(curves_result, scenario):
    """Evaluate an explicit spend baseline/proposal; unsupported channels stay null."""
    _curves(curves_result)
    _shape(scenario, {'spend_by_channel'})
    _shape(scenario['spend_by_channel'], curves_result['config']['channel_keys'])
    channels = []
    for curve in curves_result['channels']:
        spend = scenario['spend_by_channel'][curve['key']]
        _shape(spend, {'baseline','proposed'})
        _number(spend['baseline'], nonnegative=True); _number(spend['proposed'], nonnegative=True)
        row = dict(key=curve['key'], baseline_spend=spend['baseline'], proposed_spend=spend['proposed'], status=curve['status'], baseline_response=None, proposed_response=None, response_delta=None)
        if any(type(value) is int and float(value) != value for value in spend.values()):
            row['status'] = 'numerical_failure'
        elif curve['status'] in ('ready','flat'):
            try:
                baseline = _response(curve['a'], curve['b'], spend['baseline'])
                proposed = _response(curve['a'], curve['b'], spend['proposed'])
                delta = _delta(curve['a'], curve['b'], spend['baseline'], spend['proposed'])
                row.update(baseline_response=baseline, proposed_response=proposed, response_delta=delta)
            except (ArithmeticError, OverflowError):
                row['status'] = 'numerical_failure'
        channels.append(row)
    totals = dict(baseline_response=None, proposed_response=None, response_delta=None)
    status = 'incomplete'
    if curves_result['regression_status'] == 'fitted' and all(c['status'] in ('ready','flat') for c in channels):
        try:
            values = {key: math.fsum(c[key] for c in channels) for key in totals}
            if not all(math.isfinite(value) for value in values.values()):
                raise ArithmeticError
            totals, status = values, 'complete'
        except (ArithmeticError, OverflowError):
            pass
    return dict(contract_version='0.1.0', status=status, config=copy.deepcopy(curves_result['config']), channels=channels, totals=totals, limits=_LIMITS + ([] if channels else ['no_media_curves']))


def _object(pairs):
    result = {}
    for key, value in pairs:
        _require(key not in result); result[key] = value
    return result


def main():
    try:
        payload = json.load(sys.stdin, object_pairs_hook=_object, parse_constant=lambda _: (_ for _ in ()).throw(ValueError(_ERROR)))
        _shape(payload, {'regression_result','scenario'})
        curves = calibrate_response_curves(payload['regression_result'])
        scenario = evaluate_response_scenario(curves, payload['scenario'])
        print(json.dumps(dict(curves=curves, scenario=scenario), allow_nan=False, sort_keys=True))
    except (ValueError, TypeError, OverflowError):
        print(json.dumps({'error': _ERROR}), file=sys.stderr); return 2
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
