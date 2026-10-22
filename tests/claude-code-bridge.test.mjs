import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const bridge = path.join(repoRoot, "plugins/claude-code/skills/claude-code-bridge/scripts/claude-code-bridge.mjs");
const env = {
  ...process.env,
  CLAUDE_CODE_CLI: "/path/that/does/not/exist",
  CODEX_SANDBOX: "seatbelt"
};

test("bridge requires host execution for sandboxed setup and run", () => {
  const jsonCommands = [
    ["setup", "--json"],
    ["run", "--prompt", "hello", "--json"]
  ];

  for (const command of jsonCommands) {
    const result = spawnSync(process.execPath, [bridge, ...command], {
      cwd: repoRoot,
      env,
      encoding: "utf8"
    });

    assert.equal(result.status, 1, `${command[0]} should fail with status 1`);
    assert.equal(result.stderr, "", `${command[0]} should return a JSON error without stderr`);

    const payload = JSON.parse(result.stdout);
    assert.equal(payload.requiresHostExecution, true);
    assert.equal(payload.error.code, "host_execution_required");
  }

  const result = spawnSync(process.execPath, [bridge, "setup"], {
    cwd: repoRoot,
    env,
    encoding: "utf8"
  });

  assert.equal(result.status, 1);
  assert.equal(result.stderr, "");
  assert.match(result.stdout, /must run outside the Codex sandbox/);
});

function createFakeClaude(source) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "fake-claude-"));
  const cli = path.join(dir, "claude");
  fs.writeFileSync(cli, `#!/usr/bin/env node\n${source}\n`, { mode: 0o755 });
  return cli;
}

function runBridge(args, cli) {
  const hostEnv = { ...process.env, CLAUDE_CODE_CLI: cli };
  delete hostEnv.CODEX_SANDBOX;
  return spawnSync(process.execPath, [bridge, ...args], {
    cwd: repoRoot,
    env: hostEnv,
    encoding: "utf8"
  });
}

test("bridge stops a Claude run that exceeds --timeout", () => {
  const cli = createFakeClaude("setTimeout(() => {}, 10000);");
  const started = Date.now();
  const result = runBridge(["run", "--prompt", "hello", "--timeout", "0.5"], cli);

  assert.equal(result.status, 1);
  assert.match(result.stderr, /timed out after 0\.5s/);
  assert.ok(Date.now() - started < 5000, "bridge should not wait for the full child run");
});

test("bridge rejects an invalid --timeout", () => {
  const cli = createFakeClaude("process.exit(0);");
  const result = runBridge(["run", "--prompt", "hello", "--timeout", "soon"], cli);

  assert.equal(result.status, 1);
  assert.match(result.stderr, /positive number of seconds/);
});
