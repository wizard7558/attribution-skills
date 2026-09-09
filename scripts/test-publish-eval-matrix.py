#!/usr/bin/env python3
"""Offline tests for publish-eval-matrix redaction and frozen-hash guards."""
from __future__ import annotations

import importlib.util
import json
from pathlib import Path


def load_module(name: str, path: Path):
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    assert spec and spec.loader
    spec.loader.exec_module(module)
    return module


def main() -> int:
    repo = Path(__file__).resolve().parents[1]
    publisher = load_module("publish_eval_matrix", repo / "scripts" / "publish-eval-matrix.py")
    harness = load_module("run_skill_evals", repo / "scripts" / "run-skill-evals.py")
    sample = {
        "models": {
            "claude-sonnet-5": {
                "with-skill": {
                    "group-a": {
                        "raw_envelope": {
                            "session_id": "secret-session",
                            "uuid": "secret-uuid",
                            "structured_output": {"ok": True},
                        }
                    }
                }
            }
        }
    }
    pointers = publisher.iter_redaction_targets(sample)
    assert {(pointer, value) for pointer, value in pointers} == {
        ("/models/claude-sonnet-5/with-skill/group-a/raw_envelope/session_id", "secret-session"),
        ("/models/claude-sonnet-5/with-skill/group-a/raw_envelope/uuid", "secret-uuid"),
    }
    redacted = json.loads(json.dumps(sample))
    for pointer, value in pointers:
        publisher.set_pointer(redacted, pointer, publisher.REDACTION)
    assert redacted["models"]["claude-sonnet-5"]["with-skill"]["group-a"]["raw_envelope"]["session_id"] == publisher.REDACTION
    publisher.scan_forbidden_bytes(b'{"ok": true}', "clean")
    forbidden_sample = b"/".join([b"", b"Users", b"riley", b"Repos", b"example"])
    try:
        publisher.scan_forbidden_bytes(forbidden_sample, "bad")
    except ValueError as exc:
        assert "forbidden" in str(exc)
    else:
        raise AssertionError("expected forbidden scan failure")
    skill = repo / "skills" / "channel-taxonomy"
    manifest, context_hashes, manifest_sha = harness.validate_manifest(skill)
    source = {
        "cases_sha256": manifest_sha,
        "context_hashes": context_hashes,
        "harness_hash": harness.harness_hash(),
        "models": {},
    }
    publisher.verify_frozen(source, context_hashes, harness, manifest_sha)
    try:
        publisher.verify_frozen({**source, "cases_sha256": "0" * 64}, context_hashes, harness, manifest_sha)
    except ValueError as exc:
        assert "cases_sha256" in str(exc)
    else:
        raise AssertionError("expected manifest hash mismatch")
    public = repo / "skills" / "channel-taxonomy" / "references" / "eval-results-v2.json"
    if public.is_file():
        publisher.scan_forbidden_bytes(public.read_bytes(), public.name)
        provenance = json.loads((public.with_name("eval-v2-provenance.json")).read_text())
        assert provenance["model_reruns_during_publication"] == 0
        assert provenance["native_queries_during_publication"] == 0
    print("PASS publish-eval-matrix self-tests")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
