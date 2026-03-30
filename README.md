# Claude Code plugin for Codex

This package adds a local Codex plugin that lets Codex delegate work to Claude Code through the Claude CLI.

The plugin is implemented as a Codex skill plus a small runner script. That keeps the integration simple:

- Codex decides when a Claude pass is useful.
- The skill invokes `claude -p` in `--bare` mode.
- Model selection is explicit: `opus`, `sonnet`, or `haiku`.

## What is included

- A local Codex marketplace at [`.agents/plugins/marketplace.json`](./.agents/plugins/marketplace.json)
- A plugin at [`plugins/claude-code`](./plugins/claude-code)
- A skill that teaches Codex when and how to call Claude Code
- A helper script that handles `claude` availability, auth checks, model selection, and JSON output parsing

## Claude Code integration surface

The runner uses the current Claude Code CLI flow documented on March 31, 2026:

- `claude -p`
- `--bare`
- `--model`
- `--output-format json`
- `--continue` / `--resume`
- `claude auth status`

Source: https://code.claude.com/docs/llms.txt

## Local setup

1. Install Claude Code if needed:

```bash
npm install -g @anthropic-ai/claude-code
```

2. Authenticate once:

```bash
claude auth login
```

3. Accept non-interactive permissions once:

```bash
claude --permission-mode bypassPermissions
```

4. Point Codex at this marketplace and install the `claude-code` plugin from it.

## Test

```bash
npm test
```
