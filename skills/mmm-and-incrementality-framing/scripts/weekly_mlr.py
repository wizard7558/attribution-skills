"""Guarded weekly observational OLS; JSON-compatible input and finite output only."""
from __future__ import annotations

import copy
import json
import math
import re
import sys
from datetime import date, datetime, time, timedelta, timezone
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

import numpy as np

_ERROR = "invalid weekly regression input"
_CONFIG = {"report_scope", "timezone", "start_week", "end_week", "as_of", "outcome_name", "outcome_kind", "spend_currency", "outcome_currency", "channel_keys", "control_keys", "min_weeks", "min_residual_df", "max_condition_number"}
_ROW = {"week", "spend", "controls", "outcome", "spend_currency", "outcome_currency"}
_LIMITS = ["observational_association", "not_causal_lift", "no_p_values_or_confidence_intervals", "in_sample_fit_only"]


def _require(ok):
    if not ok:
        raise ValueError(_ERROR)


def _label(value):
    _require(isinstance(value, str) and bool(value) and value == value.strip() and re.search(r"[\x00-\x1f\x7f-\x9f]", value) is None)


def _number(value, nonnegative=False):
    if value is None:
        return
    _require(type(value) in (int, float))
    try:
        finite = math.isfinite(value)
    except (OverflowError, TypeError):
        finite = False
    _require(finite and (not nonnegative or value >= 0))


def _week(value):
    _require(isinstance(value, str) and re.fullmatch(r"\d{4}-\d{2}-\d{2}", value) is not None)
    try:
        result = date.fromisoformat(value)
    except ValueError:
        raise ValueError(_ERROR) from None
    _require(result.weekday() == 0)
    return result


def _validated(payload):
    _require(type(payload) is dict and set(payload) == {"config", "rows"})
    c, rows = payload["config"], payload["rows"]
    _require(type(c) is dict and set(c) == _CONFIG and type(rows) is list)
    for key in ("report_scope", "outcome_name"):
        _label(c[key])
    _require(isinstance(c["timezone"], str) and re.fullmatch(r"[A-Za-z][A-Za-z0-9_+/-]*", c["timezone"]) is not None)
    try:
        zone = ZoneInfo(c["timezone"])
    except (ZoneInfoNotFoundError, ValueError):
        raise ValueError(_ERROR) from None
    start, end = _week(c["start_week"]), _week(c["end_week"])
    _require(start <= end)
    stamp = c["as_of"]
    _require(isinstance(stamp, str) and re.fullmatch(r"\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|[+-]\d{2}:\d{2})", stamp) is not None)
    if not stamp.endswith("Z"):
        offset_hour, offset_minute = int(stamp[-5:-3]), int(stamp[-2:])
        _require(offset_hour <= 14 and offset_minute <= 59 and (offset_hour != 14 or offset_minute == 0))
    try:
        as_of = datetime.fromisoformat(stamp.replace("Z", "+00:00")).astimezone(timezone.utc)
    except (ValueError, OverflowError):
        raise ValueError(_ERROR) from None
    _require(c["outcome_kind"] in ("count", "revenue"))
    _require(isinstance(c["spend_currency"], str) and re.fullmatch(r"[A-Z]{3}", c["spend_currency"]) is not None)
    _require(c["outcome_currency"] is None if c["outcome_kind"] == "count" else isinstance(c["outcome_currency"], str) and re.fullmatch(r"[A-Z]{3}", c["outcome_currency"]) is not None)
    for key in ("channel_keys", "control_keys"):
        _require(type(c[key]) is list)
        for name in c[key]:
            _label(name)
        _require(len(set(c[key])) == len(c[key]))
    _require(not set(c["channel_keys"]) & set(c["control_keys"]))
    for key in ("min_weeks", "min_residual_df"):
        _require(type(c[key]) is int and c[key] >= 1)
    _number(c["max_condition_number"])
    _require(c["max_condition_number"] is not None and c["max_condition_number"] > 1)
    unique, duplicates = {}, 0
    for row in rows:  # Validate every raw row, including excluded and duplicate rows.
        _require(type(row) is dict and set(row) == _ROW)
        week = _week(row["week"])
        _require(row["spend_currency"] == c["spend_currency"] and row["outcome_currency"] == c["outcome_currency"])
        for vector, keys, nonnegative in (("spend", c["channel_keys"], True), ("controls", c["control_keys"], False)):
            _require(type(row[vector]) is dict and set(row[vector]) == set(keys))
            for value in row[vector].values():
                _number(value, nonnegative)
        _number(row["outcome"], True)
        if week in unique:
            _require(row == unique[week])
            duplicates += 1
        else:
            unique[week] = copy.deepcopy(row)
    return c, unique, duplicates, zone, start, end, as_of


def fit_weekly_mlr(payload):
    """Fit one explicitly scoped completed-week population, or return guarded status."""
    c, unique, duplicates, zone, start, end, as_of = _validated(payload)
    selected, incomplete = [], []
    week = start
    while week <= end:
        try:
            next_week = week + timedelta(days=7)
            completed = datetime.combine(next_week, time.min, zone).astimezone(timezone.utc) <= as_of
        except OverflowError:
            next_week, completed = None, False
        (selected if completed else incomplete).append(week)
        if next_week is None:
            break
        week = next_week
    predictors = [("channel", key) for key in c["channel_keys"]] + [("control", key) for key in c["control_keys"]]
    n, p = len(selected), len(predictors)
    missing_weeks, missing_fields = [], []
    for week in selected:
        row = unique.get(week)
        if row is None:
            missing_weeks.append(week.isoformat())
        else:
            fields = [f"spend:{key}" for key in c["channel_keys"] if row["spend"][key] is None]
            fields += [f"controls:{key}" for key in c["control_keys"] if row["controls"][key] is None]
            if row["outcome"] is None:
                fields.append("outcome")
            if fields:
                missing_fields.append({"week": week.isoformat(), "fields": fields})
    flags = []
    if p == 0:
        flags.append("intercept_only")
    if n == 0:
        flags.append("no_completed_weeks")
    if missing_weeks:
        flags.append("missing_weeks")
    if missing_fields:
        flags.append("unknown_required_values")
    if n < c["min_weeks"]:
        flags.append("min_weeks_not_met")
    if n - (p + 1) < c["min_residual_df"]:
        flags.append("min_residual_df_not_met")
    diagnostics = dict(n=n, p=p, residual_df=n - (p + 1), rank=None, singular_values=None, condition_number=None, r2=None,
                       rcond=float(np.finfo(np.float64).eps * max(n, p + 1)), missing_weeks=missing_weeks, missing_fields=missing_fields,
                       excluded_outside_window=[w.isoformat() for w in sorted(unique) if not start <= w <= end],
                       excluded_incomplete=[w.isoformat() for w in incomplete], duplicate_weeks_collapsed=duplicates,
                       zero_variance_predictors=[], negative_coefficients=[], flags=flags)
    result = dict(contract_version="0.1.0", config=copy.deepcopy(c), status="insufficient_input", intercept=None,
                  channel_coefficients=[dict(key=k, coefficient=None, mean_spend=None) for k in c["channel_keys"]],
                  control_coefficients=[dict(key=k, coefficient=None) for k in c["control_keys"]],
                  weeks=[dict(week=w.isoformat(), actual=unique[w]["outcome"] if w in unique else None, predicted=None, residual=None) for w in selected],
                  diagnostics=diagnostics, limits=list(_LIMITS))
    if any(flag != "intercept_only" for flag in flags):
        return result
    values = [[unique[w]["spend"][k] for k in c["channel_keys"]] + [unique[w]["controls"][k] for k in c["control_keys"]] for w in selected]
    actuals = [unique[w]["outcome"] for w in selected]
    # Valid finite integers can still be inexact in the float64 solver. Do not silently claim precision.
    if any(type(v) is int and float(v) != v for row in values + [actuals] for v in row):
        result["status"] = "numerical_failure"
        flags.append("float64_precision_loss")
        return result
    try:
        with np.errstate(over="raise", invalid="raise", divide="raise", under="ignore"):
            x = np.array(values, dtype=np.float64).reshape(n, p)
            y = np.array(actuals, dtype=np.float64)
            if p:
                scales = np.max(np.abs(x), axis=0)
                scaled = np.divide(x, scales, out=np.zeros_like(x), where=scales != 0)
                means_scaled = np.mean(scaled, axis=0)
                centered = scaled - means_scaled
                std_scaled = np.sqrt(np.mean(centered * centered, axis=0))
                means, stds = means_scaled * scales, std_scaled * scales
                standardized = np.divide(centered, std_scaled, out=np.zeros_like(centered), where=std_scaled != 0)
                diagnostics["zero_variance_predictors"] = [dict(kind=kind, key=key) for index, (kind, key) in enumerate(predictors) if std_scaled[index] == 0]
            else:
                means, stds, standardized = np.array([]), np.array([]), np.empty((n, 0))
            for index, row in enumerate(result["channel_coefficients"]):
                row["mean_spend"] = float(means[index])
            design = np.column_stack((np.ones(n), standardized))
            beta_standard, _, rank, singular = np.linalg.lstsq(design, y, rcond=diagnostics["rcond"])
            if not np.all(np.isfinite(singular)) or not np.all(np.isfinite(beta_standard)):
                raise FloatingPointError
            diagnostics["rank"] = int(rank)
            diagnostics["singular_values"] = singular.tolist()
            if diagnostics["zero_variance_predictors"]:
                flags.append("zero_variance_predictors")
            if rank < p + 1 or diagnostics["zero_variance_predictors"]:
                result["status"] = "rank_deficient"
                flags.append("rank_deficient")
                return result
            condition = float(singular[0] / singular[-1])
            if not math.isfinite(condition):
                raise FloatingPointError
            diagnostics["condition_number"] = condition
            if condition > c["max_condition_number"]:
                result["status"] = "ill_conditioned"
                flags.append("ill_conditioned")
                return result
            constant = all(value == actuals[0] for value in actuals)
            if constant:
                intercept, coefficients = float(actuals[0]), np.zeros(p)
                prediction, residual = np.full(n, intercept), np.zeros(n)
                flags.append("constant_outcome")
            else:
                coefficients = beta_standard[1:] / stds
                if np.any((beta_standard[1:] != 0) & (coefficients == 0)):
                    raise FloatingPointError
                intercept = float(beta_standard[0] - np.dot(means, coefficients))
                prediction = intercept + x @ coefficients
                reference_prediction = design @ beta_standard
                response_scale = max(float(np.max(np.abs(y))), float(np.max(np.abs(reference_prediction))))
                tolerance = np.finfo(np.float64).eps * max(n, p + 1) * condition * 32
                if not np.all(np.isfinite(prediction)) or not np.all(np.isfinite(coefficients)) or not math.isfinite(intercept):
                    raise FloatingPointError
                if not np.allclose(prediction / response_scale, reference_prediction / response_scale, rtol=tolerance, atol=tolerance):
                    raise FloatingPointError
                residual = y - prediction
                normalized_y = y / response_scale
                total = float(np.sum((normalized_y - np.mean(normalized_y)) ** 2))
                if total <= 0:
                    raise FloatingPointError
                diagnostics["r2"] = float(1 - np.sum((residual / response_scale) ** 2) / total)
                if not math.isfinite(diagnostics["r2"]):
                    raise FloatingPointError
            for index, (kind, key) in enumerate(predictors):
                if coefficients[index] < 0:
                    diagnostics["negative_coefficients"].append(dict(kind=kind, key=key))
            if diagnostics["negative_coefficients"]:
                flags.append("negative_coefficients")
            result["intercept"] = intercept
            for index, row in enumerate(result["channel_coefficients"] + result["control_coefficients"]):
                row["coefficient"] = float(coefficients[index])
            for index, row in enumerate(result["weeks"]):
                row.update(predicted=float(prediction[index]), residual=float(residual[index]))
            result["status"] = "fitted"
            json.dumps(result, allow_nan=False)
            return result
    except (FloatingPointError, OverflowError, np.linalg.LinAlgError, ValueError):
        result["status"] = "numerical_failure"
        result["intercept"] = None
        diagnostics["r2"] = None
        flags.append("nonfinite_or_unstable_computation")
        for row in result["channel_coefficients"] + result["control_coefficients"]:
            row["coefficient"] = None
        for row in result["weeks"]:
            row.update(predicted=None, residual=None)
        return result


def _object(pairs):
    result = {}
    for key, value in pairs:
        _require(key not in result)
        result[key] = value
    return result


def main():
    try:
        payload = json.load(sys.stdin, object_pairs_hook=_object, parse_constant=lambda _: (_ for _ in ()).throw(ValueError(_ERROR)))
        result = fit_weekly_mlr(payload)
        print(json.dumps(result, allow_nan=False, sort_keys=True))
    except (ValueError, TypeError, OverflowError):
        print(json.dumps({"error": _ERROR}), file=sys.stderr)
        return 2
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
