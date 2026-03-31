import fs from "node:fs/promises";
import { constants as fsConstants } from "node:fs";
import path from "node:path";

const packageRoot = path.resolve("node_modules/node-pty");
const candidates = [
  path.join(packageRoot, "build", "Release", "spawn-helper"),
  path.join(packageRoot, "build", "Debug", "spawn-helper"),
  path.join(packageRoot, "prebuilds", `${process.platform}-${process.arch}`, "spawn-helper"),
];

if (process.platform === "win32") {
  process.exit(0);
}

for (const candidate of candidates) {
  try {
    await fs.access(candidate, fsConstants.F_OK);
  } catch {
    continue;
  }

  try {
    await fs.access(candidate, fsConstants.X_OK);
    process.exit(0);
  } catch {
    const stat = await fs.stat(candidate);
    await fs.chmod(candidate, stat.mode | 0o111);
    process.exit(0);
  }
}
