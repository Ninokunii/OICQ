import fs from "node:fs/promises";
import { constants as fsConstants } from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

function unpackedAsarPath(value: string): string {
  return value
    .replace("app.asar", "app.asar.unpacked")
    .replace("node_modules.asar", "node_modules.asar.unpacked");
}

async function ensureExecutable(pathname: string): Promise<boolean> {
  try {
    await fs.access(pathname, fsConstants.X_OK);
    return true;
  } catch {
    // fall through
  }

  try {
    const stat = await fs.stat(pathname);
    if (!stat.isFile()) {
      return false;
    }
    await fs.chmod(pathname, stat.mode | 0o111);
    return true;
  } catch {
    return false;
  }
}

export async function ensureNodePtySpawnHelperExecutable(): Promise<void> {
  if (process.platform === "win32") {
    return;
  }

  const packageRoot = path.dirname(require.resolve("node-pty/package.json"));
  const relativeCandidates = [
    path.join("build", "Release", "spawn-helper"),
    path.join("build", "Debug", "spawn-helper"),
    path.join("prebuilds", `${process.platform}-${process.arch}`, "spawn-helper"),
  ];

  const candidates = relativeCandidates.flatMap((relativePath) => {
    const absolutePath = path.join(packageRoot, relativePath);
    const unpackedPath = unpackedAsarPath(absolutePath);
    return unpackedPath === absolutePath ? [absolutePath] : [absolutePath, unpackedPath];
  });

  let foundHelper = false;
  for (const candidate of candidates) {
    try {
      await fs.access(candidate, fsConstants.F_OK);
    } catch {
      continue;
    }

    foundHelper = true;
    if (await ensureExecutable(candidate)) {
      return;
    }
  }

  if (foundHelper) {
    throw new Error("OICQ could not make node-pty spawn-helper executable.");
  }
}
