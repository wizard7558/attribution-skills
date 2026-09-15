#!/usr/bin/env python3
"""Authorized transport recovery for the frozen skill evaluation harness.

`scripts/run-skill-evals.py` is a frozen instrument: its SHA-256 is pinned in skill
manifest tests, in `scripts/publish-eval-matrix.py`, and in published provenance. It is
never edited. It does, however, hardcode a 300 second Claude subprocess timeout and
inherit stdin, and it keeps no output when a call times out. This runner imports that
exact file, verifies its hash, and applies scoped transport recovery for Claude and Ollama:

  * stdin becomes /dev/null instead of an inherited handle the CLI can block on;
  * the 300 second timeout becomes configurable (default 900);
  * `--max-budget-usd` becomes configurable (default 2, the frozen value);
  * Ollama `/api/chat` timeout becomes configurable while `/api/tags` remains unchanged;
  * a `TimeoutExpired` keeps its partial stdout/stderr tails as retained evidence.

Source cells are checked before a run and again before each retry; `--acknowledge-no-source`
records a fresh diagnostic run explicitly. Prompt, system, schema, model, and option
inputs remain bound to the validated source, and no historical transport cause is inferred.
Every attempt is checkpointed to its own supplement file. The frozen harness, published
results, and provenance are never written. Live calls require `--run`.
"""
from __future__ import annotations

import argparse
import hashlib
import importlib.util
import json
import math
import os
import re
import subprocess
import sys
import tempfile
import time
import urllib.request
from pathlib import Path
from typing import Any

FROZEN_HARNESS_SHA256 = "b12f6051d57135d23bdf5e4204c6d4866ddbb41d5602bb4ea63972ab45567b45"
FROZEN_HARNESS_VERSION = "2026-09-08.3"
FROZEN_CLAUDE_TIMEOUT_SECONDS = 300
DEFAULT_TIMEOUT_SECONDS = 900
MINIMUM_TIMEOUT_SECONDS = 300
DEFAULT_BUDGET_USD = 2.0
PARTIAL_OUTPUT_LIMIT = 2000
HARNESS_ENV = "SKILL_EVALS_HARNESS"
CONDITIONS = ("with-skill", "without-skill")
PUBLISHED_NAME = re.compile(r"^eval-results\.(json|md)$")


def harness_path() -> Path:
    override = os.environ.get(HARNESS_ENV)
    if override:
        return Path(override).expanduser().resolve()
    return Path(__file__).resolve().parents[1] / "scripts" / "run-skill-evals.py"


def load_frozen_harness() -> Any:
    """Import the frozen harness only when its bytes are the reviewed, pinned bytes."""
    path = harness_path()
    if not path.is_file():
        raise RuntimeError(f"frozen harness not found: {path}")
    actual = _digest(path.read_bytes())
    if actual != FROZEN_HARNESS_SHA256:
        raise RuntimeError(
            f"frozen harness hash mismatch: {path} is {actual}; expected {FROZEN_HARNESS_SHA256}. "
            "This runner never edits or runs an edited frozen harness; restore it or point "
            f"{HARNESS_ENV} at the reviewed copy."
        )
    specification = importlib.util.spec_from_file_location("frozen_harness", path)
    if specification is None or specification.loader is None:
        raise RuntimeError(f"cannot import frozen harness: {path}")
    module = importlib.util.module_from_spec(specification)
    specification.loader.exec_module(module)
    if module.HARNESS_VERSION != FROZEN_HARNESS_VERSION:
        raise RuntimeError(f"frozen harness version mismatch: {module.HARNESS_VERSION!r}; expected {FROZEN_HARNESS_VERSION!r}")
    return module


def _digest(value: bytes) -> str:
    return hashlib.sha256(value).hexdigest()


def _tail(value: Any) -> str | None:
    if value is None:
        return None
    if isinstance(value, bytes):
        value = value.decode("utf-8", errors="replace")
    return value[-PARTIAL_OUTPUT_LIMIT:]


def _transport_error(exc: BaseException, timeout: Any = None) -> str:
    if isinstance(exc, subprocess.TimeoutExpired):
        return f"TimeoutExpired: process exceeded timeout of {timeout} seconds"
    return f"{type(exc).__name__}: {str(exc)[:1000]}"


def _budget_text(value: float) -> str:
    """Preserve the parsed value without the frozen runner's two-place rounding."""
    return str(int(value)) if value.is_integer() else str(value)


class TransportPatch:
    """Patch only the Claude subprocess boundary and restore it on exit."""

    def __init__(self, timeout_seconds: int, budget_usd: float) -> None:
        self.timeout_seconds = timeout_seconds
        self.budget_usd = budget_usd
        self.stdin_injections = 0
        self.timeout_overrides = 0
        self.budget_overrides = 0
        self.claude_commands: list[list[str]] = []
        self.diagnostics: list[dict[str, Any]] = []
        self.original = subprocess.run

    def install(self) -> None:
        subprocess.run = self._run  # type: ignore[assignment]

    def restore(self) -> None:
        subprocess.run = self.original  # type: ignore[assignment]

    def __enter__(self) -> "TransportPatch":
        self.install()
        return self

    def __exit__(self, *_error: Any) -> bool:
        self.restore()
        return False

    def summary(self) -> dict[str, Any]:
        return {
            "claude_calls": len(self.claude_commands),
            "stdin_injections": self.stdin_injections,
            "timeout_overrides": self.timeout_overrides,
            "budget_overrides": self.budget_overrides,
            "timeout_captures": len(self.diagnostics),
            "effective_commands": [list(command) for command in self.claude_commands],
        }

    def _run(self, command: Any, *args: Any, **kwargs: Any) -> Any:
        if not command or command[0] != "claude":
            return self.original(command, *args, **kwargs)
        arguments = list(command)
        self.stdin_injections += 1
        kwargs["stdin"] = subprocess.DEVNULL
        if kwargs.get("timeout") == FROZEN_CLAUDE_TIMEOUT_SECONDS:
            kwargs["timeout"] = self.timeout_seconds
            self.timeout_overrides += 1
        if "--max-budget-usd" in arguments:
            index = arguments.index("--max-budget-usd") + 1
            if index < len(arguments) and arguments[index] != _budget_text(self.budget_usd):
                arguments[index] = _budget_text(self.budget_usd)
                self.budget_overrides += 1
        self.claude_commands.append(arguments)
        try:
            return self.original(arguments, *args, **kwargs)
        except subprocess.TimeoutExpired as exc:
            self.diagnostics.append(
                {
                    "command": arguments,
                    "timeout_seconds": kwargs.get("timeout"),
                    "stdout_tail": _tail(getattr(exc, "stdout", None)),
                    "stderr_tail": _tail(getattr(exc, "stderr", None)),
                }
            )
            raise


class OllamaTransportPatch:
    """Extend only /api/chat calls, leaving the /api/tags probe timeout intact."""

    def __init__(self, timeout_seconds: int) -> None:
        self.timeout_seconds = timeout_seconds
        self.original = urllib.request.urlopen
        self.chat_calls = 0
        self.timeout_overrides = 0
        self.chat_requests: list[dict[str, Any]] = []

    def __enter__(self) -> "OllamaTransportPatch":
        urllib.request.urlopen = self._urlopen  # type: ignore[assignment]
        return self

    def __exit__(self, *_error: Any) -> bool:
        urllib.request.urlopen = self.original  # type: ignore[assignment]
        return False

    def _urlopen(self, request: Any, *args: Any, **kwargs: Any) -> Any:
        url = request.full_url if hasattr(request, "full_url") else str(request)
        is_chat = url.rstrip("/").endswith("/api/chat")
        if not is_chat:
            return self.original(request, *args, **kwargs)
        self.chat_calls += 1
        positional = list(args)
        if len(positional) > 1 and positional[1] == FROZEN_CLAUDE_TIMEOUT_SECONDS:
            positional[1] = self.timeout_seconds
            self.timeout_overrides += 1
        elif "timeout" in kwargs and kwargs["timeout"] == FROZEN_CLAUDE_TIMEOUT_SECONDS:
            kwargs["timeout"] = self.timeout_seconds
            self.timeout_overrides += 1
        self.chat_requests.append({"url": url, "timeout": positional[1] if len(positional) > 1 else kwargs.get("timeout")})
        return self.original(request, *positional, **kwargs)

    def summary(self) -> dict[str, Any]:
        return {"chat_calls": self.chat_calls, "timeout_overrides": self.timeout_overrides, "requests": self.chat_requests}


def parse_cells(argument: str) -> tuple[str, str, str]:
    parts = argument.rsplit(":", 2)
    if len(parts) != 3 or not all(parts):
        raise ValueError(f"malformed --select {argument!r}; expected MODEL:CONDITION:GROUP")
    model, condition, group = parts
    if condition not in CONDITIONS:
        raise ValueError(f"malformed --select {argument!r}; condition must be one of {', '.join(CONDITIONS)}")
    return model, condition, group


def resolve_cells(args: argparse.Namespace, manifest: dict[str, Any]) -> list[tuple[str, str, str]]:
    known = {group["id"] for group in manifest["groups"]}
    if args.select:
        if args.models:
            raise ValueError("--select names exact cells; drop --models")
        cells = [parse_cells(item) for item in args.select]
    else:
        if not args.models:
            raise ValueError("--models or --select is required for a recovery attempt")
        conditions = CONDITIONS if args.condition == "both" else (args.condition,)
        cells = [(model, condition, group) for model in args.models for condition in conditions for group in (args.groups or sorted(known))]
    unknown = {group for _, _, group in cells} - known
    if unknown:
        raise ValueError(f"unknown groups: {', '.join(sorted(unknown))}")
    if len(set(cells)) != len(cells):
        raise ValueError("duplicate cells in selection")
    return cells


def validate_output(path: Path) -> Path:
    candidate = path.expanduser()
    resolved = candidate.resolve()
    if PUBLISHED_NAME.match(resolved.name):
        raise ValueError(
            f"refusing to write the primary published artifact name: {resolved.name}; write a distinct "
            "transport supplement instead"
        )
    if os.path.lexists(candidate):
        raise ValueError(f"refusing to overwrite existing output: {resolved}")
    return resolved


def reserve_output(path: Path, skill: Path, context_hashes: dict[str, str]) -> None:
    input_paths = {(skill / relative).resolve() for relative in context_hashes}
    input_paths.add((skill / "references" / "eval-cases.json").resolve())
    if path in input_paths:
        raise ValueError(f"refusing to write skill input: {path}")
    path.parent.mkdir(parents=True, exist_ok=True)
    try:
        descriptor = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    except FileExistsError as exc:
        raise ValueError(f"refusing to overwrite existing output: {path}") from exc
    else:
        os.close(descriptor)


def verify_source(
    harness: Any,
    source: Path,
    skill: Path,
    manifest: dict[str, Any],
    context_hashes: dict[str, str],
    cases_hash: str,
    cells: list[tuple[str, str, str]],
) -> tuple[dict[str, Any], dict[str, str], str]:
    source_bytes = source.read_bytes()
    try:
        results = json.loads(source_bytes, parse_constant=lambda value: (_ for _ in ()).throw(ValueError(f"non-finite JSON constant: {value}")))
    except (OSError, json.JSONDecodeError, ValueError) as exc:
        raise ValueError(f"cannot read JSON {source}: {exc}") from exc
    if results.get("harness_hash") != FROZEN_HARNESS_SHA256:
        raise ValueError(f"source harness hash mismatch: {source} records {results.get('harness_hash')!r}")
    if results.get("cases_sha256") != cases_hash:
        raise ValueError(f"source manifest mismatch: {source} records {results.get('cases_sha256')!r}")
    if results.get("context_hashes") != context_hashes:
        raise ValueError(f"source context mismatch: {source} records different context hashes")
    if results.get("skill") != skill.name:
        raise ValueError(f"source skill mismatch: {results.get('skill')!r} != {skill.name!r}")
    schema_hashes = results.get("schema_hashes", {})
    group_by_id = {group["id"]: group for group in manifest["groups"]}
    context_text = {relative: (skill / relative).read_text() for relative in context_hashes}
    failed_hashes: dict[str, str] = {}
    for model, condition, group_id in cells:
        group = group_by_id[group_id]
        retained = results.get("models", {}).get(model, {}).get(condition, {}).get(group_id)
        if retained is None:
            raise ValueError(f"source has no recorded cell for {model}/{condition}/{group_id}")
        if retained.get("completion_status") != "transport_failure":
            raise ValueError(
                f"refusing to retry a non-transport cell: {model}/{condition}/{group_id} is {retained.get('completion_status')!r}"
            )
        if retained.get("raw_envelope") is not None:
            raise ValueError(f"refusing to replace a recorded raw envelope: {model}/{condition}/{group_id}")
        expected_options = ({"safe_mode": True, "tools": False, "json_schema": bool((results.get("claude_help") or {}).get("json_schema")), "max_budget_usd": DEFAULT_BUDGET_USD}
                            if model in harness.CLAUDE_MODELS else {"num_ctx": 32768, "num_predict": 8192, "temperature": 0})
        if retained.get("requested_model") != model or retained.get("model_options") != expected_options:
            raise ValueError(f"source model or options mismatch in {model}/{condition}/{group_id}; budget/model inputs cannot change on retry")
        if model not in harness.CLAUDE_MODELS:
            observed = results.get("ollama_models", {}).get(model, {})
            if not observed.get("digest") or retained.get("model_digest") != observed.get("digest"):
                raise ValueError(f"source Ollama model digest mismatch in {model}/{condition}/{group_id}")
        if retained.get("context_sha256") != harness.digest_json(context_hashes if condition == "with-skill" else {}):
            raise ValueError(f"source context hash mismatch in {model}/{condition}/{group_id}")
        if retained.get("harness_hash") != FROZEN_HARNESS_SHA256 or retained.get("cases_sha256") != cases_hash:
            raise ValueError(f"source harness or cases mismatch in {model}/{condition}/{group_id}")
        expected_prompt = harness.prompt_for(group)
        expected_system = harness.system_prompt(condition, context_text if condition == "with-skill" else {})
        expected_schema = harness.digest_json(group["output_schema"])
        if retained.get("prompt") != expected_prompt or retained.get("system_prompt") != expected_system:
            raise ValueError(f"source prompt or system mismatch in {model}/{condition}/{group_id}")
        if retained.get("prompt_sha256") != harness.digest_bytes(expected_prompt.encode()):
            raise ValueError(f"source prompt hash mismatch in {model}/{condition}/{group_id}")
        if retained.get("system_prompt_sha256") != harness.digest_bytes(expected_system.encode()):
            raise ValueError(f"source system hash mismatch in {model}/{condition}/{group_id}")
        if retained.get("schema_sha256") != expected_schema or schema_hashes.get(group_id) != expected_schema:
            raise ValueError(f"source schema mismatch in {model}/{condition}/{group_id}")
        failed_hashes[f"{model}:{condition}:{group_id}"] = harness.digest_json(retained)
    return results, failed_hashes, _digest(source_bytes)


def probe_ollama(harness: Any, cells: list[tuple[str, str, str]]) -> dict[str, Any]:
    records: dict[str, Any] = {}
    for model in sorted({model for model, _, _ in cells}):
        if model in harness.CLAUDE_MODELS or model in records:
            continue
        observed = harness.ollama_digest(model)
        if not observed.get("digest"):
            raise RuntimeError(f"requested Ollama model unavailable or digest missing: {model}")
        records[model] = observed
    return records


def plan_lines(
    skill: Path,
    harness: Any,
    cases_hash: str,
    cells: list[tuple[str, str, str]],
    source: Path | None,
    source_results: dict[str, Any] | None,
    timeout_seconds: int,
    budget_usd: float,
    output: Path,
) -> list[str]:
    lines = [
        f"skill: {skill}",
        f"frozen harness: {harness_path()}",
        f"frozen harness sha256: {FROZEN_HARNESS_SHA256} (version {harness.HARNESS_VERSION})",
        f"manifest sha256: {cases_hash}",
        f"source: {source if source is not None else 'none (--acknowledge-no-source)'}",
        f"timeout: {FROZEN_CLAUDE_TIMEOUT_SECONDS}s -> {timeout_seconds}s",
        f"stdin: inherited -> /dev/null (subprocess.DEVNULL)",
        f"budget: ${_budget_text(DEFAULT_BUDGET_USD)} -> ${_budget_text(budget_usd)}",
        f"output: {output}",
        "",
        "| Model | Condition | Group | Recorded |",
        "| --- | --- | --- | --- |",
    ]
    for model, condition, group_id in cells:
        recorded = "not recorded"
        if source_results is not None:
            retained = source_results.get("models", {}).get(model, {}).get(condition, {}).get(group_id, {})
            recorded = f"{retained.get('completion_status')} (raw envelope: {retained.get('raw_envelope') is not None})"
        lines.append(f"| {model} | {condition} | {group_id} | {recorded} |")
    lines.append("")
    return lines


def evaluate_cell(
    harness: Any,
    patch: TransportPatch,
    model: str,
    condition: str,
    group: dict[str, Any],
    context_text: dict[str, str],
    context_hash: str,
    cases_hash: str,
    help_info: dict[str, Any],
    directory: Path,
    timeout_seconds: int,
    budget_usd: float,
    model_digest: str | None,
    ollama_patch: OllamaTransportPatch | None = None,
) -> dict[str, Any]:
    prompt = harness.prompt_for(group)
    system = harness.system_prompt(condition, context_text if condition == "with-skill" else {})
    prompt_hash = harness.digest_bytes(prompt.encode())
    intended_options = (
        {"safe_mode": True, "tools": False, "json_schema": bool(help_info.get("json_schema")), "max_budget_usd": budget_usd}
        if model in harness.CLAUDE_MODELS
        else {"num_ctx": 32768, "num_predict": 8192, "temperature": 0}
    )
    started = harness.now()
    started_monotonic = time.monotonic()
    diagnostics_before = len(patch.diagnostics)
    try:
        if model in harness.CLAUDE_MODELS:
            call = harness.claude_call(model, condition, prompt, system, directory, group["output_schema"], bool(help_info.get("json_schema")))
        else:
            call = harness.qwen_call(model, condition, prompt, system, group["output_schema"], model_digest)
        call["started_at"] = started
    except Exception as exc:  # preserve the transport failure exactly as the frozen harness does
        call = {
            "started_at": started,
            "transport_exit_code": 1,
            "stderr": _transport_error(exc, patch.timeout_seconds),
            "raw_envelope": None,
            "requested_model": model,
            "model_digest": model_digest,
            "model_options": intended_options,
        }
    call.setdefault("model_digest", model_digest)
    call.setdefault("model_options", intended_options)
    call["elapsed_seconds"] = round(time.monotonic() - started_monotonic, 6)
    call["prompt"] = prompt
    call["system_prompt"] = system
    call["system_prompt_sha256"] = harness.digest_bytes(system.encode())
    call["schema_sha256"] = harness.digest_json(group["output_schema"])
    call["harness_hash"] = harness.harness_hash()
    if model in harness.CLAUDE_MODELS:
        call["model_options"] = {**call["model_options"], "max_budget_usd": budget_usd}
    result = harness.evaluate_call(call, model, group, prompt, prompt_hash, context_hash, cases_hash)
    result["transport"]["effective_timeout_seconds"] = timeout_seconds if model in harness.CLAUDE_MODELS else (ollama_patch.chat_requests[-1]["timeout"] if ollama_patch and ollama_patch.chat_requests else None)
    result["transport"]["frozen_timeout_seconds"] = FROZEN_CLAUDE_TIMEOUT_SECONDS
    result["transport"]["stdin"] = str(subprocess.DEVNULL) if model in harness.CLAUDE_MODELS else None
    result["transport"]["partial_output"] = patch.diagnostics[diagnostics_before:]
    if model in harness.CLAUDE_MODELS and patch.claude_commands:
        result["transport"].pop("command", None)
        result["transport"]["command"] = list(patch.claude_commands[-1])
    if model not in harness.CLAUDE_MODELS and ollama_patch is not None:
        result["transport"]["ollama_chat_timeout_seconds"] = ollama_patch.chat_requests[-1]["timeout"] if ollama_patch.chat_requests else None
        result["transport"]["ollama_stdin"] = None
    result["transport"]["recovery_runner"] = Path(__file__).name
    return result


def run(args: argparse.Namespace) -> int:
    harness = load_frozen_harness()
    skill = args.skill.resolve()
    manifest, context_hashes, cases_hash = harness.validate_manifest(skill)
    if args.timeout_seconds < MINIMUM_TIMEOUT_SECONDS:
        raise ValueError(f"--timeout-seconds must be at least {MINIMUM_TIMEOUT_SECONDS}")
    if not math.isfinite(args.budget_usd) or args.budget_usd <= 0:
        raise ValueError("--budget-usd must be finite and positive")
    if bool(args.source) == bool(args.acknowledge_no_source):
        raise ValueError("pass exactly one of --source or --acknowledge-no-source")
    cells = resolve_cells(args, manifest)
    output = validate_output(args.output)
    source = args.source.resolve() if args.source else None
    source_results: dict[str, Any] | None = None
    failed_hashes: dict[str, str] = {}
    source_sha256: str | None = None
    if source is not None:
        source_results, failed_hashes, source_sha256 = verify_source(harness, source, skill, manifest, context_hashes, cases_hash, cells)
        if args.budget_usd != DEFAULT_BUDGET_USD:
            raise ValueError("--budget-usd cannot change when retrying a source; use --acknowledge-no-source for a customized run")
    context_text = {relative: (skill / relative).read_text() for relative in context_hashes}

    if not args.run:
        for line in plan_lines(skill, harness, cases_hash, cells, source, source_results, args.timeout_seconds, args.budget_usd, output):
            print(line)
        print("READY: validated recovery plan; pass --run for live calls")
        return 0

    reserve_output(output, skill, context_hashes)

    group_by_id = {group["id"]: group for group in manifest["groups"]}
    patch = TransportPatch(args.timeout_seconds, args.budget_usd)
    ollama_patch = OllamaTransportPatch(args.timeout_seconds)
    records: dict[str, Any] = {}
    started_at = harness.now()
    recovery = {
        "status": "incomplete",
        "original_file": source.name if source is not None else None,
        "original_sha256": source_sha256,
        "failed_cell_sha256": failed_hashes,
        "selection": [f"{model}:{condition}:{group_id}" for model, condition, group_id in cells],
        "cause": "transport recovery; the historical cause is not inferred from stdin",
        "original_timeout_seconds": FROZEN_CLAUDE_TIMEOUT_SECONDS,
        "supplemental_timeout_seconds": args.timeout_seconds,
        "original_budget_usd": DEFAULT_BUDGET_USD,
        "supplemental_budget_usd": args.budget_usd,
        "stdin_policy": "subprocess.DEVNULL injected for Claude calls only",
        "partial_output": "captured on TimeoutExpired (last 2000 characters of stdout and stderr)",
        "harness_file": str(harness_path()),
        "harness_sha256": FROZEN_HARNESS_SHA256,
        "wrapper_file": Path(__file__).name,
        "wrapper_sha256": _digest(Path(__file__).read_bytes()),
        "override": "Only provider transport boundaries changed; parser, schema, scorer, prompts and frozen harness are unchanged.",
        "argv": getattr(args, "recovery_argv", [sys.executable, *sys.argv]),
    }
    results = {
        "schema_version": 1, "skill": skill.name, "started_at": started_at,
        "cli_version": None, "claude_help": None, "cases_sha256": cases_hash,
        "context_hashes": context_hashes,
        "schema_hashes": {group["id"]: harness.digest_json(group["output_schema"]) for group in manifest["groups"]},
        "harness_hash": FROZEN_HARNESS_SHA256, "groups": [group["id"] for group in manifest["groups"]],
        "conditions": sorted({condition for _, condition, _ in cells}),
        "completed_groups": [], "models": records, "ollama_models": {}, "recovery": recovery,
    }
    # Own and persist the incomplete run before any provider diagnostics execute.
    harness.atomic_write(output, json.dumps(results, indent=2, sort_keys=True) + "\n")
    with tempfile.TemporaryDirectory(prefix=f"{skill.name}-recovery-") as directory_name:
        directory = Path(directory_name)
        try:
            # Preflight is inside the Claude DEVNULL patch and happens before any model call.
            with patch:
                need_claude = any(model in harness.CLAUDE_MODELS for model, _, _ in cells)
                need_ollama = any(model not in harness.CLAUDE_MODELS for model, _, _ in cells)
                help_info = harness.claude_help() if need_claude else {"exit_code": None, "json_schema": None}
                version = harness.cli_version() if need_claude else None
                if need_claude and (help_info.get("exit_code") != 0 or not version or version == "unavailable"):
                    raise RuntimeError("Claude preflight could not verify --help and --version before model calls")
                if source_results is not None and need_claude:
                    if source_results.get("cli_version") != version or source_results.get("claude_help", {}).get("json_schema") != help_info.get("json_schema"):
                        raise ValueError("source CLI/version or schema capability differs; refusing retry")
                results["cli_version"] = version
                results["claude_help"] = {"exit_code": help_info.get("exit_code"), "json_schema": help_info.get("json_schema")}
                ollama_models = probe_ollama(harness, cells) if need_ollama else {}
                if source_results is not None:
                    for model in {model for model, _, _ in cells if model not in harness.CLAUDE_MODELS}:
                        prior = source_results.get("ollama_models", {}).get(model, {})
                        current = ollama_models.get(model, {})
                        if (prior.get("name"), prior.get("digest")) != (current.get("name"), current.get("digest")):
                            raise ValueError(f"source Ollama model digest differs from current observed model: {model}")
                results["ollama_models"] = ollama_models
                recovery["patches_applied"] = {**patch.summary(), "ollama": ollama_patch.summary()}
                if need_ollama:
                    ollama_patch.__enter__()
                try:
                    for model, condition, group_id in cells:
                        if source is not None:
                            current = _digest(source.read_bytes())
                            if current != source_sha256:
                                raise ValueError("source changed after validation; refusing retry")
                            retained = source_results["models"][model][condition][group_id]
                            if harness.digest_json(retained) != failed_hashes[f"{model}:{condition}:{group_id}"]:
                                raise ValueError("source cell changed after validation; refusing retry")
                        group = group_by_id[group_id]
                        context_hash = harness.digest_json(context_hashes if condition == "with-skill" else {})
                        digest = None if model in harness.CLAUDE_MODELS else ollama_models.get(model, {}).get("digest")
                        result = evaluate_cell(harness, patch, model, condition, group, context_text, context_hash, cases_hash, help_info, directory, args.timeout_seconds, args.budget_usd, digest, ollama_patch)
                        records.setdefault(model, {}).setdefault(condition, {})[group_id] = result
                        results["completed_groups"] = sorted({gid for model_records in records.values() for condition_records in model_records.values() for gid in condition_records})
                        recovery["patches_applied"] = {**patch.summary(), "ollama": ollama_patch.summary()}
                        harness.atomic_write(output, json.dumps(results, indent=2, sort_keys=True) + "\n")
                        print(f"  {model} | {condition} | {group_id} | {result['completion_status']} | {result['elapsed_seconds']}s")
                finally:
                    if need_ollama:
                        ollama_patch.__exit__(None, None, None)
                recovery["status"] = "complete"
                recovery["finished_at"] = harness.now()
                recovery["patches_applied"] = {**patch.summary(), "ollama": ollama_patch.summary()}
                results["finished_at"] = recovery["finished_at"]
                harness.atomic_write(output, json.dumps(results, indent=2, sort_keys=True) + "\n")
        except BaseException as exc:
            recovery["status"] = "interrupted" if isinstance(exc, (KeyboardInterrupt, SystemExit)) else "incomplete"
            recovery["error"] = f"{type(exc).__name__}: {str(exc)[:500]}"
            recovery["patches_applied"] = {**patch.summary(), "ollama": ollama_patch.summary()}
            results["finished_at"] = harness.now()
            harness.atomic_write(output, json.dumps(results, indent=2, sort_keys=True) + "\n")
            if isinstance(exc, (KeyboardInterrupt, SystemExit)):
                return 130
            raise
        finally:
            if subprocess.run is not patch.original:
                raise RuntimeError("subprocess.run was not restored")
            if urllib.request.urlopen is not ollama_patch.original:
                raise RuntimeError("urllib.request.urlopen was not restored")
    print(f"WROTE {output}")
    return 0


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Retry recorded transport failures against the frozen evaluation harness without editing it.")
    parser.add_argument("--skill", type=Path, required=True)
    parser.add_argument("--models", nargs="+", help="exact model identities to retry; required unless --select is used")
    parser.add_argument("--condition", choices=("with-skill", "without-skill", "both"), default="both")
    parser.add_argument("--groups", nargs="+")
    parser.add_argument("--select", action="append", help="exact MODEL:CONDITION:GROUP cell, repeatable")
    parser.add_argument("--source", type=Path, help="prior results file whose recorded transport failures are retried")
    parser.add_argument("--acknowledge-no-source", action="store_true", help="run without a recorded source cell")
    parser.add_argument("--output", type=Path, required=True, help="distinct supplement path; never a published eval-results name")
    parser.add_argument("--timeout-seconds", type=int, default=DEFAULT_TIMEOUT_SECONDS)
    parser.add_argument("--budget-usd", type=float, default=DEFAULT_BUDGET_USD)
    parser.add_argument("--run", action="store_true", help="make live model calls; without it only the plan is printed")
    return parser


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    args.recovery_argv = [sys.executable, str(Path(__file__).resolve()), *(argv if argv is not None else sys.argv[1:])]
    try:
        return run(args)
    except (ValueError, RuntimeError) as exc:
        print(f"ERROR: {exc}", file=sys.stderr)
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
