#!/usr/bin/env python3
"""One authorized transport-only recovery; never replace frozen original evidence."""
import importlib.util
import json
import sys
import tempfile
import time
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[2]
SPEC = importlib.util.spec_from_file_location('frozen_harness', ROOT / 'scripts/run-skill-evals.py')
h = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(h)
assert h.harness_hash() == 'b12f6051d57135d23bdf5e4204c6d4866ddbb41d5602bb4ea63972ab45567b45'
manifest, contexts, cases_hash = h.validate_manifest(HERE.parent)
assert cases_hash == '35b20930e1901ac330c7dbdd964842def2ef4b3bd1b2df54d47016dc7d4e41a5'
original_path = HERE / 'eval-results-v2.json'
original = h.read_json(original_path)
assert original.get('finished_at'), 'original matrix must be terminal'
original_hash = h.digest_bytes(original_path.read_bytes())
model, condition, group_id = 'claude-sonnet-5', 'without-skill', 'cost-reconciliation'
failed = original['models'][model][condition][group_id]
assert failed['completion_status'] == 'transport_failure' and failed['raw_envelope'] is None
assert 'TimeoutExpired' in failed['transport']['stderr']
group = next(g for g in manifest['groups'] if g['id'] == group_id)
help_info = h.claude_help()
version = h.cli_version()
h.verify_resume(original, HERE.parent, manifest['groups'], contexts, cases_hash, help_info, version)
prompt, system = h.prompt_for(group), h.system_prompt(condition, {})
assert prompt == failed['prompt'] and system == failed['system_prompt']
assert h.digest_json(group['output_schema']) == failed['schema_sha256']
output = HERE / 'eval-results-v2-transport-supplement.json'
assert not output.exists(), 'preserve every supplemental attempt in a distinct file'
if sys.argv[1:] != ['--run']:
    raise SystemExit('Validated frozen recovery; pass --run for the single authorized call')
started = h.now()
metadata = {k: original[k] for k in ('schema_version', 'skill', 'cli_version', 'claude_help', 'cases_sha256', 'context_hashes', 'schema_hashes', 'harness_hash')}
metadata.update(started_at=started, finished_at=None, groups=[group_id], conditions=[condition], models={}, recovery={
    'original_file': original_path.name, 'original_sha256': original_hash,
    'failed_cell_sha256': h.digest_json(failed), 'selection': [model, condition, group_id],
    'cause': 'Python subprocess.TimeoutExpired after 300 seconds; no raw model envelope was available',
    'original_timeout_seconds': 300, 'supplemental_timeout_seconds': 600,
    'wrapper_file': Path(__file__).name, 'wrapper_sha256': h.digest_bytes(Path(__file__).read_bytes()),
    'override': 'Only subprocess.run timeout=300 for the claude invocation is changed to600; restored in finally. On-disk harness unchanged.',
    'command': 'python3 skills/funnel-truth-and-cost-per-stage/references/eval-v2-recover-transport.py --run'
})
h.atomic_write(output, json.dumps(metadata, indent=2, sort_keys=True)+'\n')
original_run = h.subprocess.run
count = 0
def extended_run(command, *args, **kwargs):
    global count
    if command[0] == 'claude' and kwargs.get('timeout') == 300:
        kwargs['timeout'] = 600
        count += 1
    return original_run(command, *args, **kwargs)
mono = time.monotonic()
try:
    h.subprocess.run = extended_run
    with tempfile.TemporaryDirectory(prefix='funnel-v2-transport-recovery-') as cwd:
        try:
            call = h.claude_call(model, condition, prompt, system, Path(cwd), group['output_schema'], bool(help_info['json_schema']))
        except Exception as exc:
            call = {'transport_exit_code': 1, 'stderr': f'{type(exc).__name__}: {exc}', 'raw_envelope': None, 'requested_model': model, 'model_options': failed['model_options']}
finally:
    h.subprocess.run = original_run
assert count == 1
assert h.subprocess.run is original_run
call.update(started_at=started, elapsed_seconds=round(time.monotonic()-mono,6), model_digest=None, prompt=prompt, system_prompt=system,
    system_prompt_sha256=failed['system_prompt_sha256'], schema_sha256=failed['schema_sha256'], harness_hash=h.harness_hash())
result = h.evaluate_call(call, model, group, prompt, failed['prompt_sha256'], failed['context_sha256'], cases_hash)
metadata['models'] = {model: {condition: {group_id: result}}}
metadata['finished_at'] = h.now()
metadata['recovery']['override_restored'] = True
assert h.digest_bytes(original_path.read_bytes()) == original_hash
h.atomic_write(output, json.dumps(metadata, indent=2, sort_keys=True)+'\n')
h.atomic_write(output.with_suffix('.md'), h.report(metadata))
print(f"Completed supplemental cell: {result['completion_status']}; errors={result['errors']}", flush=True)
