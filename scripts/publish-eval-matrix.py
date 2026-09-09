#!/usr/bin/env python3
"""Publish metadata-redacted public derivatives of private evaluation matrices.

Redacts only raw_envelope session_id and uuid correlation fields, rescores with the
frozen shared harness, and writes eval-results JSON/MD plus provenance. Makes no model,
network, or native SQL calls.
"""
from __future__ import annotations

import argparse
import copy
import hashlib
import importlib.util
import json
import re
import sys
from pathlib import Path
from typing import Any

REDACTION = "[REDACTED_RUNTIME_CORRELATION_ID]"
REDACTION_REASON = "private_runtime_correlation_identifier"
HARNESS_SHA256 = "b12f6051d57135d23bdf5e4204c6d4866ddbb41d5602bb4ea63972ab45567b45"
USER_HOME_PREFIX = b"/".join([b"", b"Users", b"riley"])
PRIVATE_TMP_PREFIX = b"/".join([b"", b"var", b"folders"])
INTERNAL_PROJECT = b"res-" + b"analytics"
FORBIDDEN_PATTERNS = (
    re.compile(re.escape(USER_HOME_PREFIX)),
    re.compile(re.escape(PRIVATE_TMP_PREFIX)),
    re.compile(re.escape(INTERNAL_PROJECT)),
)


def digest_bytes(value: bytes) -> str:
    return hashlib.sha256(value).hexdigest()


def load_harness(repo_root: Path) -> Any:
    path = repo_root / "scripts" / "run-skill-evals.py"
    spec = importlib.util.spec_from_file_location("run_skill_evals", path)
    module = importlib.util.module_from_spec(spec)
    assert spec and spec.loader
    spec.loader.exec_module(module)
    return module


def json_pointer(parts: list[str]) -> str:
    escaped = []
    for part in parts:
        escaped.append(part.replace("~", "~0").replace("/", "~1"))
    return "/" + "/".join(escaped)


def iter_redaction_targets(value: Any, pointer: str = "") -> list[tuple[str, str]]:
    found: list[tuple[str, str]] = []
    if isinstance(value, dict):
        for key, item in value.items():
            child = f"{pointer}/{key}" if pointer else f"/{key}"
            if key in {"session_id", "uuid"} and pointer.endswith("/raw_envelope") and isinstance(item, str) and item:
                found.append((child, item))
            else:
                found.extend(iter_redaction_targets(item, child))
    elif isinstance(value, list):
        for index, item in enumerate(value):
            found.extend(iter_redaction_targets(item, f"{pointer}/{index}"))
    return found


def set_pointer(root: dict[str, Any], pointer: str, replacement: str) -> None:
    parts = pointer.strip("/").split("/")
    current: Any = root
    for part in parts[:-1]:
        current = current[part]
    current[parts[-1]] = replacement


def scan_forbidden_bytes(payload: bytes, label: str) -> None:
    for pattern in FORBIDDEN_PATTERNS:
        if pattern.search(payload):
            raise ValueError(f"{label} contains forbidden publication pattern: {pattern.pattern.decode()}")


def verify_frozen(
    source: dict[str, Any],
    context_hashes: dict[str, str],
    harness: Any,
    manifest_sha256: str,
    *,
    allow_manifest_mismatch: bool = False,
) -> dict[str, Any] | None:
    manifest_mismatch: dict[str, Any] | None = None
    if source.get("cases_sha256") != manifest_sha256:
        if not allow_manifest_mismatch:
            raise ValueError("source cases_sha256 does not match current eval-cases.json bytes")
        manifest_mismatch = {
            "source_cases_sha256": source.get("cases_sha256"),
            "current_manifest_sha256": manifest_sha256,
            "context_hashes_match_current": source.get("context_hashes") == context_hashes,
            "rescore_skipped": True,
            "reason": "Historical evidence archived under a prior eval-cases.json manifest; scores are preserved from the original execution without recomputation against the revised manifest.",
        }
    elif source.get("context_hashes") != context_hashes:
        raise ValueError("source context_hashes mismatch against current skill context files")
    if source.get("harness_hash") != harness.harness_hash():
        raise ValueError("source harness_hash mismatch against frozen harness")
    return manifest_mismatch


def group_by_id(manifest: dict[str, Any]) -> dict[str, dict[str, Any]]:
    return {group["id"]: group for group in manifest["groups"]}


def rescore_cell(source_cell: dict[str, Any], group: dict[str, Any], model: str, harness: Any) -> None:
    transport = source_cell.get("transport") or {}
    call = {
        "transport_exit_code": transport.get("transport_exit_code", 0),
        "raw_envelope": copy.deepcopy(source_cell.get("raw_envelope")),
        "elapsed_seconds": source_cell.get("elapsed_seconds", 0),
        "system_prompt": source_cell.get("system_prompt"),
        "system_prompt_sha256": source_cell.get("system_prompt_sha256"),
        "schema_sha256": source_cell.get("schema_sha256"),
        "model_digest": source_cell.get("model_digest"),
        "model_options": source_cell.get("model_options"),
    }
    recomputed = harness.evaluate_call(
        call,
        model,
        group,
        source_cell.get("prompt", ""),
        source_cell.get("prompt_sha256", ""),
        source_cell.get("context_sha256", ""),
        source_cell.get("cases_sha256", ""),
    )
    for key in ("parsed", "completion_status", "schema_status", "resolved_model", "errors"):
        if source_cell.get(key) != recomputed.get(key):
            raise ValueError(f"rescore mismatch for {key}: recorded vs recomputed")
    recorded_checks = source_cell.get("check_status") or []
    recomputed_checks = recomputed.get("check_status") or []
    if len(recorded_checks) != len(recomputed_checks):
        raise ValueError("rescore check_status length mismatch")
    for left, right in zip(recorded_checks, recomputed_checks):
        if left.get("passed") != right.get("passed") or left.get("path") != right.get("path") or left.get("op") != right.get("op"):
            raise ValueError(f"rescore check mismatch at {left.get('path')}")


def usable_cell(cell: dict[str, Any]) -> bool:
    errors = cell.get("errors") or []
    if "transport_failure" in errors or "incomplete_output" in errors or "invalid_structure" in errors:
        return False
    return cell.get("completion_status") == "complete"


def summarize(results: dict[str, Any]) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    summaries: list[dict[str, Any]] = []
    verified: list[dict[str, Any]] = []
    for model, conditions in results.get("models", {}).items():
        for condition, groups in conditions.items():
            passed = 0
            checks = 0
            usable = 0
            for group_id, cell in groups.items():
                check_status = cell.get("check_status") or []
                if usable_cell(cell):
                    usable += 1
                    passed += sum(1 for item in check_status if item.get("passed"))
                    checks += len(check_status)
                verified.append(
                    {
                        "model": model,
                        "condition": condition,
                        "group": group_id,
                        "completion_status": cell.get("completion_status"),
                        "schema_passed": bool((cell.get("schema_status") or {}).get("passed")),
                        "usable": usable_cell(cell),
                        "checks": len(check_status),
                        "passed": sum(1 for item in check_status if item.get("passed")) if usable_cell(cell) else 0,
                        "prompt_sha256": cell.get("prompt_sha256"),
                        "system_prompt_sha256": cell.get("system_prompt_sha256"),
                        "raw_model_content_sha256": digest_bytes(json.dumps(cell.get("raw_envelope"), sort_keys=True, separators=(",", ":")).encode()) if cell.get("raw_envelope") is not None else None,
                        "errors": cell.get("errors") or [],
                    }
                )
            summaries.append(
                {
                    "model": model,
                    "condition": condition,
                    "passed": passed,
                    "checks": checks,
                    "usable_calls": usable,
                }
            )
    return summaries, verified


def results_markdown(results: dict[str, Any], *, title: str, narrative: str) -> str:
    lines = [f"# {title}", "", narrative, "", "| Model | With skill | Without skill | Usable calls |", "| --- | ---: | ---: | ---: |"]
    models = sorted(results.get("models", {}))
    for model in models:
        with_skill = results["models"][model].get("with-skill", {})
        without_skill = results["models"][model].get("without-skill", {})
        with_passed = sum(sum(1 for c in (cell.get("check_status") or []) if c.get("passed")) for cell in with_skill.values() if usable_cell(cell))
        with_checks = sum(len(cell.get("check_status") or []) for cell in with_skill.values() if usable_cell(cell))
        without_passed = sum(sum(1 for c in (cell.get("check_status") or []) if c.get("passed")) for cell in without_skill.values() if usable_cell(cell))
        without_checks = sum(len(cell.get("check_status") or []) for cell in without_skill.values() if usable_cell(cell))
        usable = sum(1 for condition in results["models"][model].values() for cell in condition.values() if usable_cell(cell))
        with_text = "n/a" if with_checks == 0 else f"{with_passed}/{with_checks}"
        without_text = "n/a" if without_checks == 0 else f"{without_passed}/{without_checks}"
        lines.append(f"| {model} | {with_text} | {without_text} | {usable} |")
    lines += ["", "## Cell detail", "", "| Model | Condition | Group | Completion | Score | Errors |", "| --- | --- | --- | --- | ---: | --- |"]
    for model, conditions in results.get("models", {}).items():
        for condition, groups in conditions.items():
            for group_id, cell in groups.items():
                check_status = cell.get("check_status") or []
                if usable_cell(cell) and check_status:
                    passed = sum(1 for item in check_status if item.get("passed"))
                    score = f"{passed}/{len(check_status)}"
                else:
                    score = "n/a"
                errors = ", ".join(cell.get("errors") or []) or ""
                lines.append(f"| {model} | {condition} | {group_id} | {cell.get('completion_status')} | {score} | {errors} |")
    lines.append("")
    return "\n".join(lines)


def build_provenance(
    *,
    source_sha256: str,
    public_sha256: str,
    redactions: list[dict[str, Any]],
    manifest_sha256: str,
    context_hashes: dict[str, str],
    source: dict[str, Any],
    summaries: list[dict[str, Any]],
    verified_cells: list[dict[str, Any]],
    private_archive_basename: str,
    revision: str | None = None,
    historical_artifacts_sha256: dict[str, str] | None = None,
    extra: dict[str, Any] | None = None,
) -> dict[str, Any]:
    attempts = sum(len(condition) for model in source.get("models", {}).values() for condition in model.values())
    usable_calls = sum(1 for model in source.get("models", {}).values() for condition in model.values() for cell in condition.values() if usable_cell(cell))
    transport_failures = sum(1 for model in source.get("models", {}).values() for condition in model.values() for cell in condition.values() if "transport_failure" in (cell.get("errors") or []))
    qwen = (source.get("ollama_models") or {}).get("qwen3:4b", {})
    provenance: dict[str, Any] = {
        "publication_kind": "metadata_redacted_derivative",
        "source_archive_sha256": source_sha256,
        "public_results_sha256": public_sha256,
        "private_archive_basename": private_archive_basename,
        "redactions": redactions,
        "preserved": "All prompt/system text, model result/structured_output/message bytes as JSON string values, transport requests, parsed responses, check details, statuses, timestamps and scores unchanged. Only listed runtime correlation metadata fields differ; JSON formatting reserialization is not a new execution.",
        "manifest_sha256": manifest_sha256,
        "harness_path": "scripts/run-skill-evals.py",
        "harness_sha256": HARNESS_SHA256,
        "context_hashes": context_hashes,
        "started_at": source.get("started_at"),
        "finished_at": source.get("finished_at"),
        "versions": {
            "claude_code": source.get("cli_version"),
            "ollama": "0.33.2",
            "qwen_digest": qwen.get("digest", "").removeprefix("sha256:") if qwen.get("digest") else None,
            "qwen_runtime": {"num_ctx": 32768, "num_predict": 8192, "temperature": 0, "think": False},
            "per_call_timeout_seconds": 300,
        },
        "attempts": attempts,
        "usable_calls": usable_calls,
        "transport_failures": transport_failures,
        "model_reruns_during_publication": 0,
        "native_queries_during_publication": 0,
        "summaries": summaries,
        "verified_cells": verified_cells,
        "rescore": "Frozen current harness parser/schema/scorer recomputed from actual original envelopes; exact comparison of parsed response, resolved model, completion, schema, all check statuses and errors.",
    }
    if revision:
        provenance["revision"] = revision
    if historical_artifacts_sha256:
        provenance["historical_artifacts_sha256"] = historical_artifacts_sha256
    if source.get("run_history"):
        provenance["run_history"] = source["run_history"]
    if extra:
        provenance.update(extra)
    return provenance


def publish(
    *,
    repo_root: Path,
    skill: Path,
    source_path: Path,
    output_stem: str,
    private_archive_basename: str,
    title: str,
    narrative: str,
    provenance_stem: str | None = None,
    revision: str | None = None,
    historical_artifacts_sha256: dict[str, str] | None = None,
    extra_provenance: dict[str, Any] | None = None,
    allow_manifest_mismatch: bool = False,
) -> dict[str, str]:
    harness = load_harness(repo_root)
    source_bytes = source_path.read_bytes()
    source_sha256 = digest_bytes(source_bytes)
    source = json.loads(source_bytes)
    manifest, context_hashes, manifest_sha256 = harness.validate_manifest(skill)
    manifest_mismatch = verify_frozen(
        source,
        context_hashes,
        harness,
        manifest_sha256,
        allow_manifest_mismatch=allow_manifest_mismatch,
    )
    groups = group_by_id(manifest)
    redactions: list[dict[str, Any]] = []
    redacted = copy.deepcopy(source)
    for pointer, value in iter_redaction_targets(redacted):
        redactions.append(
            {
                "pointer": pointer,
                "reason": REDACTION_REASON,
                "source_value_sha256": digest_bytes(value.encode()),
                "replacement": REDACTION,
            }
        )
        set_pointer(redacted, pointer, REDACTION)
    if manifest_mismatch is None:
        for model, conditions in source.get("models", {}).items():
            for condition, group_cells in conditions.items():
                for group_id, cell in group_cells.items():
                    rescore_cell(cell, groups[group_id], model, harness)
    refs = skill / "references"
    json_path = refs / f"{output_stem}.json"
    md_path = refs / f"{output_stem}.md"
    if provenance_stem:
        provenance_path = refs / f"{provenance_stem}.json"
    elif output_stem == "eval-results-v2":
        provenance_path = refs / "eval-v2-provenance.json"
    elif output_stem == "eval-results":
        provenance_path = refs / "eval-results-provenance.json"
    else:
        provenance_path = refs / f"{output_stem}-provenance.json"
    json_text = json.dumps(redacted, indent=2, sort_keys=True) + "\n"
    scan_forbidden_bytes(json_text.encode(), json_path.name)
    json_path.write_text(json_text)
    public_sha256 = digest_bytes(json_path.read_bytes())
    summaries, verified_cells = summarize(redacted)
    md_text = results_markdown(redacted, title=title, narrative=narrative)
    scan_forbidden_bytes(md_text.encode(), md_path.name)
    md_path.write_text(md_text)
    provenance_extra = dict(extra_provenance or {})
    if manifest_mismatch:
        provenance_extra["manifest_mismatch"] = manifest_mismatch
        provenance_extra["rescore"] = (
            "Skipped: source cases_sha256 does not match current eval-cases.json. "
            "Recorded scores and check statuses are preserved from the original execution."
        )
    provenance = build_provenance(
        source_sha256=source_sha256,
        public_sha256=public_sha256,
        redactions=redactions,
        manifest_sha256=manifest_sha256 if manifest_mismatch is None else source.get("cases_sha256", manifest_sha256),
        context_hashes=source.get("context_hashes", context_hashes),
        source=source,
        summaries=summaries,
        verified_cells=verified_cells,
        private_archive_basename=private_archive_basename,
        revision=revision,
        historical_artifacts_sha256=historical_artifacts_sha256,
        extra=provenance_extra or None,
    )
    provenance_text = json.dumps(provenance, indent=2, sort_keys=True) + "\n"
    scan_forbidden_bytes(provenance_text.encode(), provenance_path.name)
    provenance_path.write_text(provenance_text)
    return {
        "json": str(json_path.relative_to(repo_root)),
        "md": str(md_path.relative_to(repo_root)),
        "provenance": str(provenance_path.relative_to(repo_root)),
        "source_sha256": source_sha256,
        "public_sha256": public_sha256,
        "redactions": str(len(redactions)),
        "usable_calls": str(provenance["usable_calls"]),
        "attempts": str(provenance["attempts"]),
    }


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--repo", type=Path, default=Path(__file__).resolve().parents[1])
    parser.add_argument("--skill", type=Path, required=True)
    parser.add_argument("--source", type=Path, required=True)
    parser.add_argument("--output-stem", required=True)
    parser.add_argument("--private-archive-basename", required=True)
    parser.add_argument("--title", required=True)
    parser.add_argument("--narrative", required=True)
    parser.add_argument("--provenance-stem")
    parser.add_argument("--revision")
    parser.add_argument(
        "--allow-manifest-mismatch",
        action="store_true",
        help="Publish historical evidence when source cases_sha256 differs from current eval-cases.json; skips rescore.",
    )
    args = parser.parse_args()
    repo = args.repo.resolve()
    skill = (repo / args.skill if not args.skill.is_absolute() else args.skill).resolve()
    source = args.source.resolve()
    if not source.is_file():
        raise ValueError(f"missing source archive: {source}")
    result = publish(
        repo_root=repo,
        skill=skill,
        source_path=source,
        output_stem=args.output_stem,
        private_archive_basename=args.private_archive_basename,
        title=args.title,
        narrative=args.narrative,
        provenance_stem=args.provenance_stem,
        revision=args.revision,
        allow_manifest_mismatch=args.allow_manifest_mismatch,
    )
    print(json.dumps(result, indent=2, sort_keys=True))
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except (ValueError, AssertionError) as exc:
        print(f"ERROR: {exc}", file=sys.stderr)
        raise SystemExit(2)
