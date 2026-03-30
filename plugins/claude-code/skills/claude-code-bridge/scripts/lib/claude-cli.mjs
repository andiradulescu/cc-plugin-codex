import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

export const DEFAULT_MODEL = "sonnet";
export const ALLOWED_EFFORTS = new Set(["low", "medium", "high", "max"]);

function trimToNull(value) {
  if (value == null) {
    return null;
  }
  const normalized = String(value).trim();
  return normalized ? normalized : null;
}

export function resolveClaudeCli({ env = process.env, homeDir = os.homedir(), existsSync = fs.existsSync } = {}) {
  const explicit = trimToNull(env.CLAUDE_CODE_CLI);
  if (explicit) {
    if (path.isAbsolute(explicit)) {
      return explicit;
    }
    if (explicit.includes("/") || explicit.includes("\\")) {
      throw new Error("CLAUDE_CODE_CLI must be an absolute path or a bare executable name.");
    }
    return explicit;
  }

  const localInstall = path.join(homeDir, ".claude", "local", "claude");
  if (existsSync(localInstall)) {
    return localInstall;
  }

  return "claude";
}

export function readPrompt({ prompt, promptFile, stdin = "" } = {}) {
  const inlinePrompt = trimToNull(prompt);
  if (inlinePrompt) {
    return inlinePrompt;
  }

  const filePath = trimToNull(promptFile);
  if (filePath) {
    return fs.readFileSync(path.resolve(filePath), "utf8");
  }

  const piped = trimToNull(stdin);
  if (piped) {
    return piped;
  }

  throw new Error("A prompt is required. Pass --prompt, --prompt-file, or pipe stdin.");
}

export function normalizeEffort(effort) {
  const normalized = trimToNull(effort);
  if (!normalized) {
    return null;
  }
  if (!ALLOWED_EFFORTS.has(normalized)) {
    throw new Error("Unsupported effort. Use one of: low, medium, high, max.");
  }
  return normalized;
}

export function buildClaudeArgs(options) {
  const prompt = readPrompt(options);
  const args = ["--bare", "--print", prompt, "--output-format", "json", "--permission-mode", "bypassPermissions"];

  const model = trimToNull(options.model) ?? DEFAULT_MODEL;
  if (model) {
    args.push("--model", model);
  }

  const effort = normalizeEffort(options.effort);
  if (effort) {
    args.push("--effort", effort);
  }

  if (options.continueLast) {
    args.push("--continue");
  }

  const resume = trimToNull(options.resume);
  if (resume) {
    args.push("--resume", resume);
  }

  const appendSystemPromptFile = trimToNull(options.appendSystemPromptFile);
  if (appendSystemPromptFile) {
    args.push("--append-system-prompt-file", path.resolve(appendSystemPromptFile));
  }

  const systemPromptFile = trimToNull(options.systemPromptFile);
  if (systemPromptFile) {
    args.push("--system-prompt-file", path.resolve(systemPromptFile));
  }

  const jsonSchemaFile = trimToNull(options.jsonSchemaFile);
  if (jsonSchemaFile) {
    args.push("--json-schema", fs.readFileSync(path.resolve(jsonSchemaFile), "utf8"));
  }

  return args;
}

export function parseClaudeJson(stdout) {
  const payload = JSON.parse(String(stdout ?? "").trim());
  return {
    raw: payload,
    result: trimToNull(payload.result) ?? "",
    sessionId: trimToNull(payload.session_id) ?? null,
    structuredOutput: payload.structured_output ?? null
  };
}

export function renderRunText(parsed, model) {
  const lines = [];
  lines.push(`Claude Code model: ${model}`);
  if (parsed.sessionId) {
    lines.push(`Session ID: ${parsed.sessionId}`);
  }
  if (parsed.structuredOutput != null) {
    lines.push("Structured output:");
    lines.push(JSON.stringify(parsed.structuredOutput, null, 2));
  } else {
    lines.push("Result:");
    lines.push(parsed.result || "(empty)");
  }
  return `${lines.join("\n")}\n`;
}

export function runChecked(command, args, { cwd, env = process.env } = {}) {
  const result = spawnSync(command, args, {
    cwd,
    env,
    encoding: "utf8"
  });

  return {
    status: result.status ?? 1,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
    error: result.error ?? null
  };
}

export function buildSetupReport({ env = process.env, cwd = process.cwd(), homeDir, existsSync } = {}) {
  let command;
  try {
    command = resolveClaudeCli({ env, homeDir, existsSync });
  } catch (error) {
    return {
      ready: false,
      cli: {
        available: false,
        command: null,
        error: error.message
      },
      auth: {
        authenticated: false
      }
    };
  }

  const version = runChecked(command, ["--version"], { cwd, env });
  const auth = runChecked(command, ["auth", "status"], { cwd, env });

  let authPayload = null;
  try {
    authPayload = auth.stdout.trim() ? JSON.parse(auth.stdout) : null;
  } catch {
    authPayload = null;
  }

  const available = version.status === 0 && !version.error;
  const authenticated = auth.status === 0;

  return {
    ready: available && authenticated,
    cli: {
      available,
      command,
      version: trimToNull(version.stdout) ?? trimToNull(version.stderr),
      error: version.error?.message ?? null
    },
    auth: {
      authenticated,
      payload: authPayload,
      stderr: trimToNull(auth.stderr),
      stdout: trimToNull(auth.stdout)
    }
  };
}
