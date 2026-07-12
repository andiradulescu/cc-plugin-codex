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

- `fable`: use Claude Fable 5 for complex, long-running work that benefits from sustained autonomous investigation and verification.
- `sonnet`: default for normal implementation, review, and debugging work.
- `opus`: use for harder architectural reasoning, deeper debugging, or pressure-testing a design.
- `haiku`: use for quick lightweight passes, short summaries, and cheap sanity checks.

## Runtime

Use the plugin-local helper:

```bash
node <path-to-skill>/scripts/claude-code-bridge.mjs setup --json
```

Then run Claude Code:

Use `--model fable` when the user requests Claude Fable 5.

```bash
node <path-to-skill>/scripts/claude-code-bridge.mjs run \
  --model sonnet \
  --cwd /absolute/worktree/path \
  --prompt-file /absolute/path/to/prompt.txt \
  --json
```

## Prompting rules

- Keep prompts concrete and task-shaped.
- Include the exact repository or working directory via `--cwd`.
- Tell Claude Code whether the task is read-only analysis or it may edit files.
- For review tasks, ask for findings ordered by severity and request missing-test coverage.
- For large prompts, write them to a temp file and use `--prompt-file`.

## Session reuse

- Use `--resume <session-id>` to continue a specific prior Claude Code run.
- Use `--continue` to continue the latest Claude Code session in the same working directory.

## Output handling

- Prefer `--json` so Codex gets parsed `result`, `sessionId`, and optional `structuredOutput`.
- If Claude Code returns actionable findings, summarize them before proceeding.
- If Claude Code edits files, inspect the diff before accepting the result.

## Failure handling

- If `setup` reports Claude Code missing, tell the user to install `@anthropic-ai/claude-code`.
- If `setup` reports unauthenticated, tell the user to run `claude auth login`.
- If the command fails because bypass permissions were never accepted, ask the user to run:
  - `claude --permission-mode bypassPermissions`

## Examples

- "Use Claude Code Opus to challenge this database migration plan."
- "Ask Claude Code Sonnet to review the current diff for regressions."
- "Use Claude Code Haiku to summarize the likely cause of this test failure."
