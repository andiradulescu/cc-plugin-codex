import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

// Reported as the model when none is requested and Claude Code uses its configured default (/model, ANTHROPIC_MODEL, settings).
export const DEFAULT_MODEL_LABEL = "default";
// Source: https://code.claude.com/docs/en/model-config#adjust-effort-level
export const ALLOWED_EFFORTS = new Set(["low", "medium", "high", "xhigh", "max"]);

function trimToNull(value) {
  if (value == null) {
    return null;
  }
  const normalized = String(value).trim();
  return normalized ? normalized : null;
}

export function buildHostExecutionRequirement({ env = process.env } = {}) {
  if (!trimToNull(env.CODEX_SANDBOX)) {
    return {
      requiresHostExecution: false
    };
  }

  return {
    requiresHostExecution: true,
    error: {
      code: "host_execution_required",
      message:
        "Claude Code must run outside the Codex sandbox to access host authentication and network. Rerun this command with scoped sandbox escalation."
    }
  };
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

// readStdin is only called when neither prompt nor promptFile is given, so an idle stdin cannot block or fail the run.
export function readPrompt({ prompt, promptFile, readStdin = () => "" } = {}) {
  const inlinePrompt = trimToNull(prompt);
  if (inlinePrompt) {
    return inlinePrompt;
  }

  const filePath = trimToNull(promptFile);
  if (filePath) {
    const resolvedPath = path.resolve(filePath);
    const filePrompt = fs.readFileSync(resolvedPath, "utf8");
    if (!trimToNull(filePrompt)) {
      throw new Error(`Prompt file is empty: ${resolvedPath}`);
    }
    return filePrompt;
  }

  const piped = trimToNull(readStdin());
  if (piped) {
    return piped;
  }

  throw new Error("A prompt is required. Pass --prompt, --prompt-file, or pipe stdin.");
}

// Returns null when no model is requested, so --model is omitted and Claude Code picks its configured default.
export function resolveModel(model) {
  return trimToNull(model);
}

export function normalizeEffort(effort) {
  const normalized = trimToNull(effort);
  if (!normalized) {
    return null;
  }
  if (!ALLOWED_EFFORTS.has(normalized)) {
    throw new Error(`Unsupported effort. Use one of: ${[...ALLOWED_EFFORTS].join(", ")}.`);
  }
  return normalized;
}

export function normalizeTimeoutSeconds(timeout) {
  const normalized = trimToNull(timeout);
  if (!normalized) {
    return null;
  }
  const seconds = Number(normalized);
  if (!Number.isFinite(seconds) || seconds <= 0) {
    throw new Error("Timeout must be a positive number of seconds.");
  }
  return seconds;
}

// spawnSync needs a positive integer; 0 would mean "no timeout".
export function timeoutSecondsToMs(seconds) {
  if (seconds == null) {
    return undefined;
  }
  return Math.max(1, Math.round(seconds * 1000));
}

export const SANDBOX_SETTINGS = JSON.stringify({
  sandbox: {
    enabled: true,
    autoAllow: true,
    allowUnsandboxedCommands: false
  }
});

// The prompt is sent on stdin (see runChecked `input`) so its size is not bound by the OS argv limit.
export function buildClaudeArgs(options) {
  const permissionMode = trimToNull(options.permissionMode) ?? "acceptEdits";
  const args = [
    "--print",
    "--output-format", "json",
    "--permission-mode", permissionMode,
    "--settings", SANDBOX_SETTINGS
  ];

  const model = resolveModel(options.model);
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
    structuredOutput: payload.structured_output ?? null,
    isError: payload.is_error === true,
    subtype: trimToNull(payload.subtype),
    errors: Array.isArray(payload.errors) ? payload.errors.map(String) : [],
    // Claude Code can run a different model than requested, e.g. the haiku alias in plan mode runs Sonnet.
    modelsUsed: payload.modelUsage && typeof payload.modelUsage === "object" ? Object.keys(payload.modelUsage) : []
  };
}

export function buildClaudeError(parsed, status) {
  return {
    code: parsed.subtype ?? "claude_error",
    message: parsed.errors.join("\n") || parsed.result || `Claude Code exited with status ${status}.`
  };
}

export function renderRunText(parsed, model) {
  const lines = [];
  lines.push(`Claude Code model: ${model}`);
  if (parsed.modelsUsed?.length) {
    lines.push(`Models used: ${parsed.modelsUsed.join(", ")}`);
  }
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

export function runChecked(command, args, { cwd, env = process.env, timeoutMs, input } = {}) {
  const result = spawnSync(command, args, {
    cwd,
    env,
    input,
    encoding: "utf8",
    // spawnSync defaults to a 1 MiB buffer; long Claude runs can exceed it.
    maxBuffer: Infinity,
    timeout: timeoutMs
  });

  return {
    status: result.status ?? 1,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
    error: result.error ?? null,
    timedOut: result.error?.code === "ETIMEDOUT"
  };
}

function describeCommandError(result, label, timeoutMs) {
  if (result.timedOut) {
    return `${label} timed out after ${timeoutMs}ms.`;
  }
  return result.error?.message ?? null;
}

export function buildSetupReport({ env = process.env, cwd = process.cwd(), homeDir, existsSync, timeoutMs } = {}) {
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

  const version = runChecked(command, ["--version"], { cwd, env, timeoutMs });
  const auth = runChecked(command, ["auth", "status"], { cwd, env, timeoutMs });

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
      error: describeCommandError(version, "claude --version", timeoutMs),
      timedOut: version.timedOut
    },
    auth: {
      authenticated,
      error: describeCommandError(auth, "claude auth status", timeoutMs),
      payload: authPayload,
      stderr: trimToNull(auth.stderr),
      stdout: trimToNull(auth.stdout)
    }
  };
}
