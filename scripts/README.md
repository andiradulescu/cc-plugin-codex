# Scripts

- `install-local.mjs`: merges `claude-code` into `~/.agents/plugins/marketplace.json` by plugin name and points it at `./.codex/plugins/claude-code`, then installs the plugin to `~/.codex/plugins/claude-code`; default mode uses symlinks, and `--mode copy` copies files instead.
