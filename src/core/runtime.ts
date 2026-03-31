import fs from "node:fs";
import path from "node:path";

import type { ProviderName } from "../types.js";

function executableCandidates(command: string): string[] {
  if (process.platform !== "win32") {
    return [command];
  }

  const pathExt = (process.env.PATHEXT ?? ".EXE;.CMD;.BAT;.COM")
    .split(";")
    .filter(Boolean);

  if (/\.[^./\\]+$/.test(command)) {
    return [command];
  }

  return [
    command,
    ...pathExt.map((ext) => `${command}${ext}`),
    ...pathExt.map((ext) => `${command}${ext.toLowerCase()}`),
  ];
}

export function resolveExecutable(command: string): string | undefined {
  if (path.isAbsolute(command) && fs.existsSync(command)) {
    return command;
  }

  const entries = (process.env.PATH ?? "")
    .split(path.delimiter)
    .filter(Boolean);

  for (const entry of entries) {
    for (const candidate of executableCandidates(command)) {
      const fullPath = path.join(entry, candidate);
      if (fs.existsSync(fullPath)) {
        return fullPath;
      }
    }
  }

  if (process.platform === "darwin") {
    const homebrewPath = `/opt/homebrew/bin/${command}`;
    if (fs.existsSync(homebrewPath)) {
      return homebrewPath;
    }
  }

  return undefined;
}

export function validateWorkspace(cwd: string): void {
  let stats: fs.Stats;
  try {
    stats = fs.statSync(cwd);
  } catch {
    throw new Error(`Workspace does not exist: ${cwd}`);
  }

  if (!stats.isDirectory()) {
    throw new Error(`Workspace is not a directory: ${cwd}`);
  }
}

export function ensureProviderBinary(provider: ProviderName): string {
  const binary = resolveExecutable(provider);
  if (!binary) {
    throw new Error(
      `Could not find '${provider}' in PATH. Install the ${provider} CLI or launch OICQ from a shell where '${provider}' is available.`,
    );
  }
  return binary;
}
