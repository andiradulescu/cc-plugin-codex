# Claude Code plugin for Codex

This package adds a local Codex plugin that lets Codex delegate work to Claude Code through the Claude CLI.

The plugin is implemented as a Codex skill plus a small runner script. That keeps the integration simple:

- Codex decides when a Claude pass is useful.
- The skill invokes `claude -p` with JSON output.
- Model selection is explicit: `fable`, `opus`, `sonnet`, or `haiku`.

## Prerequisites

- Node.js >= 22
- [Claude Code CLI](https://code.claude.com/docs/en/overview) installed and authenticated
- Claude Code >= 2.1.170 to use Claude Fable 5

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

4. Activate the plugin in Codex:

- **Codex app**: go to **Plugins > Local Plugins** and activate "Claude Code"

<img width="720" alt="Codex app Claude Code plugin install" src="https://github.com/user-attachments/assets/67a64a45-1dd3-4028-bb00-64bc8800bb91" />

<img width="720" alt="Codex app Claude Code plugin use" src="https://github.com/user-attachments/assets/28cc722f-09d8-424b-ae2f-7c6bbd6a557b" />

- **Codex CLI**: type `/plugins`, select **Claude Code**, then **Install plugin**

<img width="720" alt="Codex CLI Claude Code plugin install" src="https://github.com/user-attachments/assets/6611b83b-19c5-4760-b569-c6bf2dee106e" />

<img width="720" alt="Codex CLI Claude Code plugin use" src="https://github.com/user-attachments/assets/d69a15cf-24b1-47ab-b562-23a7b24ec904" />

## What is included

- A local Codex marketplace at [`.agents/plugins/marketplace.json`](./.agents/plugins/marketplace.json)
- A plugin at [`plugins/claude-code`](./plugins/claude-code)
- A skill that teaches Codex when and how to call Claude Code
- A helper script that handles `claude` availability, auth checks, model selection, and JSON output parsing

## Claude Fable 5

Select Fable explicitly with `--model fable` for complex, long-running work. The bridge also accepts Fable's `xhigh` effort level:

```bash
node plugins/claude-code/skills/claude-code-bridge/scripts/claude-code-bridge.mjs run \
  --model fable \
  --effort xhigh \
  --prompt "Investigate and fix this complex failure" \
  --json
```

Fable requires 30-day data retention and is unavailable under zero data retention. Its safety classifiers can automatically fall back to Opus 4.8 for cybersecurity and biology requests.

## Claude Code integration surface

The runner uses the current Claude Code CLI flow documented on July 12, 2026:

- `claude -p`
- `--model fable`
- `--effort xhigh`
- `--output-format json`
- `--continue` / `--resume`
- `claude auth status`

Sources:

- https://code.claude.com/docs/en/model-config
- https://code.claude.com/docs/en/cli-usage

## Test

```bash
npm test
```
