import type { BrowserWindow } from "electron";
import * as pty from "node-pty";

import { composeTaskFile, loadTask, writeTaskToDisk } from "../core/editor.js";
import {
  readActiveRequest,
  readOicqSession,
  updateOicqSession,
  writeActiveResult,
} from "../native/session-store.js";
import { createProviderLaunchSpec } from "../native/launcher.js";
import type { ProviderName } from "../types.js";
import type { ProviderLaunchSpec } from "../native/launcher.js";
import type {
  DesktopContextLine,
  DesktopStatePayload,
  DesktopSubmitPayload,
  DesktopTaskPayload,
} from "./contracts.js";
import { ensureNodePtySpawnHelperExecutable } from "./node-pty-runtime.js";

interface SessionControllerOptions {
  sessionDir: string;
  provider: ProviderName;
  cwd: string;
  realMode: boolean;
  extraPrompt?: string;
  providerArgs: string[];
}

function splitSubmittedText(value: string): string[] {
  const lines = value.replace(/\r\n/g, "\n").split("\n");
  return lines.length > 0 ? lines : [""];
}

function buildContextLines(lines: string[], startIndex: number, endIndex: number): DesktopContextLine[] {
  return lines.slice(startIndex, endIndex).map((text, offset) => ({
    lineNumber: startIndex + offset + 1,
    text,
  }));
}

function posixQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

function shellAndArgsForPty(spec: ProviderLaunchSpec): {
  command: string;
  args: string[];
  env: Record<string, string>;
} {
  const env = Object.fromEntries(
    Object.entries(spec.env ?? process.env).filter((entry): entry is [string, string] => typeof entry[1] === "string"),
  );

  if (process.platform === "win32") {
    const shell = env.COMSPEC || "cmd.exe";
    const commandLine = [spec.command, ...spec.args].map((part) => `"${part.replaceAll('"', '\\"')}"`).join(" ");
    return {
      command: shell,
      args: ["/d", "/s", "/c", commandLine],
      env,
    };
  }

  const shell = env.SHELL || (process.platform === "darwin" ? "/bin/zsh" : "/bin/bash");
  const commandLine = `exec ${[spec.command, ...spec.args].map(posixQuote).join(" ")}`;
  return {
    command: shell,
    args: ["-lc", commandLine],
    env,
  };
}

async function buildTaskPayload(sessionDir: string): Promise<DesktopTaskPayload | null> {
  const activeRecord = await readActiveRequest(sessionDir);
  if (!activeRecord) {
    return null;
  }

  const task = await loadTask(activeRecord.cwd, activeRecord.request);
  const startLine = task.request.kind === "implement_function_body"
    ? task.request.start_line!
    : task.request.insert_after_line! + 1;
  const endLine = startLine + task.bufferLines.length - 1;

  const beforeStart = Math.max(0, startLine - 7);
  const beforeEnd = Math.max(0, startLine - 1);
  const afterStart = Math.min(
    task.originalLines.length,
    task.request.kind === "implement_function_body" ? task.request.end_line! : task.request.insert_after_line!,
  );
  const afterEnd = Math.min(task.originalLines.length, afterStart + 6);

  return {
    requestId: activeRecord.id,
    filePath: task.displayPath,
    functionName: task.request.function_name,
    instructions: task.request.instructions,
    constraints: task.request.constraints ?? [],
    relatedCode: (task.request.related_code ?? []).map((block) => ({
      label: block.label,
      filePath: block.file_path,
      startLine: block.start_line,
      code: block.code,
    })),
    language: task.language,
    editableText: task.bufferLines.join(task.newline),
    startLine,
    endLine,
    contextBefore: buildContextLines(task.originalLines, beforeStart, beforeEnd),
    contextAfter: buildContextLines(task.originalLines, afterStart, afterEnd),
  };
}

export class DesktopSessionController {
  private terminal?: pty.IPty;
  private window?: BrowserWindow;
  private refreshTimer?: NodeJS.Timeout;
  private lastSerializedState?: string;
  private terminalDataListener?: pty.IDisposable;
  private terminalExitListener?: pty.IDisposable;
  private terminalClosed = false;
  private terminalAttached = false;
  private terminalBacklog: string[] = [];
  private lastTerminalExitCode?: number;

  public constructor(private readonly options: SessionControllerOptions) {}

  public async start(window: BrowserWindow): Promise<void> {
    this.window = window;

    await updateOicqSession(this.options.sessionDir, {
      editorMode: "desktop",
      editorState: "open",
      editorUrl: undefined,
    });

    await this.startTerminal();
    await this.pushState();

    this.refreshTimer = setInterval(() => {
      void this.pushState();
    }, 350);
  }

  public async stop(): Promise<void> {
    if (this.refreshTimer) {
      clearInterval(this.refreshTimer);
      this.refreshTimer = undefined;
    }

    this.detachWindow();
    this.disposeTerminalListeners();

    if (this.terminal) {
      try {
        this.terminal.kill();
      } catch {
        // ignore
      }
      this.terminal = undefined;
    }

    await updateOicqSession(this.options.sessionDir, {
      editorState: "closed",
      editorUrl: undefined,
    }).catch(() => undefined);
  }

  public detachWindow(): void {
    this.window = undefined;
    this.terminalAttached = false;
  }

  public sendTerminalInput(data: string): void {
    this.terminal?.write(data);
  }

  public resizeTerminal(cols: number, rows: number): void {
    if (!this.terminal || this.terminalClosed || cols <= 0 || rows <= 0) {
      return;
    }
    try {
      this.terminal.resize(cols, rows);
    } catch (error) {
      const errno = error as NodeJS.ErrnoException;
      if (errno.code === "EBADF") {
        this.terminalClosed = true;
        return;
      }
      throw error;
    }
  }

  public async getState(): Promise<DesktopStatePayload> {
    return await this.readState();
  }

  public attachTerminal(): void {
    this.terminalAttached = true;

    if (this.terminalBacklog.length > 0) {
      this.sendToWindow("oicq:terminal-data", this.terminalBacklog.join(""));
      this.terminalBacklog = [];
    }

    if (this.lastTerminalExitCode !== undefined) {
      this.sendToWindow("oicq:terminal-exit", { exitCode: this.lastTerminalExitCode });
    }
  }

  public async submitTask(payload: DesktopSubmitPayload): Promise<{ ok: true }> {
    const activeRecord = await readActiveRequest(this.options.sessionDir);
    if (!activeRecord || activeRecord.id !== payload.requestId) {
      throw new Error("Active request changed");
    }

    const task = await loadTask(activeRecord.cwd, activeRecord.request);
    task.bufferLines = splitSubmittedText(payload.editableText ?? "");
    const updatedFileText = composeTaskFile(task);
    await writeTaskToDisk(task);
    await writeActiveResult(this.options.sessionDir, {
      requestId: activeRecord.id,
      submittedAt: Date.now(),
      note: payload.note.trim(),
      updatedFileText,
    });
    await this.pushState(true);
    return { ok: true };
  }

  private async startTerminal(): Promise<void> {
    await ensureNodePtySpawnHelperExecutable();
    this.terminalClosed = false;
    this.lastTerminalExitCode = undefined;
    this.terminalBacklog = [];

    const spec = await createProviderLaunchSpec(
      this.options.provider,
      this.options.sessionDir,
      this.options.cwd,
      this.options.realMode,
      this.options.extraPrompt,
      this.options.providerArgs,
    );

    const shellSpec = shellAndArgsForPty(spec);

    this.terminal = pty.spawn(shellSpec.command, shellSpec.args, {
      name: "xterm-256color",
      cols: 120,
      rows: 32,
      cwd: spec.cwd,
      env: shellSpec.env,
    });

    this.disposeTerminalListeners();

    this.terminalDataListener = this.terminal.onData((data) => {
      if (this.terminalAttached) {
        this.sendToWindow("oicq:terminal-data", data);
        return;
      }
      this.terminalBacklog.push(data);
    });

    this.terminalExitListener = this.terminal.onExit(({ exitCode }) => {
      this.terminalClosed = true;
      this.lastTerminalExitCode = exitCode;
      if (this.terminalAttached) {
        this.sendToWindow("oicq:terminal-exit", { exitCode });
      }
    });
  }

  private async readState(): Promise<DesktopStatePayload> {
    const [session, activeTask] = await Promise.all([
      readOicqSession(this.options.sessionDir),
      buildTaskPayload(this.options.sessionDir),
    ]);

    return { session, activeTask };
  }

  private async pushState(force = false): Promise<void> {
    const state = await this.readState();
    const serialized = JSON.stringify(state);
    if (!force && serialized === this.lastSerializedState) {
      return;
    }
    this.lastSerializedState = serialized;
    this.sendToWindow("oicq:state", state);
  }

  private disposeTerminalListeners(): void {
    this.terminalDataListener?.dispose();
    this.terminalDataListener = undefined;
    this.terminalExitListener?.dispose();
    this.terminalExitListener = undefined;
  }

  private sendToWindow(channel: string, payload: unknown): void {
    const window = this.window;
    if (!window) {
      return;
    }

    try {
      if (window.isDestroyed() || window.webContents.isDestroyed()) {
        this.detachWindow();
        return;
      }

      window.webContents.send(channel, payload);
    } catch (error) {
      if (error instanceof Error && error.message.includes("Object has been destroyed")) {
        this.detachWindow();
        return;
      }
      throw error;
    }
  }
}
