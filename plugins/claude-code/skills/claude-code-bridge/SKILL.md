---
name: claude-code-bridge
description: Use Claude Code from Codex when the user explicitly asks for Claude, Anthropic, Fable, Opus, Sonnet, Haiku, or a second opinion from Claude Code on coding work.
---

# Claude Code Bridge

Use this skill when the user wants work delegated to Claude Code instead of staying entirely inside Codex.

## When to use

- The user explicitly asks for Claude Code.
- The user asks for `Fable`, `Opus`, `Sonnet`, or `Haiku`.
- The user wants a second model pass on code review, architecture, debugging, or implementation.
- A focused external opinion is useful before making or validating changes.

## Model routing

- If the user names no model, omit `--model` so Claude Code uses the user's configured default (their `/model` choice, `ANTHROPIC_MODEL`, or the account default). The output then reports `model: "default"`; `modelsUsed` shows which model actually ran.
- `fable`: use Claude Fable for complex, long-running work that benefits from sustained autonomous investigation and verification.
- `sonnet`: use for normal implementation, review, and debugging work when the user asks for Sonnet.
- `opus`: use for harder architectural reasoning, deeper debugging, or pressure-testing a design.
- `haiku`: use for quick lightweight passes, short summaries, and cheap sanity checks.
- With `--permission-mode plan`, Claude Code runs the `haiku` alias on Sonnet. For a read-only Haiku pass, pass a full Haiku model ID such as `claude-haiku-5-5`.

## Fable requirements

- Claude Fable 5.1 requires Claude Code 2.1.257 or later; Fable 5 requires 2.1.170 or later. If a Fable run fails, use `setup` to check the installed version; if it is below the requested model's requirement, tell the user to run `claude update`.
- When the user requests Fable 5.1, use `--model claude-fable-5-1`. On Claude Code 2.1.257 or later, `fable` normally selects 5.1, but `ANTHROPIC_DEFAULT_FABLE_MODEL` can override it and Claude apps gateway sessions resolve it to Fable 5. On the Anthropic API, use `--model claude-fable-5` when the user requests Fable 5.
- Fable models require data retention by default. Check [model availability under ZDR](https://code.claude.com/docs/en/zero-data-retention#model-availability-under-zdr) for your organization's Covered Models policies.
- Cybersecurity and biology requests can trigger [automatic safety fallback](https://code.claude.com/docs/en/model-config#automatic-model-fallback) to an Opus model. Treat that fallback as expected Claude Code behavior.

## Runtime

Run Claude Code directly without a setup preflight.

```bash
node <path-to-skill>/scripts/claude-code-bridge.mjs run \
  --model sonnet \
  --cwd /absolute/worktree/path \
  --prompt "Review this change" \
  --json
```

Runs have no time limit by default. Pass `--timeout <seconds>` only when the user wants a bound; long Fable runs can legitimately take a long time.

Run `setup` only after a failed run to diagnose the Claude CLI version, installation, or authentication.

```bash
node <path-to-skill>/scripts/claude-code-bridge.mjs setup --json
```

`setup` also accepts `--timeout <seconds>` to bound the `claude --version` and `claude auth status` checks.

## Prompting rules

- Keep prompts concrete and task-shaped.
- Include the exact repository or working directory via `--cwd`.
- Tell Claude Code whether the task is read-only analysis or it may edit files.
- For review tasks, ask for findings ordered by severity and request missing-test coverage.
- Use `--prompt` for short prompts.
- For large prompts, write them to a temp file and use `--prompt-file`.
- Pass absolute paths to `--prompt-file` and the other file options. Relative paths resolve from the directory the bridge is launched in, not from `--cwd`.
- Use `--append-system-prompt-file <path>` to add instructions on top of Claude Code's default system prompt.
- Use `--system-prompt-file <path>` only when the default system prompt must be replaced entirely.
- Use `--json-schema-file <path>` when Codex needs machine-readable output; the result is returned as `structuredOutput`.

## Session reuse

- Use `--resume <session-id>` to continue a specific prior Claude Code run.
- Use `--continue` to continue the latest Claude Code session in the same working directory.

## Output handling

- Prefer `--json` so Codex gets parsed `result`, `sessionId`, and optional `structuredOutput`.
- A failed run with `--json` returns `ok: false` with `error.code` (for example `error_max_turns`), `error.message`, and `sessionId`. Use `--resume <sessionId>` to continue that run when it makes sense.
- `model` is the model you requested; `modelsUsed` lists the models Claude Code actually ran. If they differ from what the user asked for, tell the user.
- If Claude Code returns actionable findings, summarize them before proceeding.
- If Claude Code edits files, inspect the diff before accepting the result.

## Failure handling

- If a command returns `requiresHostExecution: true` with error code `host_execution_required`, rerun that exact command with scoped sandbox escalation.
- In the escalation request, state that the user asked to delegate this task to Claude Code, and that Claude Code reads files under `--cwd` and sends them to Anthropic.
- After the first host execution requirement, use scoped host execution directly for remaining bridge commands in the current turn.
- If scoped host execution is unavailable or denied, explain that the local Claude Code bridge cannot access host authentication from the current sandbox.
- If `setup` reports Claude Code missing, tell the user to install `@anthropic-ai/claude-code`.
- If `setup` reports unauthenticated after it ran outside the Codex sandbox, tell the user to run `claude auth login`.
- If the command fails because bypass permissions were never accepted, ask the user to run:
  - `claude --permission-mode bypassPermissions`

## Examples

- "Use Claude Fable 5.1 to investigate and fix this complex cross-service failure."
- "Use Claude Code Opus to challenge this database migration plan."
- "Ask Claude Code Sonnet to review the current diff for regressions."
- "Use Claude Code Haiku to summarize the likely cause of this test failure."
