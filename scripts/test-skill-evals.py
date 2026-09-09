#!/usr/bin/env python3
"""Offline tests for the generic skill evaluation harness."""
from __future__ import annotations

import importlib.util
import json
import tempfile
from pathlib import Path


def load_harness():
    path = Path(__file__).with_name("run-skill-evals.py")
    spec = importlib.util.spec_from_file_location("run_skill_evals", path)
    module = importlib.util.module_from_spec(spec)
    assert spec and spec.loader
    spec.loader.exec_module(module)
    return module


def expect_error(function, message):
    try:
        function()
    except ValueError as error:
        assert message in str(error), (message, error)
    else:
        raise AssertionError(f"expected ValueError containing {message!r}")


def main() -> int:
    harness = load_harness()
    harness.self_test()
    assert harness.HARNESS_VERSION == "2026-09-08.3"
    for expected, actual, passed in ((0, [], True), (2, [5, 5.0], True), (1, [5, 5.0], False), (0, {}, False), (0, None, False), (2, "ab", False)):
        check = {"path": "/items", "op": "array_length_equals", "expected": expected}
        harness.validate_check(check, "length")
        assert harness.compare(check, {"items": actual})["passed"] is passed
    length_check = {"path": "/items", "op": "array_length_equals", "expected": 0}
    assert not harness.compare(length_check, {})["passed"]
    for expected in (True, False, -1, 0.0, 2.0, None, "2"):
        check = {**length_check, "expected": expected}
        expect_error(lambda: harness.validate_check(check, "length"), "nonnegative integer")
        assert not harness.compare(check, {"items": []})["passed"]
    assert harness.compare({"path": "/x", "op": "equals", "expected": 5}, {"x": 5})["passed"]
    assert not harness.compare({"path": "/x", "op": "equals", "expected": 5}, {"x": 5.0})["passed"]
    assert not harness.compare({"path": "/x", "op": "equals", "expected": 1}, {"x": True})["passed"]
    approximate = {"path": "/x", "op": "approximately", "expected": 5, "tolerance": 1e-9}
    assert harness.compare(approximate, {"x": 5.0})["passed"]
    assert not harness.compare(approximate, {"x": True})["passed"]
    isolated_count = 987654321
    length_group = {"prompt": "Return an array.", "input": {"items": [1]}, "output_schema": {"type": "array", "items": {"type": "number"}}, "checks": [{"path": "", "op": "array_length_equals", "expected": isolated_count}]}
    request = harness.prompt_for(length_group)
    for condition in ("with-skill", "without-skill"):
        combined = request + harness.system_prompt(condition, {"context.md": "Only general instructions."})
        assert str(isolated_count) not in combined and "array_length_equals" not in combined
    retained_probe = {"ollama_models": {"qwen3:4b": {"name": "qwen3:4b", "digest": "sha256:kept"}}}
    try:
        harness.retain_ollama_probe(retained_probe, "qwen3:4b", error="URLError: offline")
    except RuntimeError:
        pass
    else:
        raise AssertionError("retained Ollama digest must not be overwritten after probe failure")
    assert retained_probe["ollama_models"]["qwen3:4b"]["digest"] == "sha256:kept"
    expanded = {
        "started_at": "2026-09-08T10:00:00+00:00",
        "finished_at": "2026-09-08T10:05:00+00:00",
        "conditions": ["with-skill"],
        "groups": ["basic"],
        "models": {"model": {"with-skill": {"basic": {}}}},
    }
    harness.begin_run_metadata(expanded, ("with-skill", "without-skill"), ["basic"])
    assert expanded["started_at"] == "2026-09-08T10:00:00+00:00" and "finished_at" not in expanded
    assert expanded["conditions"] == ["with-skill", "without-skill"] and expanded["run_history"][0]["prior_finished_at"] == "2026-09-08T10:05:00+00:00"
    expanded["models"]["model"]["without-skill"] = {"basic": {}}
    harness.finish_run_metadata(expanded, ["basic"])
    assert expanded["conditions"] == ["with-skill", "without-skill"] and expanded["groups"] == ["basic"]
    assert expanded["run_history"][0]["finished_at"] == expanded["finished_at"]
    envelope_group = {"output_schema": {"type": "object", "properties": {"answer": {"type": "string"}}, "required": ["answer"]}, "checks": [{"path": "/answer", "op": "equals", "expected": "ok"}]}
    structured = {"is_error": False, "subtype": "success", "stop_reason": "end_turn", "modelUsage": {"claude-sonnet-5": {"inputTokens": 1}, "claude-haiku-4-5-20251001": {"inputTokens": 1}}, "structured_output": {"answer": "ok"}}
    evaluated = harness.evaluate_call({"transport_exit_code": 0, "raw_envelope": structured, "elapsed_seconds": 0.1}, "claude-sonnet-5", envelope_group, "{}", "p", "c", "k")
    assert evaluated["resolved_model"] == "claude-sonnet-5" and evaluated["completion_status"] == "complete" and not evaluated["errors"]
    budget = {"is_error": True, "subtype": "error_max_budget_usd", "result": "budget exceeded", "modelUsage": {"claude-sonnet-5": {}}}
    failed = harness.evaluate_call({"transport_exit_code": 0, "raw_envelope": budget, "elapsed_seconds": 0.1}, "claude-sonnet-5", envelope_group, "{}", "p", "c", "k")
    assert "model_error" in failed["errors"] and all(not item["passed"] for item in failed["check_status"])
    with tempfile.TemporaryDirectory(prefix="skill-eval-tests-") as directory:
        root = Path(directory)
        skill = root / "skill"
        (skill / "references").mkdir(parents=True)
        (skill / "references" / "context.md").write_text("synthetic context")
        manifest = {
            "context_files": ["references/context.md"],
            "groups": [{
                "id": "basic",
                "prompt": "Return the supplied value.",
                "input": {"value": 2},
                "output_schema": {"type": "object", "properties": {"value": {"type": "number"}}, "required": ["value"]},
                "checks": [
                    {"path": "/value", "op": "equals", "expected": 2},
                    {"path": "/items", "op": "set_equals", "expected": ["a", "b"]},
                    {"path": "/score", "op": "approximately", "expected": 1.0, "tolerance": 0.01},
                ],
            }],
        }
        path = skill / "references" / "eval-cases.json"
        path.write_text(json.dumps(manifest))
        loaded, hashes, cases_hash = harness.validate_manifest(skill)
        assert loaded == manifest and "references/context.md" in hashes and len(cases_hash) == 64
        help_info = {"json_schema": False}
        retained = {"skill": "skill", "cli_version": "unavailable", "claude_help": help_info, "groups": ["basic"], "cases_sha256": cases_hash, "context_hashes": hashes, "schema_hashes": {"basic": harness.digest_json(manifest["groups"][0]["output_schema"])}, "harness_hash": harness.harness_hash(), "models": {"claude-fable-5-1": {"without-skill": {"basic": {"prompt_sha256": "wrong", "context_sha256": "wrong", "cases_sha256": cases_hash}}, "with-skill": {"basic": {"prompt_sha256": "wrong", "context_sha256": "wrong", "cases_sha256": cases_hash}}}}}
        expect_error(lambda: harness.verify_resume(retained, skill, manifest["groups"], hashes, cases_hash, help_info, "unavailable"), "resume hash mismatch")
        valid_retained = json.loads(json.dumps(retained))
        del valid_retained["models"]["claude-fable-5-1"]["with-skill"]
        valid_retained["models"]["claude-fable-5-1"]["without-skill"]["basic"] = {
            "prompt": harness.prompt_for(manifest["groups"][0]), "system_prompt": harness.system_prompt("without-skill", {}),
            "prompt_sha256": harness.digest_bytes(harness.prompt_for(manifest["groups"][0]).encode()), "system_prompt_sha256": harness.digest_bytes(harness.system_prompt("without-skill", {}).encode()),
            "context_sha256": harness.digest_json({}), "cases_sha256": cases_hash, "schema_sha256": retained["schema_hashes"]["basic"], "harness_hash": retained["harness_hash"], "model_options": {"safe_mode": True, "tools": False, "json_schema": False, "max_budget_usd": 2}, "model_digest": None
        }
        harness.verify_resume(valid_retained, skill, manifest["groups"], hashes, cases_hash, help_info, "unavailable")
        valid_retained["models"]["claude-fable-5-1"]["without-skill"]["basic"]["model_options"]["max_budget_usd"] = 3
        expect_error(lambda: harness.verify_resume(valid_retained, skill, manifest["groups"], hashes, cases_hash, help_info, "unavailable"), "resume hash mismatch")
        expect_error(lambda: harness.validate_manifest(skill.parent / "missing"), "missing manifest")
        invalid = json.loads(path.read_text())
        invalid["context_files"] = ["../outside.md"]
        path.write_text(json.dumps(invalid))
        expect_error(lambda: harness.validate_manifest(skill), "context file")
        invalid["context_files"] = ["references/context.md"]
        invalid["groups"][0]["checks"][0]["op"] = "unknown"
        path.write_text(json.dumps(invalid))
        expect_error(lambda: harness.validate_manifest(skill), "unsupported check op")
        invalid["groups"][0]["checks"][0]["op"] = "equals"
        invalid["groups"][0]["output_schema"]["example"] = {"value": 2}
        path.write_text(json.dumps(invalid))
        expect_error(lambda: harness.validate_manifest(skill), "non-type schema keys")
        invalid["groups"][0]["output_schema"] = {"type": "object", "properties": {"nested": {"type": "object", "properties": {"x": {"format": "secret"}}}}}
        path.write_text(json.dumps(invalid))
        expect_error(lambda: harness.validate_manifest(skill), "non-type schema keys")
    with tempfile.TemporaryDirectory(prefix="skill-eval-expanded-resume-") as directory:
        root = Path(directory)
        skill = root / "skill"
        (skill / "references").mkdir(parents=True)
        (skill / "references" / "context.md").write_text("synthetic context")
        ids = ["zeta", "alpha", "middle"]
        groups = [{"id": group_id, "prompt": "Return the supplied value.", "input": {"value": 2}, "output_schema": {"type": "object"}, "checks": []} for group_id in ids]
        manifest = {"context_files": ["references/context.md"], "groups": groups}
        manifest_path = skill / "references" / "eval-cases.json"
        manifest_path.write_text(json.dumps(manifest))
        loaded, hashes, cases_hash = harness.validate_manifest(skill)
        schema_hashes = {group["id"]: harness.digest_json(group["output_schema"]) for group in groups}
        common = {"prompt": harness.prompt_for(groups[0]), "system_prompt": harness.system_prompt("with-skill", {"references/context.md": "synthetic context"}), "context_sha256": harness.digest_json(hashes), "cases_sha256": cases_hash, "harness_hash": harness.harness_hash(), "model_options": {"safe_mode": True, "tools": False, "json_schema": False, "max_budget_usd": 2}, "model_digest": None}
        def cell(group, condition="with-skill"):
            prompt = harness.prompt_for(group)
            system_text = harness.system_prompt(condition, {"references/context.md": "synthetic context"} if condition == "with-skill" else {})
            return {**common, "prompt": prompt, "system_prompt": system_text, "prompt_sha256": harness.digest_bytes(prompt.encode()), "system_prompt_sha256": harness.digest_bytes(system_text.encode()), "context_sha256": harness.digest_json(hashes if condition == "with-skill" else {}), "schema_sha256": schema_hashes[group["id"]]}
        probe = {"skill": "skill", "cli_version": "unavailable", "claude_help": {"json_schema": False}, "groups": ids, "cases_sha256": cases_hash, "context_hashes": hashes, "schema_hashes": schema_hashes, "harness_hash": harness.harness_hash(), "models": {"claude-fable-5-1": {"with-skill": {"zeta": cell(groups[0])}}}}
        harness.begin_run_metadata(probe, ("with-skill", "without-skill"), ids, ["zeta"])
        assert probe["groups"] == ids and probe["requested_groups"] == ["zeta"] and probe["completed_groups"] == ["zeta"]
        probe["models"]["claude-fable-5-1"]["with-skill"].update({group["id"]: cell(group) for group in groups[1:]})
        probe["models"]["claude-fable-5-1"]["without-skill"] = {group["id"]: cell(group, "without-skill") for group in groups}
        harness.finish_run_metadata(probe, ids)
        assert probe["groups"] == ids and probe["completed_groups"] == ids
        harness.verify_resume(probe, skill, groups, hashes, cases_hash, {"json_schema": False}, "unavailable")
    print("PASS test-skill-evals offline tests")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
