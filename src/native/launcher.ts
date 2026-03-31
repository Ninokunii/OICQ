import fs from "node:fs/promises";
import { constants as fsConstants } from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { spawn, spawnSync } from "node:child_process";

import { createOicqSession } from "./session-store.js";
import {
  OICQ_MCP_SERVER_NAME,
  buildCodexBootstrapPrompt,
  buildOicqNativePrompt,
} from "./prompts.js";
import { ensureProviderBinary, resolveExecutable } from "../core/runtime.js";
import type { OicqEditorMode, ProviderName } from "../types.js";

export interface LaunchOptions {
  provider: ProviderName;
  cwd: string;
  realMode: boolean;
  extraPrompt?: string;
  editorMode: OicqEditorMode;
  providerArgs: string[];
}

export interface ProviderLaunchSpec {
  command: string;
  args: string[];
  cwd: string;
  env?: NodeJS.ProcessEnv;
}

const require = createRequire(import.meta.url);
const CODEX_MCP_STARTUP_TIMEOUT_SEC = 30;
const CODEX_MCP_TOOL_TIMEOUT_SEC = 604800;

function currentScriptPath(): string {
  return fileURLToPath(new URL("../index.js", import.meta.url));
}

function oicqNodeExecPath(): string {
  const fromEnv = process.env.OICQ_NODE_EXEC;
  if (fromEnv) {
    return fromEnv;
  }

  if (!process.versions.electron) {
    return process.execPath;
  }

  const resolvedNode = resolveExecutable("node");
  if (resolvedNode) {
    return resolvedNode;
  }

  throw new Error("Could not resolve a Node.js executable for launching the OICQ MCP server.");
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function upsertTomlNumber(sectionText: string, key: string, value: number): string {
  const nextLine = `${key} = ${value}`;
  const pattern = new RegExp(`^${escapeRegExp(key)}\\s*=.*$`, "m");
  if (pattern.test(sectionText)) {
    return sectionText.replace(pattern, nextLine);
  }

  const normalized = sectionText.replace(/\s*$/, "");
  return `${normalized}\n${nextLine}\n`;
}

async function configureCodexMcpTimeouts(homeRoot: string, serverName: string): Promise<void> {
  const configPath = path.join(homeRoot, ".codex", "config.toml");
  const configText = await fs.readFile(configPath, "utf8");
  const sectionPattern = new RegExp(
    String.raw`\[mcp_servers\.${escapeRegExp(serverName)}\][\s\S]*?(?=\n\[|$)`,
  );
  const existingSection = configText.match(sectionPattern)?.[0];
  if (!existingSection) {
    throw new Error(`Could not find [mcp_servers.${serverName}] in ${configPath}`);
  }

  let updatedSection = existingSection;
  updatedSection = upsertTomlNumber(updatedSection, "startup_timeout_sec", CODEX_MCP_STARTUP_TIMEOUT_SEC);
  updatedSection = upsertTomlNumber(updatedSection, "tool_timeout_sec", CODEX_MCP_TOOL_TIMEOUT_SEC);

  const nextConfigText = configText.replace(sectionPattern, updatedSection);
  await fs.writeFile(configPath, nextConfigText, "utf8");
}

async function writeClaudeMcpConfig(sessionDir: string): Promise<string> {
  const configPath = path.join(sessionDir, "claude.mcp.json");
  const config = {
    mcpServers: {
      [OICQ_MCP_SERVER_NAME]: {
        type: "stdio",
        command: oicqNodeExecPath(),
        args: [currentScriptPath(), "mcp-server", "--session-dir", sessionDir],
      },
    },
  };
  await fs.writeFile(configPath, JSON.stringify(config, null, 2), "utf8");
  return configPath;
}

async function prepareCodexHome(sessionDir: string, cwd: string): Promise<string> {
  const homeRoot = path.join(sessionDir, "codex-home");
  const codexDir = path.join(homeRoot, ".codex");
  await fs.mkdir(codexDir, { recursive: true });

  for (const fileName of ["auth.json", "config.toml"]) {
    const sourcePath = path.join(process.env.HOME ?? "", ".codex", fileName);
    const targetPath = path.join(codexDir, fileName);
    try {
      await fs.copyFile(sourcePath, targetPath, fsConstants.COPYFILE_FICLONE);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
        throw error;
      }
    }
  }

  const env = {
    ...process.env,
    HOME: homeRoot,
  };

  const add = spawnSync(
    ensureProviderBinary("codex"),
    [
      "mcp",
      "add",
      OICQ_MCP_SERVER_NAME,
      "--",
      oicqNodeExecPath(),
      currentScriptPath(),
      "mcp-server",
      "--session-dir",
      sessionDir,
    ],
    {
      cwd,
      env,
      encoding: "utf8",
    },
  );

  if (add.status !== 0) {
    throw new Error(add.stderr || add.stdout || "Failed to register OICQ MCP server for Codex");
  }

  await configureCodexMcpTimeouts(homeRoot, OICQ_MCP_SERVER_NAME);

  return homeRoot;
}

async function writeCodexInstructionsFile(
  sessionDir: string,
  extraPrompt?: string,
  realMode = false,
): Promise<string> {
  const filePath = path.join(sessionDir, "codex-model-instructions.md");
  await fs.writeFile(filePath, buildCodexBootstrapPrompt(extraPrompt, realMode), "utf8");
  return filePath;
}

function spawnSameTerminal(command: string, args: string[], cwd: string, env?: NodeJS.ProcessEnv): Promise<number | null> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd,
      env,
      stdio: "inherit",
    });
    child.on("error", reject);
    child.on("close", (code) => resolve(code));
  });
}

function normalizeDangerousProviderArgs(provider: ProviderName, providerArgs: string[]): string[] {
  const normalized: string[] = [];
  let dangerousMode = false;

  for (const value of providerArgs) {
    if (value === "yolo" || value === "--yolo") {
      dangerousMode = true;
      continue;
    }
    if (value === "--dangerously-skip-permissions" || value === "--dangerously-bypass-approvals-and-sandbox") {
      dangerousMode = true;
      continue;
    }
    normalized.push(value);
  }

  if (dangerousMode) {
    normalized.unshift(
      provider === "claude"
        ? "--dangerously-skip-permissions"
        : "--dangerously-bypass-approvals-and-sandbox",
    );
  }

  return normalized;
}

async function createClaudeLaunchSpec(
  sessionDir: string,
  cwd: string,
  realMode = false,
  extraPrompt?: string,
  providerArgs: string[] = [],
): Promise<ProviderLaunchSpec> {
  const configPath = await writeClaudeMcpConfig(sessionDir);
  const cli = ensureProviderBinary("claude");
  const args = [
    ...normalizeDangerousProviderArgs("claude", providerArgs),
    "--mcp-config",
    configPath,
    "--strict-mcp-config",
    "--append-system-prompt",
    buildOicqNativePrompt(extraPrompt, realMode),
  ];
  return { command: cli, args, cwd };
}

async function createCodexLaunchSpec(
  sessionDir: string,
  cwd: string,
  realMode = false,
  extraPrompt?: string,
  providerArgs: string[] = [],
): Promise<ProviderLaunchSpec> {
  const codexHome = await prepareCodexHome(sessionDir, cwd);
  const instructionsPath = await writeCodexInstructionsFile(sessionDir, extraPrompt, realMode);
  const cli = ensureProviderBinary("codex");
  const env = {
    ...process.env,
    HOME: codexHome,
  };
  return {
    command: cli,
    args: [
      ...normalizeDangerousProviderArgs("codex", providerArgs),
      "-c",
      `mcp_servers.${OICQ_MCP_SERVER_NAME}.startup_timeout_sec=${CODEX_MCP_STARTUP_TIMEOUT_SEC}`,
      "-c",
      `mcp_servers.${OICQ_MCP_SERVER_NAME}.tool_timeout_sec=${CODEX_MCP_TOOL_TIMEOUT_SEC}`,
      "-c",
      `model_instructions_file=${JSON.stringify(instructionsPath)}`,
    ],
    cwd,
    env,
  };
}

export async function createProviderLaunchSpec(
  provider: ProviderName,
  sessionDir: string,
  cwd: string,
  realMode = false,
  extraPrompt?: string,
  providerArgs: string[] = [],
): Promise<ProviderLaunchSpec> {
  return provider === "claude"
    ? await createClaudeLaunchSpec(sessionDir, cwd, realMode, extraPrompt, providerArgs)
    : await createCodexLaunchSpec(sessionDir, cwd, realMode, extraPrompt, providerArgs);
}

async function launchLegacyNative(sessionDir: string, options: LaunchOptions): Promise<number | null> {
  const spec = await createProviderLaunchSpec(
    options.provider,
    sessionDir,
    options.cwd,
    options.realMode,
    options.extraPrompt,
    options.providerArgs,
  );
  return await spawnSameTerminal(spec.command, spec.args, spec.cwd, spec.env);
}

function electronBinaryPath(): string {
  return require("electron") as string;
}

async function launchDesktopApp(sessionDir: string, options: LaunchOptions): Promise<number | null> {
  const electron = electronBinaryPath();
  const desktopMainPath = fileURLToPath(new URL("../desktop/main.js", import.meta.url));
  const args = [
    desktopMainPath,
    "--session-dir",
    sessionDir,
    "--provider",
    options.provider,
    "--cwd",
    options.cwd,
    "--provider-args-json",
    JSON.stringify(options.providerArgs),
  ];

  if (options.realMode) {
    args.push("--real");
  }

  if (options.extraPrompt) {
    args.push("--extra-prompt", options.extraPrompt);
  }

  return await spawnSameTerminal(electron, args, options.cwd, {
    ...process.env,
    OICQ_NODE_EXEC: oicqNodeExecPath(),
  });
}

export async function launchOicqNative(options: LaunchOptions): Promise<void> {
  const session = await createOicqSession(options.provider, options.cwd, options.editorMode, options.realMode);
  console.error(`[oicq] session ${session.id} created in ${session.sessionDir}`);

  const code = options.editorMode === "desktop"
    ? await launchDesktopApp(session.sessionDir, options)
    : await launchLegacyNative(session.sessionDir, options);

  process.exit(code ?? 0);
}
