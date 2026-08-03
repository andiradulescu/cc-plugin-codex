# Claude Code Codex Plugin

This plugin lets Codex call the local Claude Code CLI for focused delegation.

It intentionally uses the CLI, not a remote connector:

- easier local setup
- direct access to `fable`, `opus`, `sonnet`, and `haiku`
- predictable behavior from the current Claude Code docs

Claude Fable 5 requires Claude Code 2.1.170 or later and 30-day data retention. Select it explicitly with `--model fable`.

The main entrypoint is the skill at [`skills/claude-code-bridge/SKILL.md`](./skills/claude-code-bridge/SKILL.md).

## Sandbox boundary

Run the bridge with scoped host execution from Codex or the ChatGPT desktop app. Claude Code stores host authentication in platform credential storage, including the macOS Keychain, which the outer Codex sandbox cannot access.

The bridge detects `CODEX_SANDBOX` and returns `requiresHostExecution: true` with error code `host_execution_required` instead of misreporting the host as logged out. Rerun that exact bridge command with scoped sandbox escalation. Do not enable full access or copy Claude credentials into the sandbox.

The bridge still enables Claude Code's own sandbox and prevents Claude from disabling it for delegated commands.

## Tests

Run the unit and integration tests inside the project sandbox:

```bash
node --test tests/claude-cli.unit.test.mjs tests/claude-code-bridge.integration.test.mjs
```

Run the end-to-end test outside the Codex sandbox. It uses the authenticated host Claude Code installation and makes a real Haiku request:

```bash
node --test tests/claude-code-bridge.e2e.test.mjs
```
