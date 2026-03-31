import path from "node:path";
import { fileURLToPath } from "node:url";

import { app, BrowserWindow, ipcMain } from "electron";

import { DesktopSessionController } from "./session-controller.js";
import type { DesktopSubmitPayload } from "./contracts.js";
import type { ProviderName } from "../types.js";
import { createOicqSession } from "../native/session-store.js";

interface ParsedDesktopArgs {
  sessionDir?: string;
  provider: ProviderName;
  cwd: string;
  realMode: boolean;
  extraPrompt?: string;
  providerArgs: string[];
}

function printDesktopHelp(): void {
  console.log(`
oicq

Usage:
  oicq [--provider claude|codex] [--cwd PATH] [-real|--real] [--extra-prompt TEXT] [-- PROVIDER_ARGS...]
  oicq --session-dir PATH --provider claude|codex [--cwd PATH] [-real|--real] [--extra-prompt TEXT] [--provider-args-json JSON]

Notes:
  - Packaged desktop builds always run in desktop editor mode.
  - When --session-dir is omitted, OICQ creates a fresh desktop session automatically.
`.trim());
}

function parseArgs(argv: string[]): ParsedDesktopArgs {
  let sessionDir: string | undefined;
  let provider: ProviderName = "claude";
  let cwd = process.cwd();
  let realMode = false;
  let extraPrompt: string | undefined;
  let providerArgs: string[] = [];
  let providerPassthroughMode = false;

  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (value === "--") {
      providerPassthroughMode = true;
      continue;
    }
    if (providerPassthroughMode) {
      providerArgs.push(value);
      continue;
    }
    if (value === "--help" || value === "-h") {
      printDesktopHelp();
      app.exit(0);
      process.exit(0);
    }
    if (value === "--session-dir") {
      sessionDir = path.resolve(argv[index + 1] ?? "");
      index += 1;
      continue;
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
    if (value === "--provider-args-json") {
      providerArgs = JSON.parse(argv[index + 1] ?? "[]") as string[];
      index += 1;
      continue;
    }
    providerArgs.push(value);
  }

  return {
    sessionDir,
    provider,
    cwd,
    realMode,
    extraPrompt,
    providerArgs,
  };
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  await app.whenReady();
  const sessionDir = args.sessionDir
    ?? (await createOicqSession(args.provider, args.cwd, "desktop", args.realMode)).sessionDir;

  const preloadPath = fileURLToPath(new URL("./preload.cjs", import.meta.url));
  const rendererHtmlPath = path.join(path.dirname(fileURLToPath(import.meta.url)), "renderer", "index.html");

  const window = new BrowserWindow({
    show: false,
    width: 1680,
    height: 1020,
    minWidth: 1200,
    minHeight: 760,
    title: `OICQ (${args.provider})`,
    backgroundColor: "#101114",
    autoHideMenuBar: true,
    acceptFirstMouse: true,
    webPreferences: {
      preload: preloadPath,
      contextIsolation: true,
      nodeIntegration: false,
      spellcheck: false,
    },
  });

  const controller = new DesktopSessionController({
    sessionDir,
    provider: args.provider,
    cwd: args.cwd,
    realMode: args.realMode,
    extraPrompt: args.extraPrompt,
    providerArgs: args.providerArgs,
  });

  window.webContents.on("did-fail-load", (_event, code, description) => {
    console.error(`[oicq/desktop] renderer failed to load: ${code} ${description}`);
  });
  window.webContents.on("render-process-gone", (_event, details) => {
    console.error(`[oicq/desktop] renderer process gone: ${details.reason}`);
  });
  window.webContents.on("console-message", (_event, level, message, line, sourceId) => {
    if (level < 2) {
      return;
    }
    if (message.includes("ResizeObserver loop completed")) {
      return;
    }
    if (message.includes("Electron Security Warning")) {
      return;
    }
    console.error(`[oicq/renderer:${level}] ${sourceId}:${line} ${message}`);
  });

  ipcMain.handle("oicq:get-state", async () => await controller.getState());
  ipcMain.handle("oicq:submit-task", async (_event, payload: DesktopSubmitPayload) => await controller.submitTask(payload));
  ipcMain.handle("oicq:attach-terminal", async () => {
    controller.attachTerminal();
  });
  ipcMain.on("oicq:terminal-input", (_event, data: string) => {
    controller.sendTerminalInput(data);
  });
  ipcMain.on("oicq:terminal-resize", (_event, payload: { cols: number; rows: number }) => {
    controller.resizeTerminal(payload.cols, payload.rows);
  });

  window.on("close", () => {
    controller.detachWindow();
  });
  window.on("closed", () => {
    void controller.stop();
  });

  await window.loadFile(rendererHtmlPath);
  await controller.start(window);
  app.focus({ steal: true });
  window.show();
  window.focus();
  window.webContents.focus();

  app.on("window-all-closed", () => {
    app.quit();
  });
  app.on("before-quit", () => {
    void controller.stop();
  });
}

main().catch((error) => {
  console.error(`OICQ desktop error: ${error instanceof Error ? error.message : String(error)}`);
  app.exit(1);
});
