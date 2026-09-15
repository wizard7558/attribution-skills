#!/usr/bin/env python3
"""Offline tests for scripts/run-skill-evals-recover.py.

Every test is transport-free: the frozen harness is never edited, no model or network
call is made, and the end-to-end case runs a local fake `claude` on PATH. The suite
also proves the frozen harness bytes are unchanged by the recovery runner.
"""
from __future__ import annotations

import contextlib
import hashlib
import importlib.util
import io
import json
import os
import pty
import stat
import subprocess
import sys
import tempfile
import urllib.request
from pathlib import Path
from unittest import mock

ROOT = Path(__file__).resolve().parents[1]
WRAPPER_PATH = ROOT / "scripts" / "run-skill-evals-recover.py"
HARNESS_PATH = ROOT / "scripts" / "run-skill-evals.py"
FROZEN_HARNESS_SHA256 = "b12f6051d57135d23bdf5e4204c6d4866ddbb41d5602bb4ea63972ab45567b45"
FAKE_MODEL = "claude-sonnet-5"

FAKE_CLAUDE = '''#!/usr/bin/env python3
import json
import select
import sys


def stdin_blocked():
    """An open inherited pipe never becomes readable; /dev/null is always at EOF."""
    try:
        readable, _, _ = select.select([sys.stdin], [], [], 5)
    except (ValueError, OSError):
        return False
    if not readable:
        return True
    sys.stdin.read(1)
    return False


args = sys.argv[1:]
if "--version" in args:
    print("9.9.9 (fake)")
    raise SystemExit(0)
if "--help" in args:
    print("Usage: fake claude [--json-schema]")
    raise SystemExit(0)
if stdin_blocked():
    print("standard input was inherited and never closed", file=sys.stderr)
    raise SystemExit(3)
model = args[args.index("--model") + 1]
print(json.dumps({
    "type": "result",
    "subtype": "success",
    "is_error": False,
    "structured_output": {"answer": "ok"},
    "modelUsage": {model: {}},
}))
'''


def load_module(name: str, path: Path):
    specification = importlib.util.spec_from_file_location(name, path)
    if specification is None or specification.loader is None:
        raise AssertionError(f"cannot load {path}")
    module = importlib.util.module_from_spec(specification)
    specification.loader.exec_module(module)
    return module


def digest(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def make_skill(root: Path, group_id: str = "example") -> Path:
    skill = root / "demo-skill"
    (skill / "references").mkdir(parents=True)
    (skill / "SKILL.md").write_text("# Demo skill\n")
    manifest = {
        "context_files": ["SKILL.md"],
        "groups": [
            {
                "id": group_id,
                "prompt": "Return the answer.",
                "input": {"question": "x"},
                "output_schema": {
                    "type": "object",
                    "properties": {"answer": {"type": "string"}},
                    "required": ["answer"],
                    "additionalProperties": False,
                },
                "checks": [{"path": "/answer", "op": "equals", "expected": "ok"}],
            }
        ],
    }
    (skill / "references" / "eval-cases.json").write_text(json.dumps(manifest, indent=2, sort_keys=True) + "\n")
    return skill


def make_source(harness, skill: Path, out: Path, completion_status: str = "transport_failure") -> Path:
    manifest, context_hashes, cases_hash = harness.validate_manifest(skill)
    group = manifest["groups"][0]
    prompt = harness.prompt_for(group)
    system = harness.system_prompt("without-skill", {})
    cell = {
        "started_at": harness.now(),
        "finished_at": harness.now(),
        "requested_model": FAKE_MODEL,
        "resolved_model": None,
        "model_digest": None,
        "model_options": {"safe_mode": True, "tools": False, "json_schema": True, "max_budget_usd": 2},
        "prompt": prompt,
        "system_prompt": system,
        "raw_envelope": None if completion_status == "transport_failure" else {"model": FAKE_MODEL},
        "parsed": None,
        "completion_status": completion_status,
        "schema_status": {"passed": False, "errors": []},
        "check_status": [],
        "prompt_sha256": harness.digest_bytes(prompt.encode()),
        "system_prompt_sha256": harness.digest_bytes(system.encode()),
        "context_sha256": harness.digest_json({}),
        "cases_sha256": cases_hash,
        "schema_sha256": harness.digest_json(group["output_schema"]),
        "harness_hash": digest(HARNESS_PATH),
        "elapsed_seconds": 300,
        "errors": ["transport_failure"],
        "transport": {"transport_exit_code": 1, "stderr": "TimeoutExpired"},
    }
    results = {
        "skill": skill.name,
        "cli_version": "9.9.9 (fake)",
        "claude_help": {"exit_code": 0, "json_schema": True},
        "cases_sha256": cases_hash,
        "context_hashes": context_hashes,
        "schema_hashes": {group["id"]: harness.digest_json(group["output_schema"])},
        "harness_hash": digest(HARNESS_PATH),
        "models": {FAKE_MODEL: {"without-skill": {group["id"]: cell}}},
    }
    out.write_text(json.dumps(results, indent=2, sort_keys=True) + "\n")
    return out


def capture_stdout(function, *args, **kwargs) -> tuple[int, str]:
    buffer = io.StringIO()
    with contextlib.redirect_stdout(buffer):
        code = function(*args, **kwargs)
    return code, buffer.getvalue()


def capture_stderr(function, *args, **kwargs) -> tuple[int, str]:
    buffer = io.StringIO()
    with contextlib.redirect_stderr(buffer):
        code = function(*args, **kwargs)
    return code, buffer.getvalue()


def test_rejects_tampered_harness() -> None:
    wrapper = load_module("recovery_runner_tamper", WRAPPER_PATH)
    with tempfile.TemporaryDirectory() as directory:
        tampered = Path(directory) / "run-skill-evals.py"
        tampered.write_bytes(HARNESS_PATH.read_bytes() + b"\n# tampered\n")
        previous = os.environ.get(wrapper.HARNESS_ENV)
        os.environ[wrapper.HARNESS_ENV] = str(tampered)
        try:
            try:
                wrapper.load_frozen_harness()
            except RuntimeError as exc:
                assert "frozen harness hash mismatch" in str(exc), str(exc)
                assert wrapper.FROZEN_HARNESS_SHA256 in str(exc)
            else:
                raise AssertionError("a tampered frozen harness must be rejected")
        finally:
            if previous is None:
                os.environ.pop(wrapper.HARNESS_ENV, None)
            else:
                os.environ[wrapper.HARNESS_ENV] = previous


def test_plan_mode_makes_no_subprocess_call() -> None:
    wrapper = load_module("recovery_runner_plan", WRAPPER_PATH)
    with tempfile.TemporaryDirectory() as directory:
        root = Path(directory)
        skill = make_skill(root)
        source = make_source(load_module("frozen_harness_plan", HARNESS_PATH), skill, root / "prior.json")
        output = root / "recovery-supplement.json"
        calls: list[object] = []
        original = subprocess.run

        def refuse(command, *args, **kwargs):
            calls.append(command)
            raise AssertionError("plan mode must not spawn a subprocess")

        subprocess.run = refuse  # type: ignore[assignment]
        try:
            code, text = capture_stdout(
                wrapper.main,
                ["--skill", str(skill), "--models", FAKE_MODEL, "--condition", "without-skill", "--groups", "example", "--source", str(source), "--output", str(output)],
            )
        finally:
            subprocess.run = original  # type: ignore[assignment]
        assert code == 0, code
        assert calls == [], calls
        assert "READY: validated recovery plan; pass --run for live calls" in text
        assert "timeout: 300s -> 900s" in text
        assert "stdin: inherited -> /dev/null" in text
        assert not output.exists(), "plan mode must not write results"


def test_rejects_short_timeout_and_output_names() -> None:
    wrapper = load_module("recovery_runner_args", WRAPPER_PATH)
    with tempfile.TemporaryDirectory() as directory:
        root = Path(directory)
        skill = make_skill(root)
        output = root / "supplement.json"
        code, message = capture_stderr(
            wrapper.main,
            ["--skill", str(skill), "--models", FAKE_MODEL, "--acknowledge-no-source", "--output", str(output), "--timeout-seconds", "120"],
        )
        assert code == 2 and "--timeout-seconds must be at least 300" in message, message
        published = root / "references" / "eval-results.json"
        published.parent.mkdir()
        code, message = capture_stderr(
            wrapper.main,
            ["--skill", str(skill), "--models", FAKE_MODEL, "--acknowledge-no-source", "--output", str(published)],
        )
        assert code == 2 and "refusing to write the primary published artifact name" in message, message
        supplement = root / "references" / "eval-results-transport-supplement-demo-example-without.json"
        code, _ = capture_stdout(
            wrapper.main,
            ["--skill", str(skill), "--models", FAKE_MODEL, "--acknowledge-no-source", "--output", str(supplement)],
        )
        assert code == 0 and not supplement.exists(), "the repository supplement name must be allowed and never written in plan mode"
        existing = root / "already-there.json"
        existing.write_text("{}")
        calls: list[object] = []
        original = subprocess.run
        subprocess.run = lambda *args, **kwargs: calls.append(args)  # type: ignore[assignment]
        code, message = capture_stderr(
            wrapper.main,
            ["--skill", str(skill), "--models", FAKE_MODEL, "--acknowledge-no-source", "--output", str(existing), "--run"],
        )
        subprocess.run = original  # type: ignore[assignment]
        assert code == 2 and "refusing to overwrite existing output" in message, message
        assert calls == [], calls
        code, message = capture_stderr(
            wrapper.main,
            ["--skill", str(skill), "--models", FAKE_MODEL, "--output", str(output)],
        )
        assert code == 2 and "pass exactly one of --source or --acknowledge-no-source" in message, message
        code, message = capture_stderr(
            wrapper.main,
            ["--skill", str(skill), "--select", f"{FAKE_MODEL}:both:example", "--acknowledge-no-source", "--output", str(output)],
        )
        assert code == 2 and "condition must be one of" in message, message
        code, message = capture_stderr(
            wrapper.main,
            ["--skill", str(skill), "--select", f"{FAKE_MODEL}:without-skill:example", "--models", FAKE_MODEL, "--acknowledge-no-source", "--output", str(output)],
        )
        assert code == 2 and "drop --models" in message, message


def test_rejects_non_transport_and_missing_cells() -> None:
    wrapper = load_module("recovery_runner_source", WRAPPER_PATH)
    harness = load_module("frozen_harness_source", HARNESS_PATH)
    with tempfile.TemporaryDirectory() as directory:
        root = Path(directory)
        skill = make_skill(root)
        complete = make_source(harness, skill, root / "complete.json", completion_status="complete")
        output = root / "supplement.json"
        code, message = capture_stderr(
            wrapper.main,
            ["--skill", str(skill), "--models", FAKE_MODEL, "--condition", "without-skill", "--groups", "example", "--source", str(complete), "--output", str(output)],
        )
        assert code == 2 and "refusing to retry a non-transport cell" in message, message
        failure = make_source(harness, skill, root / "failure.json")
        code, message = capture_stderr(
            wrapper.main,
            ["--skill", str(skill), "--models", FAKE_MODEL, "--condition", "without-skill", "--groups", "example", "--source", str(failure), "--budget-usd", "2.5", "--output", str(output)],
        )
        assert code == 2 and "cannot change" in message, message
        code, message = capture_stderr(
            wrapper.main,
            ["--skill", str(skill), "--models", FAKE_MODEL, "--condition", "with-skill", "--groups", "example", "--source", str(failure), "--output", str(output)],
        )
        assert code == 2 and "source has no recorded cell" in message, message
        damaged = json.loads(failure.read_text())
        damaged["cases_sha256"] = "0" * 64
        damaged_path = root / "damaged.json"
        damaged_path.write_text(json.dumps(damaged))
        code, message = capture_stderr(
            wrapper.main,
            ["--skill", str(skill), "--models", FAKE_MODEL, "--condition", "without-skill", "--groups", "example", "--source", str(damaged_path), "--output", str(output)],
        )
        assert code == 2 and "source manifest mismatch" in message, message
        changed_prompt = json.loads(failure.read_text())
        changed_prompt["models"][FAKE_MODEL]["without-skill"]["example"]["prompt"] = "different"
        changed_path = root / "changed.json"
        changed_path.write_text(json.dumps(changed_prompt))
        code, message = capture_stderr(
            wrapper.main,
            ["--skill", str(skill), "--models", FAKE_MODEL, "--condition", "without-skill", "--groups", "example", "--source", str(changed_path), "--output", str(output)],
        )
        assert code == 2 and "source prompt or system mismatch" in message, message
        changed_hash = json.loads(failure.read_text())
        changed_hash["models"][FAKE_MODEL]["without-skill"]["example"]["prompt_sha256"] = "0" * 64
        changed_hash_path = root / "changed-prompt-hash.json"
        changed_hash_path.write_text(json.dumps(changed_hash))
        code, message = capture_stderr(
            wrapper.main,
            ["--skill", str(skill), "--models", FAKE_MODEL, "--condition", "without-skill", "--groups", "example", "--source", str(changed_hash_path), "--output", str(output)],
        )
        assert code == 2 and "source prompt hash mismatch" in message, message
        unknown = make_source(harness, skill, root / "unknown.json")
        code, message = capture_stderr(
            wrapper.main,
            ["--skill", str(skill), "--models", FAKE_MODEL, "--condition", "without-skill", "--groups", "not-a-group", "--source", str(unknown), "--output", str(output)],
        )
        assert code == 2 and "unknown groups" in message, message


def test_transport_patch_boundary() -> None:
    wrapper = load_module("recovery_runner_patch", WRAPPER_PATH)
    observed: list[tuple[list[str], dict]] = []

    def fake(command, *args, **kwargs):
        observed.append((list(command), dict(kwargs)))
        return subprocess.CompletedProcess(command, 0, "ok", "")

    original = subprocess.run
    patch = wrapper.TransportPatch(900, 2.5)
    patch.original = fake
    patch.install()
    try:
        subprocess.run(["claude", "--model", "x", "--max-budget-usd", "2", "-p", "p"], timeout=300, capture_output=True)
        subprocess.run(["ollama", "run", "x"], timeout=300)
        subprocess.run(["claude", "--model", "x"], timeout=60)
    finally:
        patch.original = original
        patch.restore()
    assert subprocess.run is original
    assert len(observed) == 3
    claude_args, claude_kwargs = observed[0]
    assert claude_kwargs["stdin"] is subprocess.DEVNULL
    assert claude_kwargs["timeout"] == 900
    assert claude_args[claude_args.index("--max-budget-usd") + 1] == "2.5"
    ollama_args, ollama_kwargs = observed[1]
    assert "stdin" not in ollama_kwargs and ollama_kwargs["timeout"] == 300
    assert ollama_args == ["ollama", "run", "x"]
    second_args, second_kwargs = observed[2]
    assert second_kwargs["stdin"] is subprocess.DEVNULL and second_kwargs["timeout"] == 60
    assert "--max-budget-usd" not in second_args
    summary = patch.summary()
    assert summary["claude_calls"] == 2 and summary["stdin_injections"] == 2
    assert summary["timeout_overrides"] == 1 and summary["budget_overrides"] == 1 and summary["timeout_captures"] == 0
    assert all(isinstance(command, list) for command in summary["effective_commands"])


def test_tagged_selector_and_budget_validation() -> None:
    wrapper = load_module("recovery_runner_selector", WRAPPER_PATH)
    assert wrapper.parse_cells("qwen3:4b:without-skill:example") == ("qwen3:4b", "without-skill", "example")
    with tempfile.TemporaryDirectory() as directory:
        skill = make_skill(Path(directory))
        output = Path(directory) / "budget.json"
        for value in ("nan", "inf", "-inf", "0"):
            code, message = capture_stderr(wrapper.main, ["--skill", str(skill), "--models", FAKE_MODEL, "--acknowledge-no-source", "--output", str(output), f"--budget-usd={value}"])
            assert code == 2 and "finite and positive" in message, (value, message)


def test_ollama_chat_timeout_scoped_and_restored_on_error() -> None:
    wrapper = load_module("recovery_runner_ollama_patch", WRAPPER_PATH)
    calls = []

    def fake(request, *args, **kwargs):
        calls.append((request.full_url, args, kwargs))
        if request.full_url.endswith("/api/chat") and len(calls) == 1:
            raise RuntimeError("fake chat failure")
        return object()

    original = urllib.request.urlopen
    urllib.request.urlopen = fake  # type: ignore[assignment]
    patch = wrapper.OllamaTransportPatch(900)
    try:
        try:
            with patch:
                wrapper.urllib.request.urlopen(urllib.request.Request("http://x/api/chat"), timeout=300)
        except RuntimeError:
            pass
        assert urllib.request.urlopen is fake
        assert calls[0][1] == () and calls[0][2]["timeout"] == 900
        with patch:
            wrapper.urllib.request.urlopen(urllib.request.Request("http://x/api/chat"), None, 300)
        assert calls[1][1] == (None, 900)
        assert patch.chat_requests[-1]["timeout"] == 900
        with patch:
            wrapper.urllib.request.urlopen(urllib.request.Request("http://x/api/tags"), None, 15)
        assert calls[2][1] == (None, 15)
    finally:
        urllib.request.urlopen = original  # type: ignore[assignment]


def test_checkpoint_precedes_claude_preflight() -> None:
    wrapper = load_module("recovery_runner_preflight_checkpoint", WRAPPER_PATH)
    with tempfile.TemporaryDirectory() as directory:
        root = Path(directory)
        skill = make_skill(root)
        output = root / "preflight-interrupted.json"
        original_run = subprocess.run
        seen: list[dict] = []

        def preflight(command, *args, **kwargs):
            seen.append(json.loads(output.read_text()))
            raise KeyboardInterrupt()

        subprocess.run = preflight  # type: ignore[assignment]
        try:
            code = wrapper.main(["--skill", str(skill), "--models", FAKE_MODEL, "--condition", "without-skill", "--groups", "example", "--acknowledge-no-source", "--output", str(output), "--run"])
        finally:
            subprocess.run = original_run  # type: ignore[assignment]
        assert code == 130 and seen[0]["models"] == {}
        results = json.loads(output.read_text())
        assert results["recovery"]["status"] == "interrupted"
        assert results["models"] == {}


def test_ollama_end_to_end_and_source_digest_guard() -> None:
    wrapper = load_module("recovery_runner_ollama_e2e", WRAPPER_PATH)
    harness = load_module("frozen_harness_ollama_e2e", HARNESS_PATH)
    model = "qwen3.8:latest"
    with tempfile.TemporaryDirectory() as directory:
        root = Path(directory)
        skill = make_skill(root)
        output = root / "ollama-recovery.json"
        requests: list[tuple[str, tuple, dict]] = []

        class Response:
            def __init__(self, payload):
                self.payload = json.dumps(payload).encode()
            def __enter__(self):
                return self
            def __exit__(self, *args):
                return False
            def read(self):
                return self.payload

        def fake_urlopen(request, *args, **kwargs):
            requests.append((request.full_url, args, kwargs))
            if request.full_url.endswith("/api/tags"):
                return Response({"models": [{"name": model, "digest": "digest-new", "details": {}}]})
            assert request.full_url.endswith("/api/chat"), request.full_url
            body = json.loads(request.data)
            assert body["model"] == model
            return Response({"model": model, "done_reason": "stop", "message": {"content": '{"answer":"ok"}'}})

        original_urlopen = urllib.request.urlopen
        original_run = subprocess.run

        def forbid_subprocess(*args, **kwargs):
            raise AssertionError("Ollama run must not spawn subprocesses")

        urllib.request.urlopen = fake_urlopen  # type: ignore[assignment]
        subprocess.run = forbid_subprocess  # type: ignore[assignment]
        try:
            code = wrapper.main(["--skill", str(skill), "--select", f"{model}:without-skill:example", "--acknowledge-no-source", "--output", str(output), "--run"])
        finally:
            urllib.request.urlopen = original_urlopen  # type: ignore[assignment]
            subprocess.run = original_run  # type: ignore[assignment]
        assert code == 0 and urllib.request.urlopen is original_urlopen
        assert subprocess.run is original_run
        results = json.loads(output.read_text())
        cell = results["models"][model]["without-skill"]["example"]
        assert results["ollama_models"][model]["digest"] == "digest-new"
        assert cell["resolved_model"] == model and cell["completion_status"] == "complete"
        assert cell["model_digest"] == "digest-new"
        assert cell["transport"]["stdin"] is None and cell["transport"]["effective_timeout_seconds"] == 900
        assert requests[0][1] == () and requests[0][2]["timeout"] == 15
        assert requests[1][1] == () and requests[1][2]["timeout"] == 900
        source = root / "ollama-source.json"
        manifest, context_hashes, cases_hash = harness.validate_manifest(skill)
        prompt = harness.prompt_for(manifest["groups"][0])
        system = harness.system_prompt("without-skill", {})
        source_cell = {"requested_model": model, "model_digest": "digest-old", "model_options": {"num_ctx": 32768, "num_predict": 8192, "temperature": 0}, "completion_status": "transport_failure", "raw_envelope": None, "prompt": prompt, "system_prompt": system, "prompt_sha256": harness.digest_bytes(prompt.encode()), "system_prompt_sha256": harness.digest_bytes(system.encode()), "context_sha256": harness.digest_json({}), "cases_sha256": cases_hash, "schema_sha256": harness.digest_json(manifest["groups"][0]["output_schema"]), "harness_hash": FROZEN_HARNESS_SHA256, "transport": {}}
        source.write_text(json.dumps({"skill": skill.name, "harness_hash": FROZEN_HARNESS_SHA256, "cases_sha256": cases_hash, "context_hashes": context_hashes, "schema_hashes": {"example": harness.digest_json(manifest["groups"][0]["output_schema"])}, "models": {model: {"without-skill": {"example": source_cell}}}, "ollama_models": {model: {"name": model, "digest": "digest-old"}}}))
        guarded = root / "ollama-guarded.json"
        requests.clear()
        with mock.patch.object(urllib.request, "urlopen", fake_urlopen), mock.patch.object(subprocess, "run", forbid_subprocess):
            code, message = capture_stderr(wrapper.main, ["--skill", str(skill), "--select", f"{model}:without-skill:example", "--source", str(source), "--output", str(guarded), "--run"])
            assert urllib.request.urlopen is fake_urlopen
            assert subprocess.run is forbid_subprocess
        assert urllib.request.urlopen is original_urlopen
        assert subprocess.run is original_run
        assert code == 2, message
        assert f"source Ollama model digest differs from current observed model: {model}" in message, message
        assert len(requests) == 1, requests
        assert sum(url.endswith("/api/tags") for url, _, _ in requests) == 1, requests
        assert sum(url.endswith("/api/chat") for url, _, _ in requests) == 0, requests
        assert json.loads(guarded.read_text())["recovery"]["status"] == "incomplete"


def test_partial_output_kept_on_timeout() -> None:
    wrapper = load_module("recovery_runner_partial", WRAPPER_PATH)

    def fake(command, *args, **kwargs):
        raise subprocess.TimeoutExpired(command, kwargs.get("timeout"), output=b"o" * 5000, stderr=b"e" * 30)

    original = subprocess.run
    patch = wrapper.TransportPatch(900, 2.0)
    patch.original = fake
    patch.install()
    try:
        try:
            subprocess.run(["claude", "--model", "x"], timeout=300, capture_output=True)
        except subprocess.TimeoutExpired:
            pass
        else:
            raise AssertionError("the timeout must propagate")
    finally:
        patch.original = original
        patch.restore()
    assert subprocess.run is original
    assert len(patch.diagnostics) == 1
    diagnostic = patch.diagnostics[0]
    assert diagnostic["timeout_seconds"] == 900
    assert len(diagnostic["stdout_tail"]) == wrapper.PARTIAL_OUTPUT_LIMIT
    assert diagnostic["stderr_tail"] == "e" * 30


def fake_harness_hash() -> str:
    return digest(HARNESS_PATH)


def test_end_to_end_offline_recovery() -> None:
    with tempfile.TemporaryDirectory() as directory:
        root = Path(directory)
        skill = make_skill(root)
        harness = load_module("frozen_harness_e2e", HARNESS_PATH)
        source = make_source(harness, skill, root / "prior.json")
        before_source = source.read_bytes()
        bin_directory = root / "bin"
        bin_directory.mkdir()
        fake = bin_directory / "claude"
        fake.write_text(FAKE_CLAUDE)
        fake.chmod(fake.stat().st_mode | stat.S_IEXEC | stat.S_IXGRP | stat.S_IXOTH)
        output = root / "ga4-recovery-supplement.json"
        environment = dict(os.environ)
        environment["PATH"] = f"{bin_directory}{os.pathsep}{environment['PATH']}"
        environment["SKILL_EVALS_HARNESS"] = str(HARNESS_PATH)
        # A live, unwritten pty is the deterministic stand-in for the inherited terminal
        # stdin that blocked the frozen harness: without the DEVNULL injection the fake
        # claude waits five seconds and exits non-zero.
        master, slave = pty.openpty()
        try:
            completed = subprocess.run(
                [
                    sys.executable,
                    str(WRAPPER_PATH),
                    "--skill", str(skill),
                    "--models", FAKE_MODEL,
                    "--condition", "without-skill",
                    "--groups", "example",
                    "--source", str(source),
                    "--output", str(output),
                    "--run",
                ],
                env=environment,
                stdin=slave,
                capture_output=True,
                text=True,
                timeout=120,
            )
        finally:
            os.close(slave)
            os.close(master)
        assert completed.returncode == 0, f"{completed.stdout}\n{completed.stderr}"
        assert output.is_file(), completed.stdout
        assert source.read_bytes() == before_source, "the source results file must not be modified"
        results = json.loads(output.read_text())
        assert results["harness_hash"] == FROZEN_HARNESS_SHA256
        assert results["cases_sha256"] == harness.validate_manifest(skill)[2]
        cell = results["models"][FAKE_MODEL]["without-skill"]["example"]
        assert cell["completion_status"] == "complete", cell["errors"]
        assert cell["errors"] == []
        assert cell["check_status"][0]["passed"] is True
        assert cell["resolved_model"] == FAKE_MODEL
        assert cell["transport"]["stdin"] == str(subprocess.DEVNULL)
        assert cell["transport"]["effective_timeout_seconds"] == 900
        assert cell["transport"]["frozen_timeout_seconds"] == 300
        assert cell["transport"]["partial_output"] == []
        recovery = results["recovery"]
        assert recovery["original_file"] == "prior.json"
        assert recovery["original_sha256"] == hashlib.sha256(before_source).hexdigest()
        assert recovery["failed_cell_sha256"], "the retried cell hash must be recorded"
        assert recovery["supplemental_timeout_seconds"] == 900
        assert "DEVNULL" in recovery["stdin_policy"]
        assert recovery["patches_applied"]["stdin_injections"] == 3
        assert recovery["patches_applied"]["claude_calls"] == 3
        assert recovery["patches_applied"]["timeout_overrides"] == 1
        assert recovery["harness_sha256"] == FROZEN_HARNESS_SHA256


def test_end_to_end_transport_failure_recorded() -> None:
    """A failing fake keeps the failure honest and still writes a supplement."""
    with tempfile.TemporaryDirectory() as directory:
        root = Path(directory)
        skill = make_skill(root)
        bin_directory = root / "bin"
        bin_directory.mkdir()
        fake = bin_directory / "claude"
        fake.write_text(
            "#!/usr/bin/env python3\n"
            "import sys\n"
            "args = sys.argv[1:]\n"
            "if '--version' in args:\n"
            "    print('9.9.9 (fake)'); raise SystemExit(0)\n"
            "if '--help' in args:\n"
            "    print('fake --json-schema'); raise SystemExit(0)\n"
            "sys.stdout.write('partial reasoning from a failed call')\n"
            "sys.stderr.write('claude exited without an envelope')\n"
            "raise SystemExit(1)\n"
        )
        fake.chmod(fake.stat().st_mode | stat.S_IEXEC | stat.S_IXGRP | stat.S_IXOTH)
        output = root / "failed-supplement.json"
        environment = dict(os.environ)
        environment["PATH"] = f"{bin_directory}{os.pathsep}{environment['PATH']}"
        environment["SKILL_EVALS_HARNESS"] = str(HARNESS_PATH)
        completed = subprocess.run(
            [
                sys.executable,
                str(WRAPPER_PATH),
                "--skill", str(skill),
                "--models", FAKE_MODEL,
                "--condition", "without-skill",
                "--groups", "example",
                "--acknowledge-no-source",
                "--output", str(output),
                "--run",
            ],
            env=environment,
            stdin=subprocess.PIPE,
            capture_output=True,
            text=True,
            timeout=120,
        )
        assert completed.returncode == 0, f"{completed.stdout}\n{completed.stderr}"
        results = json.loads(output.read_text())
        cell = results["models"][FAKE_MODEL]["without-skill"]["example"]
        assert cell["completion_status"] == "transport_failure"
        assert "transport_failure" in cell["errors"]
        assert cell["raw_envelope"] == "partial reasoning from a failed call"
        assert cell["transport"]["transport_exit_code"] == 1
        assert cell["transport"]["partial_output"] == []
        assert "claude exited without an envelope" in cell["transport"]["stderr"]
        assert results["recovery"]["original_file"] is None


def test_late_interruption_keeps_checkpoint() -> None:
    wrapper = load_module("recovery_runner_interrupt", WRAPPER_PATH)
    with tempfile.TemporaryDirectory() as directory:
        root = Path(directory)
        skill = make_skill(root)
        bin_directory = root / "bin"
        bin_directory.mkdir()
        fake = bin_directory / "claude"
        fake.write_text(FAKE_CLAUDE)
        fake.chmod(fake.stat().st_mode | stat.S_IEXEC | stat.S_IXGRP | stat.S_IXOTH)
        output = root / "interrupted.json"
        environment = dict(os.environ)
        environment["PATH"] = f"{bin_directory}{os.pathsep}{environment['PATH']}"
        environment["SKILL_EVALS_HARNESS"] = str(HARNESS_PATH)
        original_evaluate = wrapper.evaluate_cell
        calls = 0

        def interrupt_after_one(*args, **kwargs):
            nonlocal calls
            calls += 1
            if calls == 2:
                raise KeyboardInterrupt()
            return original_evaluate(*args, **kwargs)

        wrapper.evaluate_cell = interrupt_after_one
        previous_path = os.environ.get("PATH")
        previous_harness = os.environ.get("SKILL_EVALS_HARNESS")
        os.environ.update({"PATH": environment["PATH"], "SKILL_EVALS_HARNESS": environment["SKILL_EVALS_HARNESS"]})
        try:
            code = wrapper.main(["--skill", str(skill), "--models", FAKE_MODEL, "--condition", "both", "--groups", "example", "--acknowledge-no-source", "--output", str(output), "--run"])
        finally:
            wrapper.evaluate_cell = original_evaluate
            if previous_path is None:
                os.environ.pop("PATH", None)
            else:
                os.environ["PATH"] = previous_path
            if previous_harness is None:
                os.environ.pop("SKILL_EVALS_HARNESS", None)
            else:
                os.environ["SKILL_EVALS_HARNESS"] = previous_harness
        assert code == 130
        results = json.loads(output.read_text())
        assert results["recovery"]["status"] == "interrupted"
        assert results["completed_groups"] == ["example"]
        assert len(results["models"][FAKE_MODEL]["with-skill"]) == 1


def main() -> int:
    before = fake_harness_hash()
    tests = [
        test_rejects_tampered_harness,
        test_plan_mode_makes_no_subprocess_call,
        test_rejects_short_timeout_and_output_names,
        test_rejects_non_transport_and_missing_cells,
        test_transport_patch_boundary,
        test_partial_output_kept_on_timeout,
        test_tagged_selector_and_budget_validation,
        test_ollama_chat_timeout_scoped_and_restored_on_error,
        test_checkpoint_precedes_claude_preflight,
        test_ollama_end_to_end_and_source_digest_guard,
        test_end_to_end_offline_recovery,
        test_end_to_end_transport_failure_recorded,
        test_late_interruption_keeps_checkpoint,
    ]
    blocked_requests: list[str] = []
    original_urlopen = urllib.request.urlopen
    original_open = urllib.request.OpenerDirector.open

    def refuse_http(request, *args, **kwargs):
        url = getattr(request, "full_url", str(request))
        blocked_requests.append(url)
        raise AssertionError(f"unmocked urllib request forbidden in offline tests: {url}")

    def refuse_opener(self, request, *args, **kwargs):
        return refuse_http(request, *args, **kwargs)

    # Cases may replace urlopen with a fake; all other urllib access is denied.
    # Track attempts as well, so a wrapper cannot swallow the failure and pass.
    with mock.patch.object(urllib.request, "urlopen", refuse_http), mock.patch.object(urllib.request.OpenerDirector, "open", refuse_opener):
        for test in tests:
            test()
            assert not blocked_requests, blocked_requests
            assert urllib.request.urlopen is refuse_http
            assert urllib.request.OpenerDirector.open is refuse_opener
            print(f"PASS {test.__name__}")
    assert urllib.request.urlopen is original_urlopen
    assert urllib.request.OpenerDirector.open is original_open
    print("PASS offline HTTP default-deny guard (zero unmocked requests)")
    after = fake_harness_hash()
    assert before == after, "the frozen harness must not change during recovery tests"
    assert before == FROZEN_HARNESS_SHA256, f"unexpected frozen harness hash: {before}"
    print("PASS frozen harness unchanged")
    print(f"PASS run-skill-evals-recover tests ({len(tests)})")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
