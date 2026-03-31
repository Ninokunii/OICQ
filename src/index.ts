#!/usr/bin/env node

import path from "node:path";

import { OicqEditorApp } from "./native/editor-app.js";
import { launchOicqNative } from "./native/launcher.js";
import { readOicqSession } from "./native/session-store.js";
import { startOicqMcpServer } from "./mcp/server.js";
import { startOicqWebEditor } from "./web/editor-server.js";
import { ensureProviderBinary, validateWorkspace } from "./core/runtime.js";
import type { OicqEditorMode, ProviderName } from "./types.js";

type CommandName = "launch" | "editor" | "web-editor" | "mcp-server";

interface ParsedCommonArgs {
  command: CommandName;
  provider: ProviderName;
  editorMode: OicqEditorMode;
  cwd: string;
  realMode: boolean;
  extraPrompt?: string;
  sessionDir?: string;
  providerArgs: string[];
}

const OICQ_FLAGS = new Set([
  "--help",
  "-h",
  "--provider",
  "--editor",
  "--cwd",
  "--real",
  "-real",
  "--extra-prompt",
  "--session-dir",
]);

const INLINE_PROVIDER_FLAGS = new Set([
  "--dangerously-skip-permissions",
  "--dangerously-bypass-approvals-and-sandbox",
  "--yolo",
]);

function printHelp(): void {
  console.log(`
oicq

Usage:
  oicq [--provider claude|codex] [--editor desktop|web|tui] [--cwd PATH] [-real|--real] [--extra-prompt TEXT] [-- PROVIDER_ARGS...]
  oicq launch [--provider claude|codex] [--editor desktop|web|tui] [--cwd PATH] [-real|--real] [--extra-prompt TEXT] [-- PROVIDER_ARGS...]
  oicq editor --session-dir PATH
  oicq web-editor --session-dir PATH
  oicq mcp-server --session-dir PATH

Default command:
  launch
`.trim());
}

function parseArgs(argv: string[]): ParsedCommonArgs {
  let command: CommandName = "launch";
  let provider: ProviderName = "claude";
  let editorMode: OicqEditorMode = "desktop";
  let cwd = process.cwd();
  let realMode = false;
  let extraPrompt: string | undefined;
  let sessionDir: string | undefined;
  const providerArgs: string[] = [];
  let providerPassthroughMode = false;

  let startIndex = 0;
  if (argv[0] === "launch" || argv[0] === "editor" || argv[0] === "web-editor" || argv[0] === "mcp-server") {
    command = argv[0];
    startIndex = 1;
  }

  for (let index = startIndex; index < argv.length; index += 1) {
    const value = argv[index];
    if (value === "--") {
      providerPassthroughMode = true;
      continue;
    }
    if (providerPassthroughMode) {
      if (OICQ_FLAGS.has(value)) {
        providerPassthroughMode = false;
        index -= 1;
        continue;
      }
      providerArgs.push(value);
      continue;
    }
    if (value === "--help" || value === "-h") {
      printHelp();
      process.exit(0);
    }
    if (value === "--provider") {
      const next = argv[index + 1];
      if (next !== "claude" && next !== "codex") {
        throw new Error("--provider must be claude or codex");
      }
      provider = next;
      index += 1;
      continue;
    }
    if (value === "--editor") {
      const next = argv[index + 1];
      if (next !== "desktop" && next !== "web" && next !== "tui") {
        throw new Error("--editor must be desktop, web, or tui");
      }
      editorMode = next;
      index += 1;
      continue;
    }
    if (value === "--cwd") {
      cwd = path.resolve(argv[index + 1] ?? process.cwd());
      index += 1;
      continue;
    }
    if (value === "--real" || value === "-real") {
      realMode = true;
      continue;
    }
    if (value === "--extra-prompt") {
      extraPrompt = argv[index + 1] ?? "";
      index += 1;
      continue;
    }
    if (value === "--session-dir") {
      sessionDir = path.resolve(argv[index + 1] ?? "");
      index += 1;
      continue;
    }
    if (INLINE_PROVIDER_FLAGS.has(value) || value === "yolo") {
      providerArgs.push(value);
      continue;
    }
    throw new Error(`Unknown argument: ${value}`);
  }

  return {
    command,
    provider,
    editorMode,
    cwd,
    realMode,
    extraPrompt,
    sessionDir,
    providerArgs,
  };
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));

  if (args.command === "launch") {
    validateWorkspace(args.cwd);
    ensureProviderBinary(args.provider);
    await launchOicqNative({
      provider: args.provider,
      editorMode: args.editorMode,
      cwd: args.cwd,
      realMode: args.realMode,
      extraPrompt: args.extraPrompt,
      providerArgs: args.providerArgs,
    });
    return;
  }

  if (!args.sessionDir) {
    throw new Error(`--session-dir is required for ${args.command}`);
  }

  if (args.command === "editor") {
    await readOicqSession(args.sessionDir);
    const app = new OicqEditorApp(args.sessionDir);
    await app.start();
    return;
  }

  if (args.command === "web-editor") {
    await readOicqSession(args.sessionDir);
    await startOicqWebEditor(args.sessionDir);
    return;
  }

  if (args.command === "mcp-server") {
    await readOicqSession(args.sessionDir);
    await startOicqMcpServer(args.sessionDir);
  }
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`OICQ error: ${message}`);
  process.exit(1);
});
