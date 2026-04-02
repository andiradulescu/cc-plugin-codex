import test from "node:test";
import assert from "node:assert/strict";

import {
  buildClaudeArgs,
  buildSetupReport,
  parseClaudeJson,
  renderRunText,
  resolveClaudeCli
} from "../plugins/claude-code/skills/claude-code-bridge/scripts/lib/claude-cli.mjs";

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

  assert.deepEqual(args.slice(0, 6), ["--print", "Review this patch", "--output-format", "json", "--permission-mode", "acceptEdits"]);
  assert.match(args.join(" "), /acceptEdits/);
  assert.match(args.join(" "), /--model opus/);
  assert.match(args.join(" "), /--effort high/);
  assert.match(args.join(" "), /--continue/);
  assert.match(args.join(" "), /--resume session-123/);
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
