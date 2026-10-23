import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import url from "node:url";

const __dirname = path.dirname(url.fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");

async function readJson(relativePath) {
  const filePath = path.join(repoRoot, relativePath);
  const contents = await fs.readFile(filePath, "utf8");
  return JSON.parse(contents);
}

test("marketplace has a stable public identity", async () => {
  const marketplace = await readJson(".agents/plugins/marketplace.json");

  assert.equal(marketplace.name, "cc-plugin-codex");
  assert.equal(marketplace.interface.displayName, "Claude Code for Codex");
});

test("marketplace entry matches the packaged plugin manifest", async () => {
  const marketplace = await readJson(".agents/plugins/marketplace.json");
  const [plugin] = marketplace.plugins;

  assert.ok(plugin, "expected one marketplace plugin entry");
  assert.equal(plugin.name, "claude-code");
  assert.equal(plugin.source.source, "local");
  assert.equal(plugin.source.path, "./plugins/claude-code");

  const manifest = await readJson("plugins/claude-code/.codex-plugin/plugin.json");

  assert.equal(manifest.name, plugin.name);
  assert.equal(manifest.interface.displayName, "Claude Code");
  assert.equal(manifest.skills, "./skills/");
});

test("packaged plugin advertises Claude Fable", async () => {
  const manifest = await readJson("plugins/claude-code/.codex-plugin/plugin.json");

  assert.ok(manifest.keywords.includes("fable"));
  assert.match(manifest.description, /Fable/);
  assert.ok(manifest.interface.defaultPrompt.some((prompt) => prompt.includes("Fable")));
});

test("packaged skill routes Fable requests through Claude Code", async () => {
  const skillPath = path.join(repoRoot, "plugins/claude-code/skills/claude-code-bridge/SKILL.md");
  const skill = await fs.readFile(skillPath, "utf8");

  assert.match(skill, /^description: .*Fable/m);
  assert.match(skill, /`fable`: use Claude Fable for/);
});

test("packaged skill documents Claude Fable operating constraints", async () => {
  const skillPath = path.join(repoRoot, "plugins/claude-code/skills/claude-code-bridge/SKILL.md");
  const skill = await fs.readFile(skillPath, "utf8");

  assert.match(skill, /2\.1\.257/);
  assert.match(skill, /data retention by default/);
  assert.match(skill, /automatic safety fallback/);
});

test("packaged skill avoids unnecessary Claude setup checks", async () => {
  const skillPath = path.join(repoRoot, "plugins/claude-code/skills/claude-code-bridge/SKILL.md");
  const skill = await fs.readFile(skillPath, "utf8");

  assert.match(skill, /Run Claude Code directly without a setup preflight\./);
  assert.match(skill, /Run `setup` only after a failed run/);
  assert.doesNotMatch(skill, /Run `setup` before Fable/);
  assert.match(skill, /Use `--prompt` for short prompts/);
  assert.match(skill, /remaining bridge commands in the current turn/);
});

test("packaged documentation uses the concise Fable name", async () => {
  const rootReadme = await fs.readFile(path.join(repoRoot, "README.md"), "utf8");
  const pluginReadme = await fs.readFile(path.join(repoRoot, "plugins/claude-code/README.md"), "utf8");

  assert.match(rootReadme, /^## Claude Fable$/m);
  assert.match(pluginReadme, /Claude Fable 5\.1 requires Claude Code/);
});

test("packaged skill documents every run flag", async () => {
  const skillPath = path.join(repoRoot, "plugins/claude-code/skills/claude-code-bridge/SKILL.md");
  const skill = await fs.readFile(skillPath, "utf8");

  for (const flag of ["--timeout", "--append-system-prompt-file", "--system-prompt-file", "--json-schema-file"]) {
    assert.match(skill, new RegExp(`\`${flag} `), flag);
  }
});

test("packaged skill says file options take absolute paths", async () => {
  const skillPath = path.join(repoRoot, "plugins/claude-code/skills/claude-code-bridge/SKILL.md");
  const skill = await fs.readFile(skillPath, "utf8");

  assert.match(skill, /absolute paths/);
  assert.match(skill, /not from `--cwd`/);
});

test("package and plugin manifest share one version", async () => {
  const packageJson = await readJson("package.json");
  const manifest = await readJson("plugins/claude-code/.codex-plugin/plugin.json");

  assert.match(manifest.version, /^\d+\.\d+\.\d+$/);
  assert.equal(manifest.version, packageJson.version);
});

test("packaged skill covers model switching and escalation context", async () => {
  const skillPath = path.join(repoRoot, "plugins/claude-code/skills/claude-code-bridge/SKILL.md");
  const skill = await fs.readFile(skillPath, "utf8");

  assert.match(skill, /`haiku` alias on Sonnet/);
  assert.match(skill, /`modelsUsed`/);
  assert.match(skill, /escalation request, state that the user asked/);
});

test("readme explains that Codex runs a cached plugin copy", async () => {
  const readme = await fs.readFile(path.join(repoRoot, "README.md"), "utf8");

  assert.match(readme, /~\/\.codex\/plugins\/cache/);
  assert.match(readme, /rerun `codex plugin add/);
});

test("packaged skill leaves the default model to Claude Code", async () => {
  const skillPath = path.join(repoRoot, "plugins/claude-code/skills/claude-code-bridge/SKILL.md");
  const skill = await fs.readFile(skillPath, "utf8");
  const readme = await fs.readFile(path.join(repoRoot, "README.md"), "utf8");

  assert.match(skill, /If the user names no model, omit `--model`/);
  assert.doesNotMatch(skill, /`sonnet`: default for/);
  assert.match(readme, /omitted to use your Claude Code default/);
});
