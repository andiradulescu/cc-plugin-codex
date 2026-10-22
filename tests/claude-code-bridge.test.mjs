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
    encoding: "utf8",
    maxBuffer: Infinity
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

const maxTurnsOutput = JSON.stringify({
  type: "result",
  subtype: "error_max_turns",
  is_error: true,
  session_id: "43f7a822",
  errors: ["Reached maximum number of turns (1)"]
});

test("bridge returns Claude errors as JSON with the session id", () => {
  const cli = createFakeClaude(`process.stdout.write(${JSON.stringify(maxTurnsOutput)}); process.exit(1);`);
  const result = runBridge(["run", "--prompt", "hello", "--json"], cli);

  assert.equal(result.status, 1);
  assert.equal(result.stderr, "");

  const payload = JSON.parse(result.stdout);
  assert.equal(payload.ok, false);
  assert.equal(payload.sessionId, "43f7a822");
  assert.deepEqual(payload.error, {
    code: "error_max_turns",
    message: "Reached maximum number of turns (1)"
  });
});

test("bridge reports Claude errors with the session id in text mode", () => {
  const cli = createFakeClaude(`process.stdout.write(${JSON.stringify(maxTurnsOutput)}); process.exit(1);`);
  const result = runBridge(["run", "--prompt", "hello"], cli);

  assert.equal(result.status, 1);
  assert.match(result.stderr, /Reached maximum number of turns \(1\)/);
  assert.match(result.stderr, /Session ID: 43f7a822/);
});

test("bridge treats is_error output as a failure even with exit status 0", () => {
  const cli = createFakeClaude(`process.stdout.write(${JSON.stringify(maxTurnsOutput)});`);
  const result = runBridge(["run", "--prompt", "hello", "--json"], cli);

  assert.equal(result.status, 1);
  assert.equal(JSON.parse(result.stdout).ok, false);
});

test("bridge reports non-JSON Claude failures on stderr", () => {
  const cli = createFakeClaude(`process.stderr.write("boom"); process.exit(3);`);
  const result = runBridge(["run", "--prompt", "hello", "--json"], cli);

  assert.equal(result.status, 1);
  assert.match(result.stderr, /exited with status 3/);
  assert.match(result.stderr, /boom/);
});

test("bridge returns a successful Claude result", () => {
  const output = JSON.stringify({ type: "result", subtype: "success", is_error: false, result: "Done", session_id: "s1" });
  const cli = createFakeClaude(`process.stdout.write(${JSON.stringify(output)});`);
  const result = runBridge(["run", "--prompt", "hello", "--json"], cli);

  assert.equal(result.status, 0);
  const payload = JSON.parse(result.stdout);
  assert.equal(payload.ok, true);
  assert.equal(payload.result, "Done");
  assert.equal(payload.sessionId, "s1");
});

test("bridge reports invalid JSON from a successful Claude run", () => {
  const cli = createFakeClaude(`process.stdout.write("not json");`);
  const result = runBridge(["run", "--prompt", "hello", "--json"], cli);

  assert.equal(result.status, 1);
  assert.match(result.stderr, /returned invalid JSON/);
});

const echoPromptSource = `
const stdin = require("node:fs").readFileSync(0, "utf8");
process.stdout.write(JSON.stringify({ is_error: false, result: stdin, session_id: "echo", argv: process.argv.slice(2) }));
`;

test("bridge sends the prompt to Claude on stdin", () => {
  const cli = createFakeClaude(echoPromptSource);
  const result = runBridge(["run", "--prompt", "Review this patch", "--json"], cli);

  assert.equal(result.status, 0, result.stderr);
  const payload = JSON.parse(result.stdout);
  assert.equal(payload.result, "Review this patch");
  assert.equal(payload.raw.argv.includes("Review this patch"), false);
  assert.equal(payload.raw.argv[0], "--print");
});

test("bridge sends a large prompt file to Claude on stdin", () => {
  const cli = createFakeClaude(echoPromptSource);
  const promptFile = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "bridge-prompt-")), "prompt.txt");
  // Larger than the macOS 1 MiB ARG_MAX limit on argv.
  const prompt = "x".repeat(2 * 1024 * 1024);
  fs.writeFileSync(promptFile, prompt);

  const result = runBridge(["run", "--prompt-file", promptFile, "--json"], cli);

  assert.equal(result.status, 0, result.stderr);
  assert.equal(JSON.parse(result.stdout).result.length, prompt.length);
});

test("bridge reports the model Claude actually ran with", () => {
  const cli = createFakeClaude(echoPromptSource);

  for (const [args, expected] of [[[], "sonnet"], [["--model", " "], "sonnet"], [["--model", "opus"], "opus"]]) {
    const result = runBridge(["run", "--prompt", "hello", "--json", ...args], cli);
    assert.equal(result.status, 0, result.stderr);

    const payload = JSON.parse(result.stdout);
    assert.equal(payload.model, expected);
    assert.equal(payload.raw.argv[payload.raw.argv.indexOf("--model") + 1], expected);
  }
});

test("bridge setup only suggests steps that apply to the failure", () => {
  const result = runBridge(["setup"], "/path/that/does/not/exist");

  assert.equal(result.status, 1);
  assert.match(result.stdout, /Claude CLI available: no/);
  assert.match(result.stdout, /Install Claude Code/);
  assert.doesNotMatch(result.stdout, /bypassPermissions/);
});
