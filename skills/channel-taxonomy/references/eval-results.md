# Channel taxonomy model evaluation

Superseded for manifest `1be1b437` by [eval-results-v2.md](eval-results-v2.md). This page retains the historical v1 matrix on manifest `5ef36ee675677b9f546a2cbc732fa82fc9e8b8b0c8e44aa9ad8d45608a2a9d27` unchanged.

Run window: 2026-09-08T21:10:46.397458+00:00 to 2026-09-08T21:23:41.334991+00:00
Current cases SHA-256: `5ef36ee675677b9f546a2cbc732fa82fc9e8b8b0c8e44aa9ad8d45608a2a9d27`
Initial-format raw checkpoint: `eval-results-initial-format.json` (initial cases SHA-256 `4ee042c6e3bc28e825aabf6593d163a91b29443889973affd0995521dc770004`).

This report uses three fixed prompts, eight independent synthetic cases per prompt, with seven contract invariants scored for the interoperability prompt, and expected answers kept outside the model context. `with-skill` injects only the skill and its two reference documents; `without-skill` uses an isolated temporary working directory, safe mode, no automatic skills, no tools, and an empty MCP configuration.
The current group 3 scores were rerun after making its output types explicit and tightening the rubric to require explicit unknown/mixed revenue status and explicit mixed-currency NULL handling. Classification groups remain from the initial-format run unchanged.

## Before/after scores

| Model | Group | Without skill | With skill | Delta |
| --- | --- | ---: | ---: | ---: |
| claude-fable-5-1 | conflicting-acquisition-evidence | 0.273 | 1.000 | +0.727 |
| claude-fable-5-1 | native-shopify-network-normalization | 0.545 | 1.000 | +0.455 |
| claude-fable-5-1 | cross-source-interoperability | 0.714 | 1.000 | +0.286 |
| claude-sonnet-5 | conflicting-acquisition-evidence | 0.818 | 1.000 | +0.182 |
| claude-sonnet-5 | native-shopify-network-normalization | 0.727 | 1.000 | +0.273 |
| claude-sonnet-5 | cross-source-interoperability | 0.571 | 1.000 | +0.429 |
| qwen3:4b | conflicting-acquisition-evidence | 0.000 | 0.000 | +0.000 |
| qwen3:4b | native-shopify-network-normalization | 0.000 | 0.000 | +0.000 |
| qwen3:4b | cross-source-interoperability | 0.000 | 0.000 | +0.000 |

## Reproduction details

Claude CLI: `2.1.263 (Claude Code)`. Claude model IDs requested: `claude-fable-5-1, claude-sonnet-5`. Open-weight model requested: `qwen3:4b` via `http://127.0.0.1:11435/api/chat`.
Claude calls use `CLAUDE_CODE_SIMPLE_SYSTEM_PROMPT=1 claude --safe-mode --no-session-persistence --disable-slash-commands --tools '' --strict-mcp-config --mcp-config '{"mcpServers":{}}'`; this disables customizations and tools while retaining the authenticated OAuth path. All calls use `--output-format json --max-budget-usd 2`. Qwen uses `stream:false`, `think:false`, `num_ctx:16384`, `num_predict:2000`, and `temperature:0`. The full prompts, raw responses, parsed outputs, item scores, model metadata, and errors are in `eval-results.json`.

Skill context SHA-256:
- `SKILL.md`: `2c075029304a26e572a1e0f98624ee812c2588d191eb4cfd44331848acd03f7c`
- `references/channel-contract.md`: `d5e3153cd02bde5662b8e37c8c2fcd320664df39781224e75e59edca8f4dd824`
- `references/source-mappings.md`: `a40a6162f9b0d8eac5cdb7d9f80098d74005910953f9c15673c42ffb2a4058c6`

## Response validity

| Model | Condition | Calls | Transport success | Parsed JSON | Completed output |
| --- | --- | ---: | ---: | ---: | ---: |
| claude-fable-5-1 | with-skill | 3 | 3 | 3 | 3 |
| claude-fable-5-1 | without-skill | 3 | 3 | 3 | 3 |
| claude-sonnet-5 | with-skill | 3 | 3 | 3 | 3 |
| claude-sonnet-5 | without-skill | 3 | 3 | 3 | 3 |
| qwen3:4b | with-skill | 3 | 3 | 3 | 0 |
| qwen3:4b | without-skill | 3 | 3 | 3 | 0 |

A parsed fragment from a response whose generation ended with Qwen `done_reason=length` is retained for audit but counted as an output-format/truncation failure in the validity table; its score is not evidence of classification knowledge. No credentials, client IDs, or private customer data are included; all inputs are synthetic. Scores are rubric results, and a zero delta is a valid outcome.
