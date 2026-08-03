import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const pluginRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const bridge = path.join(pluginRoot, "skills/claude-code-bridge/scripts/claude-code-bridge.mjs");

test("bridge setup and run require host execution in the Codex sandbox", () => {
  const env = {
    ...process.env,
    CLAUDE_CODE_CLI: "/path/that/does/not/exist",
    CODEX_SANDBOX: "seatbelt"
  };

  const commands = [
    ["setup", "--json"],
    ["run", "--prompt", "hello", "--json"]
  ];

  for (const command of commands) {
    const result = spawnSync(process.execPath, [bridge, ...command], {
      cwd: pluginRoot,
      env,
      encoding: "utf8"
    });

    assert.equal(result.status, 1, `${command[0]} should fail with status 1`);
    assert.equal(result.stderr, "", `${command[0]} should return a JSON error without stderr`);

    const payload = JSON.parse(result.stdout);
    assert.equal(payload.requiresHostExecution, true);
    assert.equal(payload.error.code, "host_execution_required");
  }
});
