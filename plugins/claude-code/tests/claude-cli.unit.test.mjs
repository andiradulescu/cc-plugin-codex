import test from "node:test";
import assert from "node:assert/strict";

import { buildSetupReport } from "../skills/claude-code-bridge/scripts/lib/claude-cli.mjs";

test("setup requires host execution in the Codex sandbox", () => {
  const report = buildSetupReport({
    env: {
      CLAUDE_CODE_CLI: "/path/that/does/not/exist",
      CODEX_SANDBOX: "seatbelt"
    }
  });

  assert.equal(report.ready, false);
  assert.equal(report.requiresHostExecution, true);
  assert.equal(report.error.code, "host_execution_required");
  assert.match(report.error.message, /scoped sandbox escalation/);
});
