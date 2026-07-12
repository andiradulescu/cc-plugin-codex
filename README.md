# Claude Code plugin for Codex

This package adds a local Codex plugin that lets Codex delegate work to Claude Code through the Claude CLI.

The plugin is implemented as a Codex skill plus a small runner script. That keeps the integration simple:

- Codex decides when a Claude pass is useful.
- The skill invokes `claude -p` with JSON output.
- Model selection is explicit: `fable`, `opus`, `sonnet`, or `haiku`.

## Prerequisites

- Node.js >= 22
- Codex CLI, the ChatGPT desktop app, or the Codex IDE extension with plugin support
- [Claude Code CLI](https://code.claude.com/docs/en/overview) installed and authenticated
- Claude Code >= 2.1.170 to use Claude Fable 5

## Install

### Set up Claude Code

Install Claude Code if needed:

```bash
npm install -g @anthropic-ai/claude-code
```

Authenticate once:

```bash
claude auth login
```

### Add the plugin marketplace

Add this repository as a Codex marketplace:

```bash
codex plugin marketplace add andiradulescu/cc-plugin-codex --ref main
```

The marketplace name is `local-plugins`.

### Codex CLI

Install the plugin directly:

```bash
codex plugin add claude-code@local-plugins
```

Alternatively, start Codex, type `/plugins`, choose the **Local Plugins** marketplace, and install **Claude Code**. Start a new Codex session after installation so the bundled skill becomes available.

### ChatGPT desktop app

Add the marketplace with the Codex command above, or follow the local development steps below to register a personal marketplace. Then:

1. Restart the ChatGPT desktop app.
2. Open **Plugins** in the ChatGPT desktop app.
3. Choose the **Local Plugins** marketplace and install **Claude Code**.
4. Start a new task after installation.

The plugin directory is available from Work and Codex, but this plugin launches the machine-local Claude Code CLI. Use it from a Codex environment that has access to the local `claude` executable and authenticated session.

### Codex IDE extension

Open **Settings > Plugins**, choose the **Local Plugins** marketplace, and install **Claude Code** for the connected Codex host. Start a new chat after installation.

### Local development

Clone the repository and register its marketplace as a personal local source:

```bash
git clone https://github.com/andiradulescu/cc-plugin-codex.git
cd cc-plugin-codex
npm run install:local
```

The helper merges the plugin entry into `~/.agents/plugins/marketplace.json` and symlinks the plugin directory into `~/.codex/plugins/claude-code`. It registers the marketplace source but does not install or enable the plugin. Finish with `codex plugin add claude-code@local-plugins` or install it from the desktop plugin directory.

The ChatGPT desktop app installs a cached copy of a local plugin instead of loading directly from the marketplace source. Restart the app after changing the plugin so it refreshes the installed copy.

To copy files, which matches OpenAI's documented manual local-install layout, instead of symlinking:

```bash
npm run install:local -- --mode copy
```

To preview what would happen without writing anything:

```bash
npm run install:local -- --dry-run
```

### Surface limits

ChatGPT Work on the web can install published or curated plugins, but OpenAI documents local filesystem marketplaces for the ChatGPT desktop app. This repository is a skill-only plugin with a local CLI runner, not an Apps SDK app, and does not use ChatGPT developer mode or an HTTPS MCP endpoint.

OpenAI references:

- [Use and install plugins](https://developers.openai.com/codex/plugins)
- [Build and install local plugins](https://developers.openai.com/codex/plugins/build)
- [Codex plugin commands](https://developers.openai.com/codex/developer-commands#codex-plugin)
- [Connect an Apps SDK app](https://developers.openai.com/apps-sdk/deploy/connect-chatgpt)

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
