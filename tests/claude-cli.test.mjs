import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  buildClaudeArgs,
  buildClaudeError,
  buildHostExecutionRequirement,
  buildSetupReport,
  normalizeTimeoutSeconds,
  parseClaudeJson,
  readPrompt,
  renderRunText,
  resolveClaudeCli,
  resolveModel,
  runChecked,
  timeoutSecondsToMs
} from "../plugins/claude-code/skills/claude-code-bridge/scripts/lib/claude-cli.mjs";

test("buildHostExecutionRequirement identifies the Codex sandbox", () => {
  assert.deepEqual(buildHostExecutionRequirement({ env: {} }), {
    requiresHostExecution: false
  });

  const requirement = buildHostExecutionRequirement({
    env: {
      CODEX_SANDBOX: "seatbelt"
    }
  });

  assert.equal(requirement.requiresHostExecution, true);
  assert.equal(requirement.error.code, "host_execution_required");
  assert.match(requirement.error.message, /scoped sandbox escalation/);
});

test("resolveClaudeCli prefers an explicit bare executable name", () => {
  const command = resolveClaudeCli({
    env: {
      CLAUDE_CODE_CLI: "claude-beta"
    }
  });

  assert.equal(command, "claude-beta");
});

test("resolveClaudeCli rejects relative executable paths", () => {
  assert.throws(
    () =>
      resolveClaudeCli({
        env: {
          CLAUDE_CODE_CLI: "./claude"
        }
      }),
    /absolute path or a bare executable name/
  );
});

test("buildClaudeArgs adds the documented Claude Code flags", () => {
  const args = buildClaudeArgs({
    prompt: "Review this patch",
    model: "opus",
    effort: "high",
    continueLast: true,
    resume: "session-123"
  });

  assert.deepEqual(args.slice(0, 5), ["--print", "--output-format", "json", "--permission-mode", "acceptEdits"]);
  assert.equal(args.includes("Review this patch"), false, "prompt is passed on stdin, not argv");
  assert.match(args.join(" "), /acceptEdits/);
  assert.match(args.join(" "), /--model opus/);
  assert.match(args.join(" "), /--effort high/);
  assert.match(args.join(" "), /--continue/);
  assert.match(args.join(" "), /--resume session-123/);
});

test("buildClaudeArgs accepts xhigh effort for Claude Fable", () => {
  const args = buildClaudeArgs({
    prompt: "Investigate this complex failure",
    model: "fable",
    effort: "xhigh"
  });

  assert.match(args.join(" "), /--model fable/);
  assert.match(args.join(" "), /--effort xhigh/);
});

test("parseClaudeJson extracts result and session id", () => {
  const parsed = parseClaudeJson(
    JSON.stringify({
      result: "Done",
      session_id: "abc",
      structured_output: {
        ok: true
      }
    })
  );

  assert.equal(parsed.result, "Done");
  assert.equal(parsed.sessionId, "abc");
  assert.deepEqual(parsed.structuredOutput, { ok: true });
});

test("renderRunText prefers structured output when present", () => {
  const output = renderRunText(
    {
      sessionId: "abc",
      structuredOutput: {
        ok: true
      },
      result: ""
    },
    "haiku"
  );

  assert.match(output, /Claude Code model: haiku/);
  assert.match(output, /Session ID: abc/);
  assert.match(output, /Structured output:/);
});

test("buildSetupReport marks invalid explicit config as not ready", () => {
  const report = buildSetupReport({
    env: {
      CLAUDE_CODE_CLI: "./claude"
    }
  });

  assert.equal(report.ready, false);
  assert.equal(report.cli.available, false);
  assert.match(report.cli.error, /absolute path or a bare executable name/);
});

test("runChecked captures output larger than the default spawnSync buffer", () => {
  const size = 2 * 1024 * 1024;
  const result = runChecked(process.execPath, ["-e", `process.stdout.write("x".repeat(${size}))`]);

  assert.equal(result.error, null);
  assert.equal(result.status, 0);
  assert.equal(result.stdout.length, size);
});

test("normalizeTimeoutSeconds accepts positive seconds and rejects invalid values", () => {
  assert.equal(normalizeTimeoutSeconds(undefined), null);
  assert.equal(normalizeTimeoutSeconds(" "), null);
  assert.equal(normalizeTimeoutSeconds("90"), 90);
  assert.equal(normalizeTimeoutSeconds("1.5"), 1.5);

  for (const invalid of ["0", "-5", "abc", "10s", "Infinity"]) {
    assert.throws(() => normalizeTimeoutSeconds(invalid), /positive number of seconds/, invalid);
  }
});

test("runChecked reports a timed out command", () => {
  const result = runChecked(process.execPath, ["-e", "setTimeout(() => {}, 10000)"], { timeoutMs: 200 });

  assert.equal(result.timedOut, true);
  assert.notEqual(result.status, 0);
});

test("runChecked does not report a timeout for a completed command", () => {
  const result = runChecked(process.execPath, ["-e", "process.stdout.write('done')"], { timeoutMs: 5000 });

  assert.equal(result.timedOut, false);
  assert.equal(result.stdout, "done");
});

const maxTurnsPayload = {
  type: "result",
  subtype: "error_max_turns",
  is_error: true,
  session_id: "43f7a822",
  errors: ["Reached maximum number of turns (1)"]
};

test("parseClaudeJson exposes Claude error fields", () => {
  const parsed = parseClaudeJson(JSON.stringify(maxTurnsPayload));

  assert.equal(parsed.isError, true);
  assert.equal(parsed.subtype, "error_max_turns");
  assert.deepEqual(parsed.errors, ["Reached maximum number of turns (1)"]);
  assert.equal(parsed.sessionId, "43f7a822");
});

test("parseClaudeJson treats a successful result as not an error", () => {
  const parsed = parseClaudeJson(JSON.stringify({ result: "Done", is_error: false, subtype: "success" }));

  assert.equal(parsed.isError, false);
  assert.deepEqual(parsed.errors, []);
});

test("buildClaudeError uses the Claude subtype and error messages", () => {
  const error = buildClaudeError(parseClaudeJson(JSON.stringify(maxTurnsPayload)), 1);

  assert.deepEqual(error, {
    code: "error_max_turns",
    message: "Reached maximum number of turns (1)"
  });
});

test("buildClaudeError falls back to the result text and exit status", () => {
  assert.deepEqual(buildClaudeError(parseClaudeJson(JSON.stringify({ is_error: true, result: "Not logged in" })), 1), {
    code: "claude_error",
    message: "Not logged in"
  });
  assert.deepEqual(buildClaudeError(parseClaudeJson(JSON.stringify({ is_error: true })), 2), {
    code: "claude_error",
    message: "Claude Code exited with status 2."
  });
});

test("runChecked writes input to the command stdin", () => {
  const result = runChecked(process.execPath, ["-e", "process.stdin.pipe(process.stdout)"], { input: "from stdin" });

  assert.equal(result.status, 0);
  assert.equal(result.stdout, "from stdin");
});

test("resolveModel defaults blank values to sonnet", () => {
  assert.equal(resolveModel(undefined), "sonnet");
  assert.equal(resolveModel("  "), "sonnet");
  assert.equal(resolveModel(" opus "), "opus");
  assert.equal(resolveModel("claude-fable-5-1"), "claude-fable-5-1");
});

test("buildClaudeArgs passes the default model when none is given", () => {
  assert.match(buildClaudeArgs({}).join(" "), /--model sonnet/);
});

test("readPrompt only reads stdin when no prompt or prompt file is given", () => {
  let stdinReads = 0;
  const readStdin = () => {
    stdinReads += 1;
    return "from stdin";
  };

  assert.equal(readPrompt({ prompt: "inline", readStdin }), "inline");
  assert.equal(stdinReads, 0);
  assert.equal(readPrompt({ readStdin }), "from stdin");
  assert.equal(stdinReads, 1);
});

test("readPrompt rejects an empty prompt file", (context) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "read-prompt-"));
  context.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const promptFile = path.join(dir, "prompt.txt");
  fs.writeFileSync(promptFile, " \n\t\n");

  assert.throws(() => readPrompt({ promptFile, readStdin: () => "unused" }), /Prompt file is empty/);
});

test("readPrompt requires some prompt", () => {
  assert.throws(() => readPrompt({ readStdin: () => "  " }), /A prompt is required/);
});

test("timeoutSecondsToMs converts to positive integer milliseconds", () => {
  assert.equal(timeoutSecondsToMs(null), undefined);
  assert.equal(timeoutSecondsToMs(90), 90000);
  assert.equal(timeoutSecondsToMs(1.001), 1001);
  assert.equal(timeoutSecondsToMs(0.0001), 1);
});

test("buildSetupReport reports Claude commands that time out", (context) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "setup-timeout-"));
  context.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const cli = path.join(dir, "claude");
  fs.writeFileSync(cli, "#!/usr/bin/env node\nsetTimeout(() => {}, 10000);\n", { mode: 0o755 });

  const started = Date.now();
  const report = buildSetupReport({ env: { ...process.env, CLAUDE_CODE_CLI: cli }, timeoutMs: 300 });

  assert.ok(Date.now() - started < 5000, "setup should not wait for hung commands");
  assert.equal(report.ready, false);
  assert.equal(report.cli.available, false);
  assert.match(report.cli.error, /claude --version timed out after 300ms/);
  assert.equal(report.auth.authenticated, false);
  assert.match(report.auth.error, /claude auth status timed out after 300ms/);
});
