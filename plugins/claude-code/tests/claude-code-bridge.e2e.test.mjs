import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const pluginRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const bridge = path.join(pluginRoot, "skills/claude-code-bridge/scripts/claude-code-bridge.mjs");

test("bridge uses host Claude Code authentication", () => {
  const env = {
    ...process.env
  };
  delete env.CODEX_SANDBOX;
  delete env.CODEX_SANDBOX_NETWORK_DISABLED;

  const result = spawnSync(
    process.execPath,
    [
      bridge,
      "run",
      "--model",
      "haiku",
      "--cwd",
      pluginRoot,
      "--prompt",
      "Reply with exactly: hello",
      "--json"
    ],
    {
      cwd: pluginRoot,
      env,
      encoding: "utf8"
    }
  );

  assert.equal(result.error, undefined, result.error?.message);
  assert.equal(result.status, 0, result.stderr || result.stdout);

  const payload = JSON.parse(result.stdout);
  assert.equal(payload.ok, true);
  assert.equal(payload.model, "haiku");
  assert.equal(payload.result, "hello");
});
