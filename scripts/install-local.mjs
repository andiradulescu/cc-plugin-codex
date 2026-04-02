import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import process from "node:process";

const REPO_ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const PLUGIN_NAME = "claude-code";
const ALLOWED_MODES = new Set(["copy", "symlink"]);

function parseArgs(argv) {
  let mode = "symlink";

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--mode") {
      mode = argv[index + 1] ?? "";
      index += 1;
      continue;
    }
    if (arg.startsWith("--mode=")) {
      mode = arg.slice("--mode=".length);
    }
  }

  if (!ALLOWED_MODES.has(mode)) {
    throw new Error("Unsupported mode. Use --mode copy or --mode symlink.");
  }

  return {
    dryRun: argv.includes("--dry-run"),
    force: argv.includes("--force"),
    mode
  };
}

async function ensureParentDir(filePath, { dryRun }) {
  const parent = path.dirname(filePath);
  if (dryRun) {
    console.log(`[dry-run] mkdir -p ${parent}`);
    return;
  }
  await fs.mkdir(parent, { recursive: true });
}

async function readExistingSymlink(linkPath) {
  try {
    const stat = await fs.lstat(linkPath);
    if (!stat.isSymbolicLink()) {
      return { exists: true, isSymlink: false, target: null };
    }
    const target = await fs.readlink(linkPath);
    return { exists: true, isSymlink: true, target };
  } catch (error) {
    if (error && error.code === "ENOENT") {
      return { exists: false, isSymlink: false, target: null };
    }
    throw error;
  }
}

async function ensureSymlink({ sourcePath, linkPath, type, dryRun, force }) {
  const existing = await readExistingSymlink(linkPath);
  const desiredTarget = sourcePath;

  if (existing.exists && existing.isSymlink) {
    const resolvedExisting = path.resolve(path.dirname(linkPath), existing.target);
    if (resolvedExisting === desiredTarget) {
      console.log(`ok ${linkPath} -> ${existing.target}`);
      return;
    }
  }

  if (existing.exists && !force) {
    throw new Error(`Refusing to replace existing path without --force: ${linkPath}`);
  }

  await ensureParentDir(linkPath, { dryRun });

  if (existing.exists) {
    if (dryRun) {
      console.log(`[dry-run] rm ${linkPath}`);
    } else {
      await fs.rm(linkPath, { recursive: true, force: true });
    }
  }

  if (dryRun) {
    console.log(`[dry-run] ln -s ${sourcePath} ${linkPath}`);
    return;
  }

  await fs.symlink(sourcePath, linkPath, type);
  console.log(`linked ${linkPath} -> ${sourcePath}`);
}

async function copyPath({ sourcePath, targetPath, dryRun, force }) {
  const existing = await readExistingSymlink(targetPath);

  if (existing.exists && !force) {
    throw new Error(`Refusing to replace existing path without --force: ${targetPath}`);
  }

  await ensureParentDir(targetPath, { dryRun });

  if (existing.exists) {
    if (dryRun) {
      console.log(`[dry-run] rm ${targetPath}`);
    } else {
      await fs.rm(targetPath, { recursive: true, force: true });
    }
  }

  const sourceStat = await fs.lstat(sourcePath);

  if (dryRun) {
    console.log(`[dry-run] cp ${sourcePath} ${targetPath}`);
    return;
  }

  if (sourceStat.isDirectory()) {
    await fs.cp(sourcePath, targetPath, { recursive: true });
  } else {
    await fs.copyFile(sourcePath, targetPath);
  }

  console.log(`copied ${sourcePath} -> ${targetPath}`);
}

async function main() {
  const { dryRun, force, mode } = parseArgs(process.argv.slice(2));
  const home = os.homedir();

  const sourceMarketplace = path.join(REPO_ROOT, ".agents", "plugins", "marketplace.json");
  const sourcePlugin = path.join(REPO_ROOT, "plugins", PLUGIN_NAME);

  const targetMarketplace = path.join(home, ".agents", "plugins", "marketplace.json");
  const targetPlugin = path.join(home, ".codex", "plugins", PLUGIN_NAME);

  if (mode === "symlink") {
    await ensureSymlink({
      sourcePath: sourceMarketplace,
      linkPath: targetMarketplace,
      type: "file",
      dryRun,
      force
    });

    await ensureSymlink({
      sourcePath: sourcePlugin,
      linkPath: targetPlugin,
      type: "dir",
      dryRun,
      force
    });
    return;
  }

  await copyPath({
    sourcePath: sourceMarketplace,
    targetPath: targetMarketplace,
    dryRun,
    force
  });

  await copyPath({
    sourcePath: sourcePlugin,
    targetPath: targetPlugin,
    dryRun,
    force
  });
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
