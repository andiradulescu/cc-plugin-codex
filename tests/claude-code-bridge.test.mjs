import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";
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

// All fake CLIs and fixture files live under one root that is removed after the file's tests.
const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "claude-bridge-test-"));
test.after(() => fs.rmSync(tempRoot, { recursive: true, force: true }));

function createTempDir() {
  return fs.mkdtempSync(path.join(tempRoot, "case-"));
}

function createFakeClaude(source) {
  const dir = createTempDir();
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

test("bridge accepts fractional-second timeouts", () => {
  const cli = createFakeClaude(`process.stdout.write(JSON.stringify({ result: "Done" }));`);
  const result = runBridge(["run", "--prompt", "hello", "--timeout", "1.001", "--json"], cli);

  assert.equal(result.status, 0, result.stderr);
  assert.equal(JSON.parse(result.stdout).result, "Done");
});

test("bridge keeps sub-millisecond timeouts positive", () => {
  const cli = createFakeClaude("setTimeout(() => {}, 10000);");
  const result = runBridge(["run", "--prompt", "hello", "--timeout", "0.0001"], cli);

  assert.equal(result.status, 1);
  assert.match(result.stderr, /timed out after 0\.0001s/);
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

test("bridge returns complete large JSON errors through a pipe", () => {
  const cli = createFakeClaude(`
require("node:fs").readFileSync(0, "utf8");
process.stdout.write(JSON.stringify({
  is_error: true,
  subtype: "error_during_execution",
  session_id: "large-error-session",
  errors: ["x".repeat(256 * 1024)]
}));
process.exitCode = 1;
`);
  const result = runBridge(["run", "--prompt", "hello", "--json"], cli);

  assert.equal(result.status, 1);
  assert.equal(result.stderr, "");
  const payload = JSON.parse(result.stdout);
  assert.equal(payload.ok, false);
  assert.equal(payload.sessionId, "large-error-session");
  assert.equal(payload.error.code, "error_during_execution");
  assert.equal(payload.error.message, "x".repeat(256 * 1024));
  assert.deepEqual(payload.raw.errors, [payload.error.message]);
});

test("bridge returns complete large errors on stderr in text mode", () => {
  const message = "x".repeat(256 * 1024);
  const cli = createFakeClaude(`
require("node:fs").readFileSync(0, "utf8");
process.stdout.write(JSON.stringify({ is_error: true, session_id: "large-text-error", errors: [${JSON.stringify(message)}] }));
process.exitCode = 1;
`);
  const result = runBridge(["run", "--prompt", "hello"], cli);

  assert.equal(result.status, 1);
  assert.equal(result.stderr, `${message}\nSession ID: large-text-error\n`);
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

test("bridge preserves early Claude diagnostics with a large prompt file", () => {
  const cli = createFakeClaude(`
const fs = require("node:fs");
fs.writeSync(2, "invalid permission mode");
fs.closeSync(0);
process.exit(3);
`);
  const promptFile = path.join(path.dirname(cli), "prompt.txt");
  fs.writeFileSync(promptFile, "x".repeat(2 * 1024 * 1024));
  const result = runBridge(["run", "--prompt-file", promptFile, "--json"], cli);

  assert.equal(result.status, 1);
  assert.match(result.stderr, /exited with status [1-9]/);
  assert.match(result.stderr, /invalid permission mode/);
  assert.doesNotMatch(result.stderr, /EPIPE/);
});

test("bridge preserves early JSON errors with a large prompt file", () => {
  const cli = createFakeClaude(`
const fs = require("node:fs");
fs.writeSync(1, ${JSON.stringify(maxTurnsOutput)});
fs.closeSync(0);
process.exit(1);
`);
  const promptFile = path.join(path.dirname(cli), "prompt.txt");
  fs.writeFileSync(promptFile, "x".repeat(2 * 1024 * 1024));
  const result = runBridge(["run", "--prompt-file", promptFile, "--json"], cli);

  assert.equal(result.status, 1);
  assert.equal(result.stderr, "");
  const payload = JSON.parse(result.stdout);
  assert.equal(payload.ok, false);
  assert.equal(payload.sessionId, "43f7a822");
  assert.equal(payload.error.code, "error_max_turns");
  assert.equal(payload.error.message, "Reached maximum number of turns (1)");
});

test("bridge reports a broken pipe when Claude returns no diagnostic", () => {
  const cli = createFakeClaude(`require("node:fs").closeSync(0); process.exit(1);`);
  const promptFile = path.join(path.dirname(cli), "prompt.txt");
  fs.writeFileSync(promptFile, "x".repeat(2 * 1024 * 1024));
  const result = runBridge(["run", "--prompt-file", promptFile, "--json"], cli);

  assert.equal(result.status, 1);
  assert.equal(result.stdout, "");
  assert.match(result.stderr, /EPIPE/);
});

test("bridge preserves errors when Claude cannot start", () => {
  const result = runBridge(["run", "--prompt", "hello", "--json"], "/path/that/does/not/exist");

  assert.equal(result.status, 1);
  assert.equal(result.stdout, "");
  assert.match(result.stderr, /ENOENT/);
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
  const promptFile = path.join(createTempDir(), "prompt.txt");
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

test("bridge help lists every run flag", () => {
  const result = spawnSync(process.execPath, [bridge, "--help"], { encoding: "utf8" });

  assert.equal(result.status, 0);
  for (const flag of ["--timeout", "--append-system-prompt-file", "--system-prompt-file", "--json-schema-file"]) {
    assert.match(result.stdout, new RegExp(`${flag} <`), flag);
  }
});

test("bridge forwards system prompt and JSON schema files to Claude", () => {
  const cli = createFakeClaude(echoPromptSource);
  const dir = createTempDir();
  const appendFile = path.join(dir, "append.md");
  const systemFile = path.join(dir, "system.md");
  const schemaFile = path.join(dir, "schema.json");
  const schema = JSON.stringify({ type: "object", properties: { ok: { type: "boolean" } } });
  fs.writeFileSync(appendFile, "extra");
  fs.writeFileSync(systemFile, "system");
  fs.writeFileSync(schemaFile, schema);

  const result = runBridge(
    [
      "run", "--prompt", "hello", "--json",
      "--append-system-prompt-file", appendFile,
      "--system-prompt-file", systemFile,
      "--json-schema-file", schemaFile
    ],
    cli
  );

  assert.equal(result.status, 0, result.stderr);
  const { argv } = JSON.parse(result.stdout).raw;
  assert.equal(argv[argv.indexOf("--append-system-prompt-file") + 1], appendFile);
  assert.equal(argv[argv.indexOf("--system-prompt-file") + 1], systemFile);
  assert.equal(argv[argv.indexOf("--json-schema") + 1], schema);
});

test("bridge setup returns a complete JSON report with large auth output", () => {
  const authOutput = "y".repeat(256 * 1024);
  const cli = createFakeClaude(`
if (process.argv[2] === "--version") {
  process.stdout.write("2.1.308 (Claude Code)");
} else {
  process.stderr.write(${JSON.stringify(authOutput)});
  process.exitCode = 1;
}
`);
  const result = runBridge(["setup", "--json"], cli);

  assert.equal(result.status, 1);
  const report = JSON.parse(result.stdout);
  assert.equal(report.ready, false);
  assert.equal(report.cli.available, true);
  assert.equal(report.auth.authenticated, false);
  assert.equal(report.auth.stderr, authOutput);
});

test("bridge does not read stdin when --prompt is given", async () => {
  const cli = createFakeClaude(echoPromptSource);
  const hostEnv = { ...process.env, CLAUDE_CODE_CLI: cli };
  delete hostEnv.CODEX_SANDBOX;
  // stdin stays open and is never written to, like an idle pipe or socket from the caller.
  const child = spawn(process.execPath, [bridge, "run", "--prompt", "hello", "--json"], {
    cwd: repoRoot,
    env: hostEnv,
    stdio: ["pipe", "pipe", "pipe"]
  });
  let stdout = "";
  let stderr = "";
  child.stdout.on("data", (chunk) => (stdout += chunk));
  child.stderr.on("data", (chunk) => (stderr += chunk));

  const status = await new Promise((resolve) => {
    const timer = setTimeout(() => {
      child.kill();
      resolve("blocked on stdin");
    }, 5000);
    child.on("exit", (code) => {
      clearTimeout(timer);
      resolve(code);
    });
  });
  child.stdin.destroy();

  assert.equal(status, 0, stderr);
  assert.equal(JSON.parse(stdout).result, "hello");
});

test("bridge reads the prompt from stdin when no prompt flag is given", () => {
  const cli = createFakeClaude(echoPromptSource);
  const hostEnv = { ...process.env, CLAUDE_CODE_CLI: cli };
  delete hostEnv.CODEX_SANDBOX;
  const result = spawnSync(process.execPath, [bridge, "run", "--json"], {
    cwd: repoRoot,
    env: hostEnv,
    input: "piped prompt",
    encoding: "utf8"
  });

  assert.equal(result.status, 0, result.stderr);
  assert.equal(JSON.parse(result.stdout).result, "piped prompt");
});

test("bridge rejects an empty prompt file without running Claude", () => {
  const cli = createFakeClaude(`require("node:fs").writeFileSync(${JSON.stringify(path.join(tempRoot, "claude-ran"))}, "");`);
  const promptFile = path.join(createTempDir(), "prompt.txt");
  fs.writeFileSync(promptFile, "");
  const result = runBridge(["run", "--prompt-file", promptFile, "--json"], cli);

  assert.equal(result.status, 1);
  assert.match(result.stderr, /Prompt file is empty/);
  assert.equal(fs.existsSync(path.join(tempRoot, "claude-ran")), false);
});

test("bridge rejects unknown run options instead of ignoring them", () => {
  const cli = createFakeClaude(echoPromptSource);

  for (const [flag, value] of [["--timout", "5"], ["--modle", "opus"], ["--json-schema", "schema.json"]]) {
    const result = runBridge(["run", "--prompt", "hello", flag, value, "--json"], cli);
    assert.equal(result.status, 1, flag);
    assert.equal(result.stdout, "", flag);
    assert.match(result.stderr, new RegExp(`Unknown option ${flag} for run`), flag);
  }
});

test("bridge rejects unknown setup options", () => {
  const result = runBridge(["setup", "--model", "opus"], "/path/that/does/not/exist");

  assert.equal(result.status, 1);
  assert.match(result.stderr, /Unknown option --model for setup/);
});

test("bridge rejects unexpected positional arguments", () => {
  const result = runBridge(["run", "--prompt", "hello", "extra"], createFakeClaude(echoPromptSource));

  assert.equal(result.status, 1);
  assert.match(result.stderr, /Unexpected argument: extra/);
});

test("bridge rejects an option whose value is another option", () => {
  const result = runBridge(["run", "--prompt", "hello", "--model", "--json"], createFakeClaude(echoPromptSource));

  assert.equal(result.status, 1);
  assert.equal(result.stdout, "");
  assert.match(result.stderr, /Missing value for --model/);
});

test("bridge allows a prompt that starts with dashes", () => {
  const result = runBridge(["run", "--prompt", "--force is ignored by the CLI", "--json"], createFakeClaude(echoPromptSource));

  assert.equal(result.status, 0, result.stderr);
  assert.equal(JSON.parse(result.stdout).result, "--force is ignored by the CLI");
});

test("bridge rejects an unknown command", () => {
  const result = runBridge(["bogus", "--json"], "/path/that/does/not/exist");

  assert.equal(result.status, 1);
  assert.match(result.stderr, /Unknown command: bogus/);
});

test("bridge help says file options resolve from the launch directory", () => {
  const result = spawnSync(process.execPath, [bridge, "--help"], { encoding: "utf8" });

  assert.match(result.stdout, /not from --cwd/);
});

test("bridge setup honors --timeout", () => {
  const cli = createFakeClaude("setTimeout(() => {}, 10000);");
  const started = Date.now();
  const json = runBridge(["setup", "--timeout", "0.3", "--json"], cli);

  assert.ok(Date.now() - started < 5000, "setup should not wait for hung commands");
  assert.equal(json.status, 1);
  assert.match(JSON.parse(json.stdout).cli.error, /timed out after 300ms/);

  const text = runBridge(["setup", "--timeout", "0.3"], cli);
  assert.equal(text.status, 1);
  assert.match(text.stdout, /Error: claude --version timed out after 300ms/);
  assert.doesNotMatch(text.stdout, /Install Claude Code/);
});
