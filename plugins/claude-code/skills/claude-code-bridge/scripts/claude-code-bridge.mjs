#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import process from "node:process";

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
} from "./lib/claude-cli.mjs";

function printUsage() {
  process.stdout.write(
    [
      "Usage:",
      "  node claude-code-bridge.mjs setup [--timeout <seconds>] [--json]",
      "  node claude-code-bridge.mjs run [--model <model>] [--effort <level>] [--cwd <path>] [--prompt <text>|--prompt-file <path>] [--permission-mode <mode>] [--continue] [--resume <session-id>] [--timeout <seconds>] [--json]",
      "      [--append-system-prompt-file <path>] [--system-prompt-file <path>] [--json-schema-file <path>]",
      "",
      "Relative file paths resolve from the current directory, not from --cwd."
    ].join("\n") + "\n"
  );
}

function readStdinIfPiped() {
  if (process.stdin.isTTY) {
    return "";
  }
  return fs.readFileSync(0, "utf8");
}

// Options each command accepts; anything else is rejected so a mistyped flag cannot silently change a run.
const COMMAND_OPTIONS = {
  setup: {
    flags: new Set(["json"]),
    values: new Set(["timeout"])
  },
  run: {
    flags: new Set(["json", "continue"]),
    values: new Set([
      "model",
      "effort",
      "cwd",
      "prompt",
      "prompt-file",
      "permission-mode",
      "resume",
      "timeout",
      "append-system-prompt-file",
      "system-prompt-file",
      "json-schema-file"
    ])
  }
};

// Free-text values may legitimately start with "--".
const FREE_TEXT_OPTIONS = new Set(["prompt"]);

function parseArgs(command, argv) {
  const { flags, values } = COMMAND_OPTIONS[command];
  const options = {};

  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (!value.startsWith("--")) {
      throw new Error(`Unexpected argument: ${value}`);
    }

    const key = value.slice(2);
    if (flags.has(key)) {
      options[key] = true;
      continue;
    }
    if (!values.has(key)) {
      throw new Error(`Unknown option --${key} for ${command}. Run with --help for usage.`);
    }

    const next = argv[index + 1];
    if (next == null || (next.startsWith("--") && !FREE_TEXT_OPTIONS.has(key))) {
      throw new Error(`Missing value for --${key}.`);
    }
    options[key] = next;
    index += 1;
  }

  return options;
}

function output(payload, asJson) {
  if (asJson) {
    process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
    return;
  }
  process.stdout.write(payload);
}

// Returns true after reporting that the command must be rerun outside the Codex sandbox.
function reportHostExecutionRequired(options, payload) {
  const requirement = buildHostExecutionRequirement();
  if (!requirement.requiresHostExecution) {
    return false;
  }

  if (options.json) {
    output({ ...payload, ...requirement }, true);
  } else {
    output(`${requirement.error.message}\n`, false);
  }
  process.exitCode = 1;
  return true;
}

function handleSetup(options) {
  if (reportHostExecutionRequired(options, { ready: false })) {
    return;
  }
  const report = buildSetupReport({ timeoutMs: timeoutSecondsToMs(normalizeTimeoutSeconds(options.timeout)) });
  process.exitCode = report.ready ? 0 : 1;
  if (options.json) {
    output(report, true);
    return;
  }

  const lines = [];
  lines.push(`Claude CLI available: ${report.cli.available ? "yes" : "no"}`);
  if (report.cli.command) {
    lines.push(`Command: ${report.cli.command}`);
  }
  if (report.cli.version) {
    lines.push(`Version: ${report.cli.version}`);
  }
  if (report.cli.error) {
    lines.push(`Error: ${report.cli.error}`);
  }
  lines.push(`Authenticated: ${report.auth.authenticated ? "yes" : "no"}`);
  if (report.auth.error) {
    lines.push(`Auth error: ${report.auth.error}`);
  }
  if (!report.ready) {
    lines.push("Next steps:");
    if (!report.cli.available && !report.cli.timedOut) {
      lines.push("- Install Claude Code with `npm install -g @anthropic-ai/claude-code`.");
    }
    if (report.cli.available && !report.auth.authenticated) {
      lines.push("- Run `claude auth login`.");
    }
  }
  output(`${lines.join("\n")}\n`, false);
}

function handleRun(options) {
  if (reportHostExecutionRequired(options, { ok: false })) {
    return;
  }

  const cwd = options.cwd ? path.resolve(options.cwd) : process.cwd();
  const timeoutSeconds = normalizeTimeoutSeconds(options.timeout);
  const command = resolveClaudeCli();
  const prompt = readPrompt({
    prompt: options.prompt,
    promptFile: options["prompt-file"],
    readStdin: readStdinIfPiped
  });
  const args = buildClaudeArgs({
    model: options.model,
    effort: options.effort,
    continueLast: Boolean(options.continue),
    resume: options.resume,
    permissionMode: options["permission-mode"],
    appendSystemPromptFile: options["append-system-prompt-file"],
    systemPromptFile: options["system-prompt-file"],
    jsonSchemaFile: options["json-schema-file"]
  });

  const result = runChecked(command, args, {
    cwd,
    input: prompt,
    timeoutMs: timeoutSecondsToMs(timeoutSeconds)
  });
  if (result.timedOut) {
    throw new Error(`Claude Code timed out after ${timeoutSeconds}s.`);
  }
  if (result.error) {
    const hasClaudeErrorOutput = result.status !== 0 && (result.stdout.trim() || result.stderr.trim());
    if (result.error.code !== "EPIPE" || !hasClaudeErrorOutput) {
      throw result.error;
    }
  }

  let parsed;
  try {
    parsed = parseClaudeJson(result.stdout);
  } catch (parseError) {
    if (result.status === 0) {
      throw new Error(`Claude Code returned invalid JSON: ${parseError.message}`);
    }
    const message = [
      `Claude Code exited with status ${result.status}.`,
      result.stderr.trim(),
      result.stdout.trim()
    ]
      .filter(Boolean)
      .join("\n");
    throw new Error(message);
  }

  const model = resolveModel(options.model);
  if (result.status !== 0 || parsed.isError) {
    const error = buildClaudeError(parsed, result.status);
    if (options.json) {
      output({ ok: false, model, cwd, sessionId: parsed.sessionId, error, raw: parsed.raw }, true);
      process.exitCode = 1;
      return;
    }
    const details = parsed.sessionId ? `${error.message}\nSession ID: ${parsed.sessionId}` : error.message;
    throw new Error(details);
  }

  const payload = {
    ok: true,
    model,
    cwd,
    sessionId: parsed.sessionId,
    result: parsed.result,
    structuredOutput: parsed.structuredOutput,
    raw: parsed.raw
  };

  if (options.json) {
    output(payload, true);
    return;
  }

  output(renderRunText(parsed, payload.model), false);
}

function main() {
  const [, , command, ...rest] = process.argv;
  if (!command || ["-h", "--help", "help"].includes(command)) {
    printUsage();
    return;
  }

  if (!Object.hasOwn(COMMAND_OPTIONS, command)) {
    throw new Error(`Unknown command: ${command}`);
  }

  const options = parseArgs(command, rest);
  if (command === "setup") {
    handleSetup(options);
    return;
  }
  handleRun(options);
}

try {
  main();
} catch (error) {
  process.stderr.write(`${error.message}\n`);
  // exitCode lets Node drain stderr; process.exit() can truncate output to a pipe.
  process.exitCode = 1;
}
