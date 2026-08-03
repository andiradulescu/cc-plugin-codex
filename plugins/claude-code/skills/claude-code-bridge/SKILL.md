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

- `fable`: use Claude Fable for complex, long-running work that benefits from sustained autonomous investigation and verification.
- `sonnet`: default for normal implementation, review, and debugging work.
- `opus`: use for harder architectural reasoning, deeper debugging, or pressure-testing a design.
- `haiku`: use for quick lightweight passes, short summaries, and cheap sanity checks.

## Fable requirements

- Claude Fable requires Claude Code 2.1.170 or later. If a Fable run fails, use `setup` to check the installed version; if it is older, tell the user to run `claude update`.
- Fable requires 30-day data retention and is unavailable under zero data retention.
- Cybersecurity and biology requests can trigger automatic safety fallback to Opus 4.8. Treat that fallback as expected Claude Code behavior.

## Runtime

Run Claude Code directly without a setup preflight.

```bash
node <path-to-skill>/scripts/claude-code-bridge.mjs run \
  --model sonnet \
  --cwd /absolute/worktree/path \
  --prompt "Review this change" \
  --json
```

Run `setup` only after a failed run to diagnose the Claude CLI version, installation, or authentication.

```bash
node <path-to-skill>/scripts/claude-code-bridge.mjs setup --json
```

## Prompting rules

- Keep prompts concrete and task-shaped.
- Include the exact repository or working directory via `--cwd`.
- Tell Claude Code whether the task is read-only analysis or it may edit files.
- For review tasks, ask for findings ordered by severity and request missing-test coverage.
- Use `--prompt` for short prompts.
- For large prompts, write them to a temp file and use `--prompt-file`.

## Session reuse

- Use `--resume <session-id>` to continue a specific prior Claude Code run.
- Use `--continue` to continue the latest Claude Code session in the same working directory.

## Output handling

- Prefer `--json` so Codex gets parsed `result`, `sessionId`, and optional `structuredOutput`.
- If Claude Code returns actionable findings, summarize them before proceeding.
- If Claude Code edits files, inspect the diff before accepting the result.

## Failure handling

- If a command returns `requiresHostExecution: true` with error code `host_execution_required`, rerun that exact command with scoped sandbox escalation.
- After the first host execution requirement, use scoped host execution directly for remaining bridge commands in the current turn.
- If scoped host execution is unavailable or denied, explain that the local Claude Code bridge cannot access host authentication from the current sandbox.
- If `setup` reports Claude Code missing, tell the user to install `@anthropic-ai/claude-code`.
- If `setup` reports unauthenticated after it ran outside the Codex sandbox, tell the user to run `claude auth login`.
- If the command fails because bypass permissions were never accepted, ask the user to run:
  - `claude --permission-mode bypassPermissions`

## Examples

- "Use Claude Fable to investigate and fix this complex cross-service failure."
- "Use Claude Code Opus to challenge this database migration plan."
- "Ask Claude Code Sonnet to review the current diff for regressions."
- "Use Claude Code Haiku to summarize the likely cause of this test failure."
