#!/usr/bin/env python3
"""Run reproducible, no-tool model evaluations for channel-taxonomy.

The expected answers live in eval-cases.json and are never included in prompts.
Use --self-test for local parser/scorer validation. Live calls are intentionally
opt-in through --run; the parent task runs that only after the core docs settle.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import subprocess
import sys
import tempfile
import urllib.request
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

HERE = Path(__file__).resolve().parent
SKILL_DIR = HERE.parent
CASES_PATH = SKILL_DIR / "references" / "eval-cases.json"
RESULTS_PATH = SKILL_DIR / "references" / "eval-results.json"
REPORT_PATH = Path.home() / "Downloads" / "channel-taxonomy-evaluation-report.md"
CLAUDE_MODELS = ("claude-fable-5-1", "claude-sonnet-5")
OLLAMA_MODEL = "qwen3:4b"


def sha256(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def load_cases() -> dict[str, Any]:
    return json.loads(CASES_PATH.read_text())


def resources() -> dict[str, str]:
    names = ("SKILL.md", "references/channel-contract.md", "references/source-mappings.md")
    return {name: (SKILL_DIR / name).read_text() for name in names}


def prompt_for(group: dict[str, Any]) -> str:
    inputs = [{"id": c["id"], "input": c["input"]} for c in group["cases"]]
    return (
        "You are evaluating a channel taxonomy. Use only the raw inputs below and the "
        "instructions in your system context. Do not invent evidence. Return exactly one "
        "JSON object and no markdown. For the classification cases, return `channels` as "
        "an array containing every case id exactly once with its canonical channel, plus "
        "the requested evidence-preservation fields. For the interoperability "
        "cases, return the requested contract fields and no per-case explanations. "
        "Preserve native and raw fields conceptually even when classifying.\n\n"
        f"GROUP: {group['title']}\nOUTPUT SHAPE: {group['output_shape']}\n"
        f"CASES (raw input only):\n{json.dumps(inputs, indent=2, sort_keys=True)}"
    )


def system_prompt(condition: str, docs: dict[str, str]) -> str:
    base = (
        "You are a careful evaluator. Follow the requested JSON output exactly. "
        "Never claim that a routing label proves ad spend, delivery, or causality."
    )
    if condition == "with-skill":
        return base + "\n\nApply this channel-taxonomy skill context:\n\n" + "\n\n".join(
            f"--- {name} ---\n{text}" for name, text in docs.items()
        )
    return base


def extract_json(value: Any) -> Any:
    """Parse Claude JSON envelopes, plain JSON, fenced JSON, or first balanced JSON."""
    if isinstance(value, dict) and "result" in value and isinstance(value["result"], str):
        value = value["result"]
    if isinstance(value, dict) and isinstance(value.get("message"), dict):
        content = value["message"].get("content")
        if isinstance(content, list):
            value = "\n".join(block.get("text", "") for block in content if isinstance(block, dict))
        elif isinstance(content, str):
            value = content
    if isinstance(value, (dict, list)):
        return value
    text = str(value).strip()
    candidates = [text]
    candidates += re.findall(r"```(?:json)?\s*([\s\S]*?)\s*```", text, re.I)
    for candidate in candidates:
        try:
            return json.loads(candidate)
        except json.JSONDecodeError:
            pass
    for start, char in enumerate(text):
        if char not in "{[":
            continue
        close = "}" if char == "{" else "]"
        depth = 0
        in_string = False
        escaped = False
        for pos in range(start, len(text)):
            current = text[pos]
            if in_string:
                if escaped:
                    escaped = False
                elif current == "\\":
                    escaped = True
                elif current == '"':
                    in_string = False
                continue
            if current == '"':
                in_string = True
            elif current == char:
                depth += 1
            elif current == close:
                depth -= 1
                if depth == 0:
                    try:
                        return json.loads(text[start : pos + 1])
                    except json.JSONDecodeError:
                        break
    raise ValueError("no valid JSON object/array found in model response")


def score(group: dict[str, Any], parsed: Any) -> dict[str, Any]:
    expected = group["expected_contract"]
    checks: dict[str, bool] = {}
    if group["id"] != "cross-source-interoperability":
        rows = parsed.get("channels", []) if isinstance(parsed, dict) else []
        ids = [item.get("id") for item in rows if isinstance(item, dict)]
        got = {item.get("id"): item.get("channel") for item in rows if isinstance(item, dict)}
        expected_channels = {c["id"]: c["expected"]["channel"] for c in group["cases"]}
        checks["case_ids_unique_and_complete"] = len(ids) == len(set(ids)) and set(ids) == set(expected_channels)
        checks["all_channels"] = checks["case_ids_unique_and_complete"] and got == expected_channels
        checks["paid_evidence_proven"] = isinstance(parsed, dict) and parsed.get("paid_evidence_proven") is expected["paid_evidence_proven"]
        checks["preserve_raw"] = isinstance(parsed, dict) and parsed.get("preserve_raw") is expected["preserve_raw"]
        item_scores = [{"id": c["id"], "pass": checks["case_ids_unique_and_complete"] and got.get(c["id"]) == c["expected"]["channel"]} for c in group["cases"]]
        item_scores += [{"id": key, "pass": value} for key, value in checks.items() if key != "all_channels"]
    else:
        got = parsed if isinstance(parsed, dict) else {}
        checks = {
            "source_identity_keys": _identity_keys_match(got.get("source_identity_keys"), expected["source_identity_keys"]),
            "can_sum_overlapping_sessions": _overlap_match(got.get("can_sum_overlapping_sessions")),
            "attribution_bases": _attribution_bases_match(got.get("attribution_bases"), expected["attribution_bases"]),
            "daily_grain": _field_set_match(got.get("daily_grain"), expected["daily_grain"], {"source": "source_system"}),
            "common_metrics": _common_metrics_match(got.get("common_metrics"), expected["common_metrics"]),
            "unknown_revenue": "unknown_revenue" in got and _unknown_revenue_match(got.get("unknown_revenue")),
            "mixed_currency_total": "mixed_currency_total" in got and _mixed_currency_match(got.get("mixed_currency_total")),
        }
        item_scores = [{"id": key, "pass": value} for key, value in checks.items()]
    passed = sum(1 for item in item_scores if item["pass"])
    return {"checks": checks, "items": item_scores, "passed": passed, "total": len(item_scores), "score": passed / len(item_scores)}


def _attribution_bases_match(got: Any, expected: dict[str, str]) -> bool:
    if not isinstance(got, dict):
        return False
    aliases = {
        "session_last_click": {"session_last_click", "session last-click", "session last click"},
        "first_touch": {"first_touch", "first touch", "first collected touch", "first collected_touch"},
    }
    values = {}
    for key, value in got.items():
        if isinstance(value, str):
            normalized_key = key.replace("-", "_")
            values[normalized_key] = value.strip().lower()
            if normalized_key == "ga4_attribution_basis":
                values["ga4"] = value.strip().lower()
            if normalized_key == "pixel_attribution_basis":
                values["pixel"] = value.strip().lower()
        elif isinstance(value, dict):
            values.update({k.replace("-", "_"): str(v).strip().lower() for k, v in value.items() if isinstance(v, str)})
    pixel = values.get("first_party_pixel") or values.get("pixel") or values.get("first_party")
    return values.get("ga4") in aliases[expected["ga4"]] and pixel in aliases[expected["first_party_pixel"]]


def _identity_keys_match(got: Any, expected: list[str]) -> bool:
    if isinstance(got, dict):
        got = got.get("required_fields")
    if not isinstance(got, list):
        return False
    aliases = {"source": "source_system", "scope": "source_scope", "session_id": "session_key", "visitor_id": "visitor_key"}
    normalized = {aliases.get(str(item), str(item)) for item in got}
    return normalized == set(expected)


def _field_set_match(got: Any, expected: list[str], aliases: dict[str, str] | None = None) -> bool:
    if isinstance(got, dict):
        got = got.get("canonical_grain")
    if not isinstance(got, list):
        return False
    aliases = aliases or {}
    normalized = {aliases.get(str(item), str(item)) for item in got}
    return normalized == set(expected)


def _overlap_match(got: Any) -> bool:
    if got is False:
        return True
    if isinstance(got, dict):
        values = [value for value in got.values() if isinstance(value, bool)]
        return bool(values) and all(value is False for value in values)
    return False


def _common_metrics_match(got: Any, expected: list[str]) -> bool:
    if isinstance(got, dict):
        got = got.get("required") or got.get("core_present")
    return isinstance(got, list) and set(expected).issubset(set(got))


def _unknown_revenue_match(got: Any) -> bool:
    if not isinstance(got, dict):
        return False
    statuses = {"unknown_or_mixed_currency", "unknown", "unknown_currency", "mixed_currency", "null_plus_status", "NULL_plus_status", "mixed_currency_requires_explicit_fx"}
    if "value" in got and got.get("value") is None and got.get("status") in statuses:
        return True
    return any(_unknown_revenue_match(value) for value in got.values() if isinstance(value, dict))


def _mixed_currency_match(got: Any) -> bool:
    if got is None:
        return True
    if not isinstance(got, dict):
        return False
    if ("value" in got and got.get("value") is None) or ("total" in got and got.get("total") is None):
        return got.get("summable") is False or got.get("status") is not None
    return any(_mixed_currency_match(value) for value in got.values() if isinstance(value, dict))


def report_for(results: dict[str, Any]) -> str:
    lines = [
        "# Channel taxonomy model evaluation",
        "",
        f"Run window: {results.get('started_at')} to {results.get('finished_at')}",
        f"Current cases SHA-256: `{results.get('cases_sha256_current', results.get('cases_sha256'))}`",
        f"Initial-format raw checkpoint: `eval-results-initial-format.json` (initial cases SHA-256 `{results.get('cases_sha256')}`).",
        "",
        "This report uses three fixed prompts, eight independent synthetic cases per prompt, "
        "with seven contract invariants scored for the interoperability prompt, and expected "
        "answers kept outside the model context. `with-skill` injects only the "
        "skill and its two reference documents; `without-skill` uses an isolated temporary "
        "working directory, safe mode, no automatic skills, no tools, and an empty MCP configuration.",
        "The current group 3 scores were rerun after making its output types explicit and tightening the rubric to require explicit unknown/mixed revenue status and explicit mixed-currency NULL handling. Classification groups remain from the initial-format run unchanged.",
        "",
        "## Before/after scores",
        "",
        "| Model | Group | Without skill | With skill | Delta |",
        "| --- | --- | ---: | ---: | ---: |",
    ]
    for model, conditions in results.get("models", {}).items():
        for group in results["groups"]:
            before = conditions.get("without-skill", {}).get(group, {}).get("grading", {}).get("score")
            after = conditions.get("with-skill", {}).get(group, {}).get("grading", {}).get("score")
            if before is None or after is None:
                lines.append(f"| {model} | {group} | n/a | n/a | n/a |")
            else:
                lines.append(f"| {model} | {group} | {before:.3f} | {after:.3f} | {after - before:+.3f} |")
    lines += [
        "",
        "## Reproduction details",
        "",
        f"Claude CLI: `{results.get('cli_version', 'unavailable')}`. Claude model IDs requested: `{', '.join(CLAUDE_MODELS)}`. Open-weight model requested: `{OLLAMA_MODEL}` via `http://127.0.0.1:11435/api/chat`.",
        "Claude calls use `CLAUDE_CODE_SIMPLE_SYSTEM_PROMPT=1 claude --safe-mode --no-session-persistence --disable-slash-commands --tools '' --strict-mcp-config --mcp-config '{\"mcpServers\":{}}'`; this disables customizations and tools while retaining the authenticated OAuth path. All calls use `--output-format json --max-budget-usd 2`. Qwen uses `stream:false`, `think:false`, `num_ctx:16384`, `num_predict:2000`, and `temperature:0`. The full prompts, raw responses, parsed outputs, item scores, model metadata, and errors are in `eval-results.json`.",
        "",
        "Skill context SHA-256:",
    ]
    for name, digest in results.get("skill_context_sha256", {}).items():
        lines.append(f"- `{name}`: `{digest}`")
    lines += ["", "## Response validity", "", "| Model | Condition | Calls | Transport success | Parsed JSON | Completed output |", "| --- | --- | ---: | ---: | ---: | ---: |"]
    for model, conditions in results.get("models", {}).items():
        for condition, groups in conditions.items():
            calls = list(groups.values())
            transport = sum(1 for item in calls if item.get("response", {}).get("exit_code") == 0)
            parsed = sum(1 for item in calls if item.get("parsed") is not None)
            completed = sum(1 for item in calls if _response_completed(item.get("response", {}).get("raw")))
            lines.append(f"| {model} | {condition} | {len(calls)} | {transport} | {parsed} | {completed} |")
    lines += [
        "",
        "A parsed fragment from a response whose generation ended with Qwen `done_reason=length` is retained for audit but counted as an output-format/truncation failure in the validity table; its score is not evidence of classification knowledge. No credentials, client IDs, or private customer data are included; all inputs are synthetic. Scores are rubric results, and a zero delta is a valid outcome.",
        "",
    ]
    return "\n".join(lines)


def _response_completed(raw: Any) -> bool:
    if not isinstance(raw, dict):
        return False
    if raw.get("done_reason") == "length":
        return False
    if raw.get("is_error") or raw.get("subtype") in {"error_max_budget_usd", "error"}:
        return False
    return True


def claude_call(model: str, condition: str, prompt: str, docs: dict[str, str], cwd: Path) -> dict[str, Any]:
    cmd = ["claude", "--safe-mode", "--no-session-persistence", "--disable-slash-commands", "--tools", "", "--strict-mcp-config", "--mcp-config", '{"mcpServers":{}}', "--model", model, "--output-format", "json", "--max-budget-usd", "2", "--system-prompt", system_prompt(condition, docs), "-p", prompt]
    env = dict(os.environ)
    env["CLAUDE_CODE_SIMPLE_SYSTEM_PROMPT"] = "1"
    completed = subprocess.run(cmd, cwd=cwd, env=env, text=True, capture_output=True, timeout=300)
    raw = completed.stdout.strip()
    envelope: Any = None
    try:
        envelope = json.loads(raw)
    except json.JSONDecodeError:
        envelope = raw
    return {"exit_code": completed.returncode, "stderr": completed.stderr[-4000:], "raw": envelope, "command": cmd[:cmd.index("--system-prompt")], "model": model}


def qwen_call(prompt: str, docs: dict[str, str], condition: str) -> dict[str, Any]:
    body = {"model": OLLAMA_MODEL, "stream": False, "think": False, "options": {"num_ctx": 16384, "num_predict": 2000, "temperature": 0}, "messages": [{"role": "system", "content": system_prompt(condition, docs)}, {"role": "user", "content": prompt}]}
    request = urllib.request.Request("http://127.0.0.1:11435/api/chat", data=json.dumps(body).encode(), headers={"Content-Type": "application/json"})
    with urllib.request.urlopen(request, timeout=300) as response:
        envelope = json.loads(response.read())
    return {"exit_code": 0, "stderr": "", "raw": envelope, "model": envelope.get("model", OLLAMA_MODEL), "requested_model": OLLAMA_MODEL}


def ollama_identity() -> dict[str, Any]:
    request = urllib.request.Request("http://127.0.0.1:11435/api/tags")
    with urllib.request.urlopen(request, timeout=15) as response:
        payload = json.loads(response.read())
    for model in payload.get("models", []):
        if model.get("name") == OLLAMA_MODEL or model.get("name", "").split(":")[0] == OLLAMA_MODEL.split(":")[0]:
            return {"name": model.get("name"), "digest": model.get("digest"), "details": model.get("details", {})}
    return {"name": None, "digest": None, "available_models": [m.get("name") for m in payload.get("models", [])]}


def claude_probe(model: str, cwd: Path) -> dict[str, Any]:
    """Verify the exact isolated flags before spending the full matrix budget."""
    cmd = ["claude", "--safe-mode", "--no-session-persistence", "--disable-slash-commands", "--tools", "", "--strict-mcp-config", "--mcp-config", '{"mcpServers":{}}', "--model", model, "--output-format", "json", "--max-budget-usd", "2", "--system-prompt", "Return only valid JSON.", "-p", "Return {}."]
    env = dict(os.environ)
    env["CLAUDE_CODE_SIMPLE_SYSTEM_PROMPT"] = "1"
    completed = subprocess.run(cmd, cwd=cwd, env=env, text=True, capture_output=True, timeout=120)
    raw = completed.stdout.strip()
    try:
        envelope = json.loads(raw)
    except json.JSONDecodeError:
        envelope = raw
    return {"exit_code": completed.returncode, "stderr": completed.stderr[-4000:], "raw": envelope, "requested_model": model, "command": cmd[:cmd.index("--system-prompt")]}


def checkpoint(results: dict[str, Any], output: Path) -> None:
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(results, indent=2, sort_keys=True) + "\n")


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--run", action="store_true", help="make live model calls")
    parser.add_argument("--self-test", action="store_true")
    parser.add_argument("--condition", choices=("with-skill", "without-skill", "both"), default="both")
    parser.add_argument("--models", nargs="+", default=[*CLAUDE_MODELS, "qwen3:4b"])
    parser.add_argument("--output", type=Path, default=RESULTS_PATH)
    parser.add_argument("--report", type=Path, default=REPORT_PATH)
    parser.add_argument("--groups", nargs="+", help="limit live calls to these group IDs")
    parser.add_argument("--resume", type=Path, help="merge selected group calls into an existing results checkpoint")
    args = parser.parse_args()
    cases = load_cases()
    docs = resources()
    if args.self_test:
        assert extract_json('prefix ```json {"channels": []} ``` suffix') == {"channels": []}
        assert extract_json({"result": '{"ok":true}'}) == {"ok": True}
        assert extract_json({"model": "qwen3:4b", "message": {"content": "```json\n{\"ok\": true}\n```"}}) == {"ok": True}
        for group in cases["groups"]:
            expected = group["expected_contract"]
            if group["id"] != "cross-source-interoperability":
                expected = {"channels": [{"id": c["id"], "channel": c["expected"]["channel"]} for c in group["cases"]], **expected}
            assert score(group, expected)["score"] == 1, group["id"]
            bad = json.loads(json.dumps(expected))
            if group["id"] == "cross-source-interoperability":
                bad["mixed_currency_total"] = 1
            else:
                bad["channels"][0]["channel"] = "Other"
                bad["paid_evidence_proven"] = True
            assert score(group, bad)["score"] < 1, f"bad answer scored as pass: {group['id']}"
        assert score(cases["groups"][0], {"channels": [], "paid_evidence_proven": False, "preserve_raw": True})["score"] < 1
        contract_group = cases["groups"][2]
        assert score(contract_group, {})["score"] == 0
        assert score(contract_group, {"unknown_revenue": None, "mixed_currency_total": None})["checks"]["unknown_revenue"] is False
        for bad in (
            {"unknown_revenue": {}, "mixed_currency_total": {}},
            {"unknown_revenue": {"value": 0, "status": "known"}, "mixed_currency_total": 0},
        ):
            assert score(contract_group, bad)["checks"]["unknown_revenue"] is False
            assert score(contract_group, bad)["checks"]["mixed_currency_total"] is False
        try:
            extract_json("not json")
        except ValueError:
            pass
        else:
            raise AssertionError("malformed output must fail parsing")
        print("PASS parser and scorer self-tests")
        if not args.run:
            return 0
    if not args.run:
        print("READY: pass --run after the reviewed core skill/docs are ready")
        return 0
    conditions = ("with-skill", "without-skill") if args.condition == "both" else (args.condition,)
    timestamp = datetime.now(timezone.utc).isoformat()
    run_groups = [group for group in cases["groups"] if not args.groups or group["id"] in args.groups]
    unknown_groups = set(args.groups or ()) - {group["id"] for group in cases["groups"]}
    if unknown_groups:
        raise ValueError(f"unknown groups: {', '.join(sorted(unknown_groups))}")
    if args.resume:
        results = json.loads(args.resume.read_text())
        results.setdefault("prior_runs", []).append(args.resume.name)
        results["resumed_at"] = timestamp
        results["cases_sha256_current"] = sha256(CASES_PATH.read_bytes())
    else:
        results = {"schema_version": 1, "started_at": timestamp, "cases_sha256": sha256(CASES_PATH.read_bytes()), "skill_context_sha256": {name: sha256(text.encode()) for name, text in docs.items()}, "models": {}, "groups": [g["id"] for g in cases["groups"]], "cli_version": subprocess.run(["claude", "--version"], capture_output=True, text=True).stdout.strip(), "ollama_identity": None, "probes": {}}
    with tempfile.TemporaryDirectory(prefix="channel-taxonomy-eval-") as isolated:
        isolated_path = Path(isolated)
        if not results.get("ollama_identity"):
            try:
                results["ollama_identity"] = ollama_identity()
            except Exception as exc:
                results["ollama_identity"] = {"error": f"{type(exc).__name__}: {exc}"}
        for model in args.models:
            if model == OLLAMA_MODEL:
                continue
            probe = claude_probe(model, isolated_path)
            results["probes"][model] = {"exit_code": probe["exit_code"], "requested_model": model, "raw": probe["raw"], "stderr": probe["stderr"]}
            if probe["exit_code"] != 0:
                checkpoint(results, args.output)
                raise RuntimeError(f"Claude isolation probe failed for {model}; see {args.output}")
        for model in args.models:
            results["models"].setdefault(model, {})
            for condition in conditions:
                results["models"][model].setdefault(condition, {})
                for group in run_groups:
                    prompt = prompt_for(group)
                    call = None
                    try:
                        call = qwen_call(prompt, docs, condition) if model == OLLAMA_MODEL else claude_call(model, condition, prompt, docs, isolated_path)
                        parsed = extract_json(call["raw"])
                        grading = score(group, parsed)
                    except Exception as exc:  # preserve failures for honest comparisons
                        if call is None:
                            call = {"exit_code": 1, "stderr": f"{type(exc).__name__}: {exc}", "raw": None, "model": model, "requested_model": model, "error_kind": "transport_or_invocation"}
                        else:
                            call["error_kind"] = "parse_or_scoring"
                            call["error"] = f"{type(exc).__name__}: {exc}"
                        failure_items = [{"id": c["id"], "pass": False} for c in group["cases"]] if group["id"] != "cross-source-interoperability" else [{"id": key, "pass": False} for key in ("source_identity_keys", "can_sum_overlapping_sessions", "attribution_bases", "daily_grain", "common_metrics", "unknown_revenue", "mixed_currency_total")]
                        parsed, grading = None, {"checks": {}, "items": failure_items, "passed": 0, "total": len(failure_items), "score": 0}
                    results["models"][model][condition][group["id"]] = {"prompt": prompt, "prompt_sha256": sha256(prompt.encode()), "response": call, "parsed": parsed, "grading": grading}
                    checkpoint(results, args.output)
                    print(f"completed model={model} condition={condition} group={group['id']} score={grading['score']:.3f}", flush=True)
    results["finished_at"] = datetime.now(timezone.utc).isoformat()
    checkpoint(results, args.output)
    args.report.parent.mkdir(parents=True, exist_ok=True)
    args.report.write_text(report_for(results))
    repo_report = SKILL_DIR / "references" / "eval-results.md"
    repo_report.write_text(report_for(results))
    print(f"Wrote {args.output}")
    print(f"Wrote {args.report}")
    print(f"Wrote {repo_report}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
