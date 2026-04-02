#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import process from "node:process";

import {
  buildClaudeArgs,
  buildSetupReport,
  parseClaudeJson,
  renderRunText,
  resolveClaudeCli,
  runChecked
} from "./lib/claude-cli.mjs";

function printUsage() {
  process.stdout.write(
    [
      "Usage:",
      "  node claude-code-bridge.mjs setup [--json]",
      "  node claude-code-bridge.mjs run [--model <model>] [--effort <level>] [--cwd <path>] [--prompt <text>|--prompt-file <path>] [--permission-mode <mode>] [--continue] [--resume <session-id>] [--json]"
    ].join("\n") + "\n"
  );
}

function readStdinIfPiped() {
  if (process.stdin.isTTY) {
    return "";
  }
  return fs.readFileSync(0, "utf8");
}

function parseArgs(argv) {
  const options = {};
  const positionals = [];

  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (!value.startsWith("--")) {
      positionals.push(value);
      continue;
    }

    const key = value.slice(2);
    if (["json", "continue"].includes(key)) {
      options[key] = true;
      continue;
    }

    const next = argv[index + 1];
    if (next == null) {
      throw new Error(`Missing value for --${key}.`);
    }
    options[key] = next;
    index += 1;
  }

  return { options, positionals };
}

function output(payload, asJson) {
  if (asJson) {
    process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
    return;
  }
  process.stdout.write(payload);
}

function handleSetup(options) {
  const report = buildSetupReport();
  if (options.json) {
    output(report, true);
    process.exit(report.ready ? 0 : 1);
  }

  const lines = [];
  lines.push(`Claude CLI available: ${report.cli.available ? "yes" : "no"}`);
  if (report.cli.command) {
    lines.push(`Command: ${report.cli.command}`);
  }
  if (report.cli.version) {
    lines.push(`Version: ${report.cli.version}`);
  }
  lines.push(`Authenticated: ${report.auth.authenticated ? "yes" : "no"}`);
  if (!report.ready) {
    lines.push("Next steps:");
    if (!report.cli.available) {
      lines.push("- Install Claude Code with `npm install -g @anthropic-ai/claude-code`.");
    }
    if (report.cli.available && !report.auth.authenticated) {
      lines.push("- Run `claude auth login`.");
    }
    lines.push("- Accept non-interactive permissions once with `claude --permission-mode bypassPermissions`.");
  }
  output(`${lines.join("\n")}\n`, false);
  process.exit(report.ready ? 0 : 1);
}

function handleRun(options) {
  const stdin = readStdinIfPiped();
  const cwd = options.cwd ? path.resolve(options.cwd) : process.cwd();
  const command = resolveClaudeCli();
  const args = buildClaudeArgs({
    prompt: options.prompt,
    promptFile: options["prompt-file"],
    model: options.model,
    effort: options.effort,
    continueLast: Boolean(options.continue),
    resume: options.resume,
    permissionMode: options["permission-mode"],
    appendSystemPromptFile: options["append-system-prompt-file"],
    systemPromptFile: options["system-prompt-file"],
    jsonSchemaFile: options["json-schema-file"],
    stdin
  });

  const result = runChecked(command, args, { cwd });
  if (result.error) {
    throw result.error;
  }
  if (result.status !== 0) {
    const message = [
      `Claude Code exited with status ${result.status}.`,
      result.stderr.trim(),
      result.stdout.trim()
    ]
      .filter(Boolean)
      .join("\n");
    throw new Error(message);
  }

  const parsed = parseClaudeJson(result.stdout);
  const payload = {
    ok: true,
    model: options.model ?? "sonnet",
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

  const { options } = parseArgs(rest);
  if (command === "setup") {
    handleSetup(options);
    return;
  }
  if (command === "run") {
    handleRun(options);
    return;
  }

  throw new Error(`Unknown command: ${command}`);
}

try {
  main();
} catch (error) {
  process.stderr.write(`${error.message}\n`);
  process.exit(1);
}
