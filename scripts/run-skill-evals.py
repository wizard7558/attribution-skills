#!/usr/bin/env python3
"""Reproducible model evaluations for any skill with references/eval-cases.json.

Live calls are opt-in with --run. Self-tests are transport-free and never contact a
model or network. Expected answers live only in manifest checks and are never placed
in the model prompt.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import math
import os
import subprocess
import sys
import tempfile
import time
import urllib.error
import urllib.request
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

DEFAULT_MODELS = ("claude-fable-5-1", "claude-sonnet-5", "qwen3:4b")
CLAUDE_MODELS = set(DEFAULT_MODELS[:2])
VALID_OPS = {"equals", "set_equals", "approximately", "array_length_equals"}
JSON_TYPES = {"object", "array", "string", "number", "integer", "boolean", "null"}
HARNESS_VERSION = "2026-09-08.3"


def now() -> str:
    return datetime.now(timezone.utc).isoformat()


def digest_bytes(value: bytes) -> str:
    return hashlib.sha256(value).hexdigest()


def digest_json(value: Any) -> str:
    return digest_bytes(json.dumps(value, sort_keys=True, separators=(",", ":")).encode())


def harness_hash() -> str:
    return digest_bytes(Path(__file__).read_bytes())


def cli_version() -> str:
    try:
        completed = subprocess.run(["claude", "--version"], capture_output=True, text=True, timeout=30)
        return (completed.stdout or completed.stderr).strip() or "unavailable"
    except Exception:
        return "unavailable"


def atomic_write(path: Path, content: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_name(f".{path.name}.tmp-{os.getpid()}")
    temporary.write_text(content)
    os.replace(temporary, path)


def read_json(path: Path) -> Any:
    try:
        return json.loads(path.read_text(), parse_constant=lambda value: (_ for _ in ()).throw(ValueError(f"non-finite JSON constant: {value}")))
    except (OSError, json.JSONDecodeError) as exc:
        raise ValueError(f"cannot read JSON {path}: {exc}") from exc


def inside(root: Path, candidate: Path) -> bool:
    try:
        candidate.resolve().relative_to(root.resolve())
        return True
    except ValueError:
        return False


def validate_manifest(skill: Path) -> tuple[dict[str, Any], dict[str, str], str]:
    skill = skill.resolve()
    manifest_path = skill / "references" / "eval-cases.json"
    if not manifest_path.is_file():
        raise ValueError(f"missing manifest: {manifest_path}")
    manifest = read_json(manifest_path)
    if not isinstance(manifest, dict):
        raise ValueError("manifest must be an object")
    if set(manifest) != {"context_files", "groups"}:
        raise ValueError("manifest keys must be exactly context_files and groups")
    contexts = manifest["context_files"]
    groups = manifest["groups"]
    if not isinstance(contexts, list) or not all(isinstance(item, str) and item for item in contexts):
        raise ValueError("context_files must be a list of nonempty relative paths")
    context_hashes: dict[str, str] = {}
    for relative in contexts:
        path = (skill / relative).resolve()
        if Path(relative).is_absolute() or not inside(skill, path) or not path.is_file():
            raise ValueError(f"context file must exist under skill: {relative}")
        context_hashes[relative] = digest_bytes(path.read_bytes())
    if not isinstance(groups, list) or not groups:
        raise ValueError("groups must be a nonempty list")
    ids: set[str] = set()
    for group in groups:
        if not isinstance(group, dict) or set(group) != {"id", "prompt", "input", "output_schema", "checks"}:
            raise ValueError("each group must have exactly id, prompt, input, output_schema, checks")
        group_id = group["id"]
        if not isinstance(group_id, str) or not group_id or group_id in ids:
            raise ValueError(f"group id must be unique and nonempty: {group_id!r}")
        ids.add(group_id)
        if not isinstance(group["prompt"], str) or not group["prompt"].strip():
            raise ValueError(f"group {group_id}: prompt must be nonempty")
        if not isinstance(group["output_schema"], dict):
            raise ValueError(f"group {group_id}: output_schema must be an object")
        validate_types_only_schema(group["output_schema"], f"group {group_id} output_schema")
        checks = group["checks"]
        if not isinstance(checks, list):
            raise ValueError(f"group {group_id}: checks must be a list")
        for check in checks:
            validate_check(check, group_id)
    return manifest, context_hashes, digest_bytes(manifest_path.read_bytes())


def validate_types_only_schema(schema: Any, label: str) -> None:
    if not isinstance(schema, dict):
        raise ValueError(f"{label} must be an object")
    if "type" in schema:
        declared = schema["type"] if isinstance(schema["type"], list) else [schema["type"]]
        if not declared or not all(isinstance(value, str) and value in JSON_TYPES for value in declared):
            raise ValueError(f"{label}.type contains unsupported JSON type")
    allowed = {"type", "properties", "required", "items", "additionalProperties", "anyOf", "oneOf"}
    unknown = set(schema) - allowed
    if unknown:
        raise ValueError(f"{label} contains non-type schema keys: {', '.join(sorted(unknown))}")
    if "properties" in schema:
        if not isinstance(schema["properties"], dict):
            raise ValueError(f"{label}.properties must be an object")
        for key, value in schema["properties"].items():
            validate_types_only_schema(value, f"{label}.properties.{key}")
    if "required" in schema and (not isinstance(schema["required"], list) or not all(isinstance(v, str) for v in schema["required"])):
        raise ValueError(f"{label}.required must be a list of strings")
    if "properties" in schema and "required" in schema and any(key not in schema["properties"] for key in schema["required"]):
        raise ValueError(f"{label}.required references an undeclared property")
    if "items" in schema:
        if not isinstance(schema["items"], dict):
            raise ValueError(f"{label}.items must be a schema object")
        validate_types_only_schema(schema["items"], f"{label}.items")
    if "additionalProperties" in schema:
        if not isinstance(schema["additionalProperties"], (bool, dict)):
            raise ValueError(f"{label}.additionalProperties must be boolean or schema")
        if isinstance(schema["additionalProperties"], dict):
            validate_types_only_schema(schema["additionalProperties"], f"{label}.additionalProperties")
    for key in ("anyOf", "oneOf"):
        if key in schema:
            if not isinstance(schema[key], list):
                raise ValueError(f"{label}.{key} must be a list")
            for index, value in enumerate(schema[key]):
                validate_types_only_schema(value, f"{label}.{key}[{index}]")


def validate_check(check: Any, group_id: str) -> None:
    if not isinstance(check, dict) or "path" not in check or "op" not in check or "expected" not in check:
        raise ValueError(f"group {group_id}: each check needs path, op, expected")
    if not isinstance(check["path"], str) or (check["path"] and not check["path"].startswith("/")):
        raise ValueError(f"group {group_id}: check path must be an RFC 6901 pointer")
    if check["op"] not in VALID_OPS:
        raise ValueError(f"group {group_id}: unsupported check op {check['op']!r}")
    if check["op"] == "array_length_equals":
        if type(check["expected"]) is not int or check["expected"] < 0:
            raise ValueError(f"group {group_id}: array_length_equals expected must be a nonnegative integer")
    if check["op"] == "approximately":
        tolerance = check.get("tolerance")
        if not isinstance(tolerance, (int, float)) or not math.isfinite(tolerance) or tolerance < 0:
            raise ValueError(f"group {group_id}: approximately requires finite nonnegative tolerance")
        if not isinstance(check["expected"], (int, float)) or isinstance(check["expected"], bool) or not math.isfinite(check["expected"]):
            raise ValueError(f"group {group_id}: approximately expected must be finite numeric")


def types_only_schema(schema: dict[str, Any]) -> dict[str, Any]:
    """Keep only JSON-schema type structure, excluding answers and descriptive examples."""
    result: dict[str, Any] = {}
    for key in ("type", "required"):
        if key in schema:
            result[key] = schema[key]
    if "additionalProperties" in schema:
        result["additionalProperties"] = types_only_schema(schema["additionalProperties"]) if isinstance(schema["additionalProperties"], dict) else schema["additionalProperties"]
    if "properties" in schema:
        result["properties"] = {key: types_only_schema(value) for key, value in schema["properties"].items()}
    if isinstance(schema.get("items"), dict):
        result["items"] = types_only_schema(schema["items"])
    for key in ("anyOf", "oneOf"):
        if key in schema:
            result[key] = [types_only_schema(value) for value in schema[key]]
    return result


def prompt_for(group: dict[str, Any]) -> str:
    payload = {"prompt": group["prompt"], "input": group["input"], "output_schema": types_only_schema(group["output_schema"])}
    return json.dumps(payload, indent=2, sort_keys=True)


def system_prompt(condition: str, contexts: dict[str, str]) -> str:
    base = "Return exactly one JSON value conforming to the output schema. Use only the supplied input and instructions. Do not add markdown or explanations."
    if condition == "without-skill":
        return base
    return base + "\n\nSkill context files:\n" + "\n\n".join(f"--- {name} ---\n{text}" for name, text in contexts.items())


def json_pointer(value: Any, pointer: str) -> tuple[bool, Any]:
    if pointer == "":
        return True, value
    current = value
    for token in pointer[1:].split("/"):
        token = token.replace("~1", "/").replace("~0", "~")
        if isinstance(current, dict) and token in current:
            current = current[token]
        elif isinstance(current, list) and token.isdigit() and int(token) < len(current):
            current = current[int(token)]
        else:
            return False, None
    return True, current


def compare(check: dict[str, Any], parsed: Any) -> dict[str, Any]:
    present, actual = json_pointer(parsed, check["path"])
    expected = check["expected"]
    passed = False
    if present:
        if check["op"] == "equals":
            passed = strict_equal(actual, expected)
        elif check["op"] == "set_equals":
            passed = isinstance(actual, list) and isinstance(expected, list) and {digest_json(v) for v in actual} == {digest_json(v) for v in expected}
        elif check["op"] == "array_length_equals":
            passed = isinstance(actual, list) and type(expected) is int and expected >= 0 and len(actual) == expected
        else:
            passed = isinstance(actual, (int, float)) and not isinstance(actual, bool) and math.isfinite(actual) and abs(actual - expected) <= check["tolerance"]
    return {"path": check["path"], "op": check["op"], "passed": passed, "present": present, "actual": actual if present else None, "expected": expected}


def strict_equal(actual: Any, expected: Any) -> bool:
    if type(actual) is not type(expected):
        return False
    if isinstance(actual, dict):
        return set(actual) == set(expected) and all(strict_equal(actual[key], expected[key]) for key in actual)
    if isinstance(actual, list):
        return len(actual) == len(expected) and all(strict_equal(left, right) for left, right in zip(actual, expected))
    return actual == expected


def schema_type_ok(value: Any, schema: dict[str, Any]) -> bool:
    if "oneOf" in schema and sum(schema_type_ok(value, option) for option in schema["oneOf"]) != 1:
        return False
    if "anyOf" in schema and not any(schema_type_ok(value, option) for option in schema["anyOf"]):
        return False
    types = schema.get("type")
    if isinstance(types, str):
        types = [types]
    if types and not any({"object": isinstance(value, dict), "array": isinstance(value, list), "string": isinstance(value, str), "number": isinstance(value, (int, float)) and not isinstance(value, bool) and math.isfinite(value), "integer": isinstance(value, int) and not isinstance(value, bool), "boolean": isinstance(value, bool), "null": value is None}.get(kind, False) for kind in types):
        return False
    declared_types = schema.get("type", [])
    declared_types = [declared_types] if isinstance(declared_types, str) else declared_types
    if isinstance(value, dict) and ("object" in declared_types or any(key in schema for key in ("properties", "required", "additionalProperties"))):
        properties = schema.get("properties", {})
        if any(key not in value for key in schema.get("required", [])):
            return False
        extras = [key for key in value if key not in properties]
        additional = schema.get("additionalProperties", True)
        if extras and additional is False:
            return False
        if isinstance(additional, dict) and any(not schema_type_ok(value[key], additional) for key in extras):
            return False
        return all(key not in value or schema_type_ok(value[key], child) for key, child in properties.items())
    if isinstance(value, list) and isinstance(schema.get("items"), dict):
        return all(schema_type_ok(item, schema["items"]) for item in value)
    return True


def parse_full_json(raw: Any) -> Any:
    value = raw
    if isinstance(value, dict) and "structured_output" in value:
        value = value["structured_output"]
    elif isinstance(value, dict) and "result" in value:
        value = value["result"]
    elif isinstance(value, dict) and isinstance(value.get("message"), dict):
        content = value["message"].get("content")
        if isinstance(content, list):
            value = "".join(block.get("text", "") for block in content if isinstance(block, dict) and isinstance(block.get("text"), str))
        else:
            value = content
    if isinstance(value, (dict, list)):
        ensure_finite(value)
        return value
    if not isinstance(value, str):
        raise ValueError("model response has no JSON content")
    text = value.strip()
    if text.startswith("```json") and text.endswith("```"):
        text = text[7:-3].strip()
    elif text.startswith("```") and text.endswith("```"):
        text = text[3:-3].strip()
    if not text:
        raise ValueError("empty model response")
    parsed = json.loads(text, parse_constant=lambda constant: (_ for _ in ()).throw(ValueError(f"non-finite JSON constant: {constant}")))
    ensure_finite(parsed)
    return parsed


def ensure_finite(value: Any) -> None:
    if isinstance(value, float) and not math.isfinite(value):
        raise ValueError("non-finite structured output")
    if isinstance(value, dict):
        for child in value.values():
            ensure_finite(child)
    elif isinstance(value, list):
        for child in value:
            ensure_finite(child)


def completion_status(raw: Any, parsed: Any, parse_error: str | None, transport_exit: int | None = 0) -> str:
    if transport_exit not in (None, 0):
        return "transport_failure"
    if parse_error:
        return "incomplete" if isinstance(raw, dict) and (raw.get("done_reason") == "length" or raw.get("stop_reason") == "max_tokens") else "invalid_structure"
    if isinstance(raw, dict) and (raw.get("done_reason") == "length" or raw.get("stop_reason") == "max_tokens"):
        return "incomplete"
    return "complete" if parsed is not None else "invalid_structure"


def model_identity(raw: Any, requested_model: str | None = None) -> str | None:
    if not isinstance(raw, dict):
        return None
    usage = raw.get("modelUsage") or raw.get("model_usage")
    if isinstance(usage, dict):
        primary = [key for key in usage if isinstance(key, str) and "haiku" not in key.lower() and "sidecar" not in key.lower()]
        if len(primary) == 1:
            return primary[0]
        return None
    for key in ("model", "model_id"):
        if isinstance(raw.get(key), str):
            return raw[key]
    return None


def claude_help() -> dict[str, Any]:
    completed = subprocess.run(["claude", "--help"], capture_output=True, text=True, timeout=30)
    return {"exit_code": completed.returncode, "text": completed.stdout + completed.stderr, "json_schema": "--json-schema" in completed.stdout + completed.stderr}


def claude_call(model: str, condition: str, prompt: str, system: str, cwd: Path, schema: dict[str, Any], supports_schema: bool) -> dict[str, Any]:
    cmd = ["claude", "--safe-mode", "--no-session-persistence", "--disable-slash-commands", "--tools", "", "--strict-mcp-config", "--mcp-config", '{"mcpServers":{}}', "--model", model, "--output-format", "json", "--max-budget-usd", "2", "--system-prompt", system]
    if supports_schema:
        cmd += ["--json-schema", json.dumps(types_only_schema(schema), sort_keys=True)]
    cmd += ["-p", prompt]
    env = dict(os.environ)
    env["CLAUDE_CODE_SIMPLE_SYSTEM_PROMPT"] = "1"
    completed = subprocess.run(cmd, cwd=cwd, env=env, text=True, capture_output=True, timeout=300)
    raw_text = completed.stdout.strip()
    try:
        raw: Any = json.loads(raw_text) if raw_text else None
    except json.JSONDecodeError:
        raw = raw_text
    return {"transport_exit_code": completed.returncode, "stderr": completed.stderr[-4000:], "raw_envelope": raw, "requested_model": model, "model_options": {"safe_mode": True, "tools": False, "json_schema": supports_schema, "max_budget_usd": 2}, "command": cmd[:cmd.index("--system-prompt")] + (["--json-schema"] if supports_schema else [])}


def ollama_base() -> str:
    return os.environ.get("OLLAMA_BASE_URL", "http://127.0.0.1:11434").rstrip("/")


def ollama_tags() -> dict[str, Any]:
    request = urllib.request.Request(ollama_base() + "/api/tags")
    with urllib.request.urlopen(request, timeout=15) as response:
        return json.loads(response.read())


def ollama_digest(model: str) -> dict[str, Any]:
    payload = ollama_tags()
    for item in payload.get("models", []):
        if item.get("name") == model:
            return {"name": item.get("name"), "digest": item.get("digest"), "details": item.get("details", {})}
    return {"name": None, "digest": None, "available_models": [item.get("name") for item in payload.get("models", [])]}


def retain_ollama_probe(results: dict[str, Any], model: str, observed: dict[str, Any] | None = None, error: str | None = None) -> None:
    records = results.setdefault("ollama_models", {})
    prior = records.get(model)
    if error:
        if prior and prior.get("digest"):
            raise RuntimeError(f"cannot resume with unavailable Ollama digest probe: {model}")
        results.setdefault("ollama_probe_errors", {})[model] = error
        if not prior:
            records[model] = {"name": None, "digest": None, "error": error}
        return
    if prior and (prior.get("name"), prior.get("digest")) != (observed.get("name"), observed.get("digest")):
        raise ValueError(f"resume Ollama model digest mismatch: {model}")
    records.setdefault(model, observed)


def qwen_call(model: str, condition: str, prompt: str, system: str, schema: dict[str, Any], model_digest: str) -> dict[str, Any]:
    body = {"model": model, "stream": False, "think": False, "format": types_only_schema(schema), "options": {"num_ctx": 32768, "num_predict": 8192, "temperature": 0}, "messages": [{"role": "system", "content": system}, {"role": "user", "content": prompt}]}
    request = urllib.request.Request(ollama_base() + "/api/chat", data=json.dumps(body).encode(), headers={"Content-Type": "application/json"})
    with urllib.request.urlopen(request, timeout=300) as response:
        raw = json.loads(response.read())
    return {"transport_exit_code": 0, "stderr": "", "raw_envelope": raw, "requested_model": model, "model_digest": model_digest, "model_options": body["options"], "ollama_request": body}


def evaluate_call(call: dict[str, Any], requested_model: str, group: dict[str, Any], prompt: str, prompt_hash: str, context_hash: str, cases_hash: str) -> dict[str, Any]:
    raw = call.get("raw_envelope")
    started = call.pop("started_at", now())
    parsed = None
    parse_error = None
    if call.get("transport_exit_code") == 0 and raw is not None:
        try:
            parsed = parse_full_json(raw)
        except Exception as exc:  # preserve raw malformed output
            parse_error = f"{type(exc).__name__}: {exc}"
    identity = model_identity(raw, requested_model)
    errors: list[str] = []
    if call.get("transport_exit_code") != 0:
        errors.append("transport_failure")
    if identity != requested_model:
        errors.append("model_identity_mismatch" if identity else "model_identity_missing")
    if parse_error:
        errors.append(parse_error)
    if parsed is None:
        errors.append("invalid_structure")
    if isinstance(raw, dict) and (raw.get("is_error") or raw.get("subtype") in {"error", "error_max_budget_usd", "error_structured_output"}):
        errors.append("model_error")
    schema_status = {"passed": parsed is not None and schema_type_ok(parsed, group["output_schema"]), "errors": []}
    if parsed is not None and not schema_status["passed"]:
        schema_status["errors"].append("output does not match types-only schema")
        errors.append("schema_failure")
    if completion_status(raw, parsed, parse_error, call.get("transport_exit_code")) == "incomplete":
        errors.append("incomplete_output")
    check_status = [compare(check, parsed) if parsed is not None else {"path": check["path"], "op": check["op"], "passed": False, "present": False, "actual": None, "expected": check["expected"]} for check in group["checks"]]
    if errors:
        check_status = [{**item, "passed": False} for item in check_status]
    return {"started_at": started, "finished_at": now(), "requested_model": requested_model, "resolved_model": identity, "model_digest": call.get("model_digest"), "model_options": call.get("model_options"), "prompt": prompt, "system_prompt": call.get("system_prompt"), "raw_envelope": raw, "parsed": parsed, "completion_status": completion_status(raw, parsed, parse_error, call.get("transport_exit_code")), "schema_status": schema_status, "check_status": check_status, "prompt_sha256": prompt_hash, "system_prompt_sha256": call.get("system_prompt_sha256"), "context_sha256": context_hash, "cases_sha256": cases_hash, "schema_sha256": call.get("schema_sha256"), "harness_hash": call.get("harness_hash"), "elapsed_seconds": call.get("elapsed_seconds", 0), "errors": errors, "transport": {key: value for key, value in call.items() if key != "raw_envelope"}}


def report(results: dict[str, Any]) -> str:
    lines = ["# Skill model evaluation", "", f"Skill: `{results['skill']}`", f"Manifest SHA-256: `{results['cases_sha256']}`", "", "Expected checks are kept outside model prompts. `n/a` indicates transport, identity, parse, schema, or completion failure; it is not a knowledge score.", "", "| Model | Condition | Group | Completion | Score | Errors |", "| --- | --- | --- | --- | ---: | --- |"]
    for model, conditions in results.get("models", {}).items():
        for condition, groups in conditions.items():
            for group_id, item in groups.items():
                checks = item.get("check_status", [])
                score = sum(bool(check.get("passed")) for check in checks) / len(checks) if checks and not item.get("errors") else None
                score_text = "n/a" if score is None else f"{score:.3f}"
                lines.append(f"| {model} | {condition} | {group_id} | {item.get('completion_status')} | {score_text} | {', '.join(item.get('errors', [])) or ''} |")
    lines += ["", "## Reproduction", "", f"Context hashes: `{json.dumps(results.get('context_hashes', {}), sort_keys=True)}`", f"Cases hash: `{results['cases_sha256']}`", "Live model calls are opt-in and raw envelopes remain in `eval-results.json`.", ""]
    return "\n".join(lines)


def self_test() -> None:
    assert compare({"path": "/a", "op": "equals", "expected": None}, {"a": None})["passed"]
    assert compare({"path": "/a", "op": "equals", "expected": False}, {"a": False})["passed"]
    assert compare({"path": "/a", "op": "equals", "expected": 0}, {"a": 0})["passed"]
    assert not compare({"path": "/a", "op": "equals", "expected": None}, {})["passed"]
    assert compare({"path": "/a", "op": "set_equals", "expected": [1, 2]}, {"a": [2, 1, 2]})["passed"]
    assert compare({"path": "/a", "op": "approximately", "expected": 1.0, "tolerance": 0.01}, {"a": 1.005})["passed"]
    assert not compare({"path": "/a", "op": "approximately", "expected": 1.0, "tolerance": 0.01}, {"a": "1.0"})["passed"]
    assert parse_full_json('{"ok":true}') == {"ok": True}
    assert parse_full_json({"result": "{\"ok\":true}"}) == {"ok": True}
    assert parse_full_json({"message": {"content": [{"text": "{\"ok\":true}"}]}}) == {"ok": True}
    assert parse_full_json({"structured_output": {"ok": True}, "modelUsage": {"claude-sonnet-5": {}, "claude-haiku-sidecar": {}}}) == {"ok": True}
    try:
        parse_full_json({"structured_output": {"value": float("nan")}})
    except ValueError:
        pass
    else:
        raise AssertionError("non-finite structured output must fail")
    for malformed in ("reasoning {\"ok\":true}", "", "not json"):
        try:
            parse_full_json(malformed)
        except Exception:
            pass
        else:
            raise AssertionError("incidental or malformed JSON parsed")
    assert completion_status({"done_reason": "length"}, None, "bad") == "incomplete"
    assert completion_status({}, None, "bad") == "invalid_structure"
    assert model_identity({"model": "x"}) == "x"
    assert model_identity({"modelUsage": {"claude-sonnet-5": {}, "claude-haiku-sidecar": {}}}, "claude-sonnet-5") == "claude-sonnet-5"
    assert model_identity({"modelUsage": {"claude-sonnet-5": {}, "claude-fable-5-1": {}}}, "claude-sonnet-5") is None
    assert model_identity({"requested_model": "model-a"}, "model-a") is None
    assert model_identity({}) is None
    group = {"output_schema": {"type": "object"}, "checks": [{"path": "/ok", "op": "equals", "expected": True}]}
    failed = evaluate_call({"transport_exit_code": 7, "raw_envelope": None, "elapsed_seconds": 0.1}, "model-a", group, "{}", "p", "c", "k")
    assert "transport_failure" in failed["errors"] and failed["completion_status"] == "transport_failure"
    malformed = evaluate_call({"transport_exit_code": 0, "raw_envelope": "reasoning {\"ok\":true}", "elapsed_seconds": 0.1}, "model-a", group, "{}", "p", "c", "k")
    assert malformed["completion_status"] == "invalid_structure" and "model_identity_missing" in malformed["errors"]
    truncated = evaluate_call({"transport_exit_code": 0, "raw_envelope": {"model": "model-a", "done_reason": "length", "message": {"content": "{\"ok\":true}"}}, "elapsed_seconds": 0.1}, "model-a", group, "{}", "p", "c", "k")
    assert truncated["completion_status"] == "incomplete" and "incomplete_output" in truncated["errors"]
    assert schema_type_ok({"a": False}, {"type": "object", "properties": {"a": {"type": "boolean"}}, "additionalProperties": False})
    assert not schema_type_ok({"a": False, "extra": 0}, {"type": "object", "properties": {"a": {"type": "boolean"}}, "additionalProperties": False})
    assert schema_type_ok("x", {"oneOf": [{"type": "string"}, {"type": "number"}]})
    assert not schema_type_ok(1, {"oneOf": [{"type": "number"}, {}]})
    try:
        parse_full_json('{"value": NaN}')
    except ValueError:
        pass
    else:
        raise AssertionError("non-finite JSON must fail")
    with tempfile.TemporaryDirectory() as directory:
        root = Path(directory)
        (root / "manifest.json").write_text(json.dumps({"context_hash": "a", "prompt_sha256": "b"}))
        prior = read_json(root / "manifest.json")
        assert prior["context_hash"] == "a"
    print("PASS run-skill-evals self-tests")


def verify_resume(results: dict[str, Any], skill: Path, groups: list[dict[str, Any]], context_hashes: dict[str, str], cases_hash: str, help_info: dict[str, Any], version: str) -> None:
    if results.get("skill") != skill.name:
        raise ValueError("resume skill mismatch")
    if results.get("cli_version") != version or results.get("claude_help", {}).get("json_schema") != help_info.get("json_schema"):
        raise ValueError("resume CLI capability mismatch")
    if results.get("groups") != [group["id"] for group in groups]:
        raise ValueError("resume group manifest mismatch")
    if results.get("schema_hashes") != {group["id"]: digest_json(group["output_schema"]) for group in groups}:
        raise ValueError("resume schema mismatch")
    if results.get("harness_hash") != harness_hash():
        raise ValueError("resume harness hash mismatch")
    group_by_id = {group["id"]: group for group in groups}
    for model_name, model_conditions in results.get("models", {}).items():
        for condition, retained in model_conditions.items():
            if condition not in {"with-skill", "without-skill"}:
                raise ValueError(f"resume condition mismatch: {condition}")
            for group_id, item in retained.items():
                if group_id not in group_by_id:
                    raise ValueError(f"resume contains unknown group: {group_id}")
                expected_prompt = digest_bytes(prompt_for(group_by_id[group_id]).encode())
                expected_context = digest_json(context_hashes if condition == "with-skill" else {})
                expected_system_text = system_prompt(condition, {relative: (skill / relative).read_text() for relative in context_hashes})
                expected_system = digest_bytes(expected_system_text.encode())
                expected_options = {"safe_mode": True, "tools": False, "json_schema": bool(results.get("claude_help", {}).get("json_schema")), "max_budget_usd": 2} if model_name in CLAUDE_MODELS else {"num_ctx": 32768, "num_predict": 8192, "temperature": 0}
                expected_digest = None if model_name in CLAUDE_MODELS else results.get("ollama_models", {}).get(model_name, {}).get("digest")
                if (item.get("prompt_sha256") != expected_prompt or item.get("context_sha256") != expected_context
                        or item.get("system_prompt_sha256") != expected_system or item.get("cases_sha256") != cases_hash
                        or item.get("harness_hash") != results.get("harness_hash") or item.get("schema_sha256") != results["schema_hashes"][group_id]
                        or item.get("prompt") != prompt_for(group_by_id[group_id]) or item.get("system_prompt") != expected_system_text
                        or item.get("model_options") != expected_options or item.get("model_digest") != expected_digest):
                    raise ValueError(f"resume hash mismatch in {condition} group {group_id}")


def begin_run_metadata(results: dict[str, Any], requested_conditions: tuple[str, ...], manifest_groups: list[str], requested_groups: list[str] | None = None) -> None:
    """Prepare resumable metadata without changing retained cell provenance."""
    prior_finished = results.pop("finished_at", None)
    history = results.setdefault("run_history", [])
    if prior_finished is not None:
        history.append({"resumed_at": now(), "prior_finished_at": prior_finished})
    results["conditions"] = list(requested_conditions)
    results["groups"] = list(manifest_groups)
    results["requested_groups"] = list(requested_groups if requested_groups is not None else manifest_groups)
    results["completed_groups"] = [group for group in manifest_groups if group in {
        group_id for model in results.get("models", {}).values() for conditions in model.values() for group_id in conditions
    }]


def finish_run_metadata(results: dict[str, Any], manifest_groups: list[str]) -> None:
    actual_conditions = sorted({condition for model in results.get("models", {}).values() for condition in model})
    actual_groups = {group for model in results.get("models", {}).values() for condition in model.values() for group in condition}
    results["conditions"] = [condition for condition in ("with-skill", "without-skill") if condition in actual_conditions]
    results["groups"] = list(manifest_groups)
    results["completed_groups"] = [group for group in manifest_groups if group in actual_groups]
    results["finished_at"] = now()
    if results.get("run_history"):
        results["run_history"][-1]["finished_at"] = results["finished_at"]


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--skill", type=Path)
    parser.add_argument("--self-test", action="store_true")
    parser.add_argument("--run", action="store_true")
    parser.add_argument("--models", nargs="+", default=list(DEFAULT_MODELS))
    parser.add_argument("--condition", choices=("with-skill", "without-skill", "both"), default="both")
    parser.add_argument("--groups", nargs="+")
    parser.add_argument("--resume", type=Path)
    parser.add_argument("--output", type=Path)
    args = parser.parse_args()
    if args.self_test:
        self_test()
        if not args.run:
            return 0
    if not args.skill:
        parser.error("--skill PATH is required for evaluation")
    skill = args.skill.resolve()
    manifest, context_hashes, cases_hash = validate_manifest(skill)
    if not args.run:
        print(f"READY: validated {skill}; pass --run for live calls")
        return 0
    selected_groups = [group for group in manifest["groups"] if not args.groups or group["id"] in args.groups]
    unknown = set(args.groups or ()) - {group["id"] for group in manifest["groups"]}
    if unknown:
        raise ValueError(f"unknown groups: {', '.join(sorted(unknown))}")
    conditions = ("with-skill", "without-skill") if args.condition == "both" else (args.condition,)
    output = (args.output or skill / "references" / "eval-results.json").resolve()
    report_path = ((args.output.with_name(args.output.stem + "-report.md")) if args.output else skill / "references" / "eval-results.md").resolve()
    downloads_report = Path.home() / "Downloads" / f"{skill.name}-evaluation-report.md"
    version = cli_version()
    try:
        help_info = claude_help()
    except Exception as exc:
        help_info = {"exit_code": 1, "text": "", "json_schema": False, "error": f"{type(exc).__name__}: {exc}"}
    if args.resume:
        source = args.resume.resolve()
        results = read_json(source)
        if results.get("cases_sha256") != cases_hash or results.get("context_hashes") != context_hashes:
            raise ValueError("resume hash mismatch: manifest or declared context changed")
        verify_resume(results, skill, manifest["groups"], context_hashes, cases_hash, help_info, version)
        output = output if args.output else source
        if args.output and output.exists() and output != source:
            raise ValueError(f"refusing to overwrite unrelated output during resume: {output}")
        begin_run_metadata(results, conditions, [group["id"] for group in manifest["groups"]], [group["id"] for group in selected_groups])
    elif output.exists():
        raise ValueError(f"refusing to overwrite existing results without --resume: {output}")
    else:
        results = {"schema_version": 1, "skill": skill.name, "started_at": now(), "cli_version": version, "claude_help": {"exit_code": help_info["exit_code"], "json_schema": help_info["json_schema"]}, "cases_sha256": cases_hash, "context_hashes": context_hashes, "schema_hashes": {group["id"]: digest_json(group["output_schema"]) for group in manifest["groups"]}, "harness_hash": harness_hash(), "models": {}, "groups": [group["id"] for group in manifest["groups"]], "conditions": conditions}
        if "error" in help_info:
            results["claude_help"]["error"] = help_info["error"]
    context_text = {relative: (skill / relative).read_text() for relative in manifest["context_files"]}
    for model in args.models:
        if model not in CLAUDE_MODELS:
            prior = results.setdefault("ollama_models", {}).get(model)
            try:
                observed = ollama_digest(model)
                retain_ollama_probe(results, model, observed=observed)
            except ValueError:
                raise
            except Exception as exc:
                retain_ollama_probe(results, model, error=f"{type(exc).__name__}: {exc}")
    with tempfile.TemporaryDirectory(prefix=f"{skill.name}-eval-") as directory:
        cwd = Path(directory)
        for model in args.models:
            results["models"].setdefault(model, {})
            for condition in conditions:
                results["models"][model].setdefault(condition, {})
                for group in selected_groups:
                    if group["id"] in results["models"][model][condition]:
                        continue
                    prompt = prompt_for(group)
                    prompt_hash = digest_bytes(prompt.encode())
                    context_hash = digest_json(context_hashes if condition == "with-skill" else {})
                    started = now()
                    started_mono = time.monotonic()
                    system = system_prompt(condition, context_text if condition == "with-skill" else {})
                    intended_options = {"safe_mode": True, "tools": False, "json_schema": bool(help_info["json_schema"]), "max_budget_usd": 2} if model in CLAUDE_MODELS else {"num_ctx": 32768, "num_predict": 8192, "temperature": 0}
                    intended_digest = None if model in CLAUDE_MODELS else results.get("ollama_models", {}).get(model, {}).get("digest")
                    try:
                        if model in CLAUDE_MODELS:
                            call = claude_call(model, condition, prompt, system, cwd, group["output_schema"], bool(help_info["json_schema"]))
                        else:
                            identity = results.get("ollama_models", {}).get(model, {})
                            if identity.get("name") != model or not identity.get("digest"):
                                raise RuntimeError(f"requested Ollama model unavailable or digest missing: {model}")
                            call = qwen_call(model, condition, prompt, system, group["output_schema"], identity["digest"])
                        call["started_at"] = started
                    except Exception as exc:
                        call = {"started_at": started, "transport_exit_code": 1, "stderr": f"{type(exc).__name__}: {exc}", "raw_envelope": None, "requested_model": model, "model_digest": intended_digest, "model_options": intended_options}
                    call.setdefault("model_digest", intended_digest)
                    call.setdefault("model_options", intended_options)
                    call["elapsed_seconds"] = round(time.monotonic() - started_mono, 6)
                    call["prompt"] = prompt
                    call["system_prompt"] = system
                    call["system_prompt_sha256"] = digest_bytes(system.encode())
                    call["schema_sha256"] = digest_json(group["output_schema"])
                    call["harness_hash"] = harness_hash()
                    result = evaluate_call(call, model, group, prompt, prompt_hash, context_hash, cases_hash)
                    results["models"][model][condition][group["id"]] = result
                    output.parent.mkdir(parents=True, exist_ok=True)
                    atomic_write(output, json.dumps(results, indent=2, sort_keys=True) + "\n")
                    print(f"completed model={model} condition={condition} group={group['id']} status={result['completion_status']}", flush=True)
    finish_run_metadata(results, [group["id"] for group in manifest["groups"]])
    atomic_write(output, json.dumps(results, indent=2, sort_keys=True) + "\n")
    rendered = report(results)
    atomic_write(report_path, rendered)
    downloads_report.parent.mkdir(parents=True, exist_ok=True)
    atomic_write(downloads_report, rendered)
    print(f"Wrote {output}\nWrote {report_path}\nWrote {downloads_report}")
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except (ValueError, RuntimeError) as exc:
        print(f"ERROR: {exc}", file=sys.stderr)
        raise SystemExit(2)
