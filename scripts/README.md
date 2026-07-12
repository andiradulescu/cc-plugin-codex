# Scripts

- `install-local.mjs`: registers `claude-code` in `~/.agents/plugins/marketplace.json` and places its source at `~/.codex/plugins/claude-code`; default mode uses a symlink, and `--mode copy` copies files instead. The script does not install or enable the plugin; use `codex plugin add claude-code@local-plugins` or the ChatGPT desktop plugin directory afterward.
