import test from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import url from "node:url";
import { promisify } from "node:util";

import { buildHomeMarketplace, mergeHomeMarketplace } from "../scripts/install-local.mjs";

const __dirname = path.dirname(url.fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");
const execFileAsync = promisify(execFile);

async function runInstaller(home, ...args) {
  return execFileAsync(process.execPath, [path.join(repoRoot, "scripts", "install-local.mjs"), ...args], {
    env: {
      ...process.env,
      HOME: home
    }
  });
}

async function createTemporaryHome(context) {
  const home = await fs.mkdtemp(path.join(os.tmpdir(), "cc-plugin-codex-test-"));
  context.after(() => fs.rm(home, { force: true, recursive: true }));
  return home;
}

test("local installer prints the install command for a fresh marketplace", async (context) => {
  const home = await createTemporaryHome(context);

  const { stdout } = await runInstaller(home, "--dry-run");

  assert.match(stdout, /codex plugin add claude-code@cc-plugin-codex/);
});

test("local installer prints the preserved command for an existing marketplace", async (context) => {
  const home = await createTemporaryHome(context);

  const marketplacePath = path.join(home, ".agents", "plugins", "marketplace.json");
  await fs.mkdir(path.dirname(marketplacePath), { recursive: true });
  await fs.writeFile(
    marketplacePath,
    `${JSON.stringify({ name: "local-plugins", plugins: [] }, null, 2)}\n`,
    "utf8"
  );

  const { stdout } = await runInstaller(home, "--dry-run");

  assert.match(stdout, /codex plugin add claude-code@local-plugins/);
  assert.doesNotMatch(stdout, /codex plugin add claude-code@cc-plugin-codex/);
});

test("personal marketplace points at the home-local plugin install path", async () => {
  const marketplacePath = path.join(repoRoot, ".agents", "plugins", "marketplace.json");
  const repoMarketplace = JSON.parse(await fs.readFile(marketplacePath, "utf8"));

  const homeMarketplace = buildHomeMarketplace(repoMarketplace);
  const [plugin] = homeMarketplace.plugins;

  assert.ok(plugin, "expected one plugin entry");
  assert.equal(plugin.name, "claude-code");
  assert.equal(plugin.source.path, "./.codex/plugins/claude-code");
});

test("personal marketplace falls back to the repo template when no home marketplace exists", async () => {
  const marketplacePath = path.join(repoRoot, ".agents", "plugins", "marketplace.json");
  const repoMarketplace = JSON.parse(await fs.readFile(marketplacePath, "utf8"));

  const merged = mergeHomeMarketplace({
    repoMarketplace,
    existingMarketplace: null
  });

  assert.equal(merged.name, repoMarketplace.name);
  assert.equal(merged.interface.displayName, repoMarketplace.interface.displayName);
  assert.equal(merged.plugins.length, 1);
  assert.equal(merged.plugins[0].name, "claude-code");
  assert.equal(merged.plugins[0].source.path, "./.codex/plugins/claude-code");
});

test("personal marketplace merge preserves existing plugins and replaces claude-code by name", async () => {
  const marketplacePath = path.join(repoRoot, ".agents", "plugins", "marketplace.json");
  const repoMarketplace = JSON.parse(await fs.readFile(marketplacePath, "utf8"));

  const merged = mergeHomeMarketplace({
    repoMarketplace,
    existingMarketplace: {
      name: "my-personal-marketplace",
      interface: {
        displayName: "My Personal Plugins"
      },
      plugins: [
        {
          name: "notes-helper",
          source: {
            source: "local",
            path: "./.codex/plugins/notes-helper"
          },
          policy: {
            installation: "AVAILABLE",
            authentication: "ON_INSTALL"
          },
          category: "Productivity"
        },
        {
          name: "claude-code",
          source: {
            source: "local",
            path: "./wrong/path"
          },
          policy: {
            installation: "NOT_AVAILABLE",
            authentication: "ON_USE"
          },
          category: "Other"
        }
      ]
    }
  });

  assert.equal(merged.name, "my-personal-marketplace");
  assert.equal(merged.interface.displayName, "My Personal Plugins");
  assert.equal(merged.plugins.length, 2);
  assert.equal(merged.plugins[0].name, "notes-helper");
  assert.equal(merged.plugins[1].name, "claude-code");
  assert.equal(merged.plugins[1].source.path, "./.codex/plugins/claude-code");
  assert.equal(merged.plugins[1].policy.installation, "AVAILABLE");
  assert.equal(merged.plugins[1].policy.authentication, "ON_INSTALL");
  assert.equal(merged.plugins[1].category, "Coding");
});

async function pathExists(filePath) {
  try {
    await fs.lstat(filePath);
    return true;
  } catch (error) {
    if (error.code === "ENOENT") {
      return false;
    }
    throw error;
  }
}

test("local installer rejects unknown options before writing anything", async (context) => {
  const home = await createTemporaryHome(context);

  for (const option of ["--dryrun", "--dry_run", "--forse", "extra"]) {
    await assert.rejects(runInstaller(home, option), (error) => {
      assert.match(error.stderr, new RegExp(`Unknown option: ${option}`));
      return true;
    });
  }

  assert.deepEqual(await fs.readdir(home), []);
});

test("local installer rejects --mode without a value", async (context) => {
  const home = await createTemporaryHome(context);

  await assert.rejects(runInstaller(home, "--mode"), /Unsupported mode/);
  await assert.rejects(runInstaller(home, "--mode", "--dry-run"), /Unsupported mode/);
  assert.deepEqual(await fs.readdir(home), []);
});

test("local installer leaves the marketplace untouched when the plugin path conflicts", async (context) => {
  const home = await createTemporaryHome(context);
  const pluginPath = path.join(home, ".codex", "plugins", "claude-code");
  await fs.mkdir(pluginPath, { recursive: true });

  await assert.rejects(runInstaller(home), /Refusing to replace existing path without --force/);

  assert.equal(await pathExists(path.join(home, ".agents", "plugins", "marketplace.json")), false);
});

test("local installer leaves the plugin path untouched when the marketplace is a symlink", async (context) => {
  const home = await createTemporaryHome(context);
  const marketplacePath = path.join(home, ".agents", "plugins", "marketplace.json");
  await fs.mkdir(path.dirname(marketplacePath), { recursive: true });
  await fs.writeFile(path.join(home, "real-marketplace.json"), "{}\n");
  await fs.symlink(path.join(home, "real-marketplace.json"), marketplacePath);

  await assert.rejects(runInstaller(home), /Refusing to replace symlink without --force/);

  assert.equal(await pathExists(path.join(home, ".codex", "plugins", "claude-code")), false);
});

test("local installer links the plugin and registers it", async (context) => {
  const home = await createTemporaryHome(context);

  await runInstaller(home);
  const { stdout } = await runInstaller(home);

  const pluginPath = path.join(home, ".codex", "plugins", "claude-code");
  assert.equal(await fs.readlink(pluginPath), path.join(repoRoot, "plugins", "claude-code"));
  const marketplace = JSON.parse(await fs.readFile(path.join(home, ".agents", "plugins", "marketplace.json"), "utf8"));
  assert.equal(marketplace.plugins[0].source.path, "./.codex/plugins/claude-code");
  assert.match(stdout, /^ok /m, "rerunning symlink mode is idempotent");
});
