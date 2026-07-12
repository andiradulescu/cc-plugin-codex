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
  assert.match(skill, /`fable`: use Claude Fable 5/);
  assert.match(skill, /--model fable/);
});

test("packaged skill documents Claude Fable operating constraints", async () => {
  const skillPath = path.join(repoRoot, "plugins/claude-code/skills/claude-code-bridge/SKILL.md");
  const skill = await fs.readFile(skillPath, "utf8");

  assert.match(skill, /2\.1\.170/);
  assert.match(skill, /30-day data retention/);
  assert.match(skill, /fallback to Opus 4\.8/);
});
