import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawn, spawnSync } from "node:child_process";

import { readOicqSession, updateOicqSession } from "./session-store.js";
import { resolveExecutable } from "../core/runtime.js";
import type { OicqSessionMeta } from "../types.js";

function currentScriptPath(): string {
  return fileURLToPath(new URL("../index.js", import.meta.url));
}

function posixQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

function powerShellQuote(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

function posixCommandLine(command: string, args: string[], cwd: string): string {
  return `cd ${posixQuote(cwd)} && ${[command, ...args].map(posixQuote).join(" ")}`;
}

function powerShellCommandLine(command: string, args: string[], cwd: string): string {
  return `Set-Location -LiteralPath ${powerShellQuote(cwd)}; & ${[command, ...args].map(powerShellQuote).join(" ")}`;
}

function editorArgs(session: OicqSessionMeta): string[] {
  return [currentScriptPath(), "editor", "--session-dir", session.sessionDir];
}

function webEditorArgs(session: OicqSessionMeta): string[] {
  return [currentScriptPath(), "web-editor", "--session-dir", session.sessionDir];
}

function resolveWindowsShell(): string | undefined {
  return resolveExecutable("pwsh") ?? resolveExecutable("powershell");
}

function tryOpenTmuxPane(editorCommand: string, cwd: string): boolean {
  if (!process.env.TMUX) {
    return false;
  }

  const tmux = resolveExecutable("tmux");
  if (!tmux) {
    return false;
  }

  const result = spawnSync(tmux, ["split-window", "-h", "-p", "40", "-c", cwd, editorCommand], { encoding: "utf8" });
  return result.status === 0;
}

function tryOpenWeztermPane(session: OicqSessionMeta): boolean {
  if (!process.env.WEZTERM_PANE) {
    return false;
  }

  const wezterm = resolveExecutable("wezterm");
  if (!wezterm) {
    return false;
  }

  const result = spawnSync(
    wezterm,
    [
      "cli",
      "split-pane",
      "--right",
      "--percent",
      "40",
      "--cwd",
      session.cwd,
      process.execPath,
      ...editorArgs(session),
    ],
    { encoding: "utf8" },
  );
  return result.status === 0;
}

function tryOpenItermSplit(editorCommand: string): boolean {
  if (process.platform !== "darwin" || process.env.TERM_PROGRAM !== "iTerm.app") {
    return false;
  }

  const osascript = resolveExecutable("osascript");
  if (!osascript) {
    return false;
  }

  const script = `
tell application "iTerm"
  activate
  tell current window
    tell current session
      set rightPane to (split vertically with default profile)
      tell rightPane
        write text ${JSON.stringify(editorCommand)}
      end tell
    end tell
  end tell
end tell
`;

  const result = spawnSync(osascript, ["-e", script], { encoding: "utf8" });
  return result.status === 0;
}

function tryOpenWindowsTerminalPane(editorCommand: string, cwd: string): boolean {
  if (process.platform !== "win32" || !process.env.WT_SESSION) {
    return false;
  }

  const wt = resolveExecutable("wt");
  const shell = resolveWindowsShell();
  if (!wt || !shell) {
    return false;
  }

  const result = spawnSync(
    wt,
    ["-w", "0", "split-pane", "-H", "-d", cwd, shell, "-NoExit", "-Command", editorCommand],
    { encoding: "utf8" },
  );
  return result.status === 0;
}

function tryOpenMacEditorWindow(editorCommand: string): boolean {
  if (process.platform !== "darwin") {
    return false;
  }

  const osascript = resolveExecutable("osascript");
  if (!osascript) {
    return false;
  }

  const script = `
tell application "Terminal"
  activate
  do script ${JSON.stringify(editorCommand)}
end tell
`;
  const result = spawnSync(osascript, ["-e", script], { encoding: "utf8" });
  return result.status === 0;
}

function tryOpenWindowsEditorWindow(session: OicqSessionMeta, editorCommand: string): boolean {
  if (process.platform !== "win32") {
    return false;
  }

  const wt = resolveExecutable("wt");
  const shell = resolveWindowsShell();
  if (wt && shell) {
    const result = spawnSync(
      wt,
      ["new-tab", "-d", session.cwd, shell, "-NoExit", "-Command", editorCommand],
      { encoding: "utf8" },
    );
    return result.status === 0;
  }

  if (shell) {
    const argList = editorArgs(session).map((item) => powerShellQuote(item)).join(", ");
    const result = spawnSync(
      shell,
      [
        "-NoProfile",
        "-Command",
        `Start-Process -WorkingDirectory ${powerShellQuote(session.cwd)} -FilePath ${powerShellQuote(process.execPath)} -ArgumentList @(${argList})`,
      ],
      { encoding: "utf8" },
    );
    return result.status === 0;
  }

  return false;
}

function openTuiEditor(session: OicqSessionMeta): boolean {
  const posixEditorCommand = posixCommandLine(process.execPath, editorArgs(session), session.cwd);
  const windowsEditorCommand = powerShellCommandLine(process.execPath, editorArgs(session), session.cwd);

  if (tryOpenTmuxPane(posixEditorCommand, session.cwd)) {
    return true;
  }
  if (tryOpenWeztermPane(session)) {
    return true;
  }
  if (tryOpenItermSplit(posixEditorCommand)) {
    return true;
  }
  if (tryOpenWindowsTerminalPane(windowsEditorCommand, session.cwd)) {
    return true;
  }
  if (tryOpenMacEditorWindow(posixEditorCommand)) {
    return true;
  }
  if (tryOpenWindowsEditorWindow(session, windowsEditorCommand)) {
    return true;
  }

  console.error(
    `[oicq] could not open the TUI editor automatically. Run this in another terminal: ${process.execPath} ${currentScriptPath()} editor --session-dir ${session.sessionDir}`,
  );
  return false;
}

function launchWebEditorServer(session: OicqSessionMeta): boolean {
  const child = spawn(process.execPath, webEditorArgs(session), {
    cwd: session.cwd,
    env: process.env,
    detached: true,
    stdio: "ignore",
  });
  child.on("error", () => {
    void updateOicqSession(session.sessionDir, {
      editorState: "closed",
      editorUrl: undefined,
    }).catch(() => undefined);
  });
  child.on("close", () => {
    void updateOicqSession(session.sessionDir, {
      editorState: "closed",
      editorUrl: undefined,
    }).catch(() => undefined);
  });
  child.unref();
  return true;
}

export async function ensureEditorSidecar(sessionDir: string): Promise<void> {
  const session = await readOicqSession(sessionDir);
  if (session.editorState === "open" || session.editorState === "launching") {
    return;
  }

  if (session.editorMode === "desktop") {
    await updateOicqSession(sessionDir, {
      editorState: "open",
      editorUrl: undefined,
    });
    return;
  }

  await updateOicqSession(sessionDir, {
    editorState: "launching",
  });

  const launched = session.editorMode === "web"
    ? launchWebEditorServer(session)
    : openTuiEditor(session);

  if (!launched) {
    await updateOicqSession(sessionDir, {
      editorState: "closed",
      editorUrl: undefined,
    });
  }
}

export function openUrl(url: string): void {
  if (process.platform === "darwin") {
    const open = resolveExecutable("open");
    if (open) {
      const child = spawn(open, [url], {
        detached: true,
        stdio: "ignore",
      });
      child.unref();
      return;
    }
  }

  if (process.platform === "win32") {
    const cmd = process.env.COMSPEC ?? "cmd.exe";
    const child = spawn(cmd, ["/c", "start", "", url], {
      detached: true,
      stdio: "ignore",
      windowsVerbatimArguments: true,
    });
    child.unref();
    return;
  }

  const xdgOpen = resolveExecutable("xdg-open");
  if (xdgOpen) {
    const child = spawn(xdgOpen, [url], {
      detached: true,
      stdio: "ignore",
    });
    child.unref();
  }
}

export function sessionRootCommand(session: OicqSessionMeta, commandName: "editor" | "web-editor"): string {
  return `${process.execPath} ${path.normalize(currentScriptPath())} ${commandName} --session-dir ${session.sessionDir}`;
}
