# Claude Code plugin for Codex

This package adds a local Codex plugin that lets Codex delegate work to Claude Code through the Claude CLI.

The plugin is implemented as a Codex skill plus a small runner script. That keeps the integration simple:

- Codex decides when a Claude pass is useful.
- The skill invokes `claude -p` with JSON output.
- Model selection is explicit: `opus`, `sonnet`, or `haiku`.

## Prerequisites

- Node.js >= 22
- [Claude Code CLI](https://docs.anthropic.com/en/docs/claude-code) installed and authenticated

## Install

1. Install Claude Code if needed:

```bash
npm install -g @anthropic-ai/claude-code
```

2. Authenticate once:

```bash
claude auth login
```

3. Clone this repo and install the plugin into your local Codex marketplace:

```bash
git clone https://github.com/andiradulescu/cc-plugin-codex.git
cd cc-plugin-codex
npm run install:local
```

This merges the plugin entry into `~/.agents/plugins/marketplace.json` and symlinks the plugin directory into `~/.codex/plugins/claude-code`. Running it again is safe (idempotent).

To copy files instead of symlinking:

```bash
npm run install:local -- --mode copy
```

To preview what would happen without writing anything:

```bash
npm run install:local -- --dry-run
```

4. Restart Codex. The "Claude Code" plugin should appear in your plugin list.

## What is included

- A local Codex marketplace at [`.agents/plugins/marketplace.json`](./.agents/plugins/marketplace.json)
- A plugin at [`plugins/claude-code`](./plugins/claude-code)
- A skill that teaches Codex when and how to call Claude Code
- A helper script that handles `claude` availability, auth checks, model selection, and JSON output parsing

## Claude Code integration surface

The runner uses the current Claude Code CLI flow documented on March 31, 2026:

- `claude -p`
- `--model`
- `--output-format json`
- `--continue` / `--resume`
- `claude auth status`

Source: https://code.claude.com/docs/llms.txt

## Test

```bash
npm test
```
