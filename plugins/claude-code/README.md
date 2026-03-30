# Claude Code Codex Plugin

This plugin lets Codex call the local Claude Code CLI for focused delegation.

It intentionally uses the CLI, not a remote connector:

- easier local setup
- direct access to `opus`, `sonnet`, and `haiku`
- predictable behavior from the current Claude Code docs

The main entrypoint is the skill at [`skills/claude-code-bridge/SKILL.md`](./skills/claude-code-bridge/SKILL.md).
