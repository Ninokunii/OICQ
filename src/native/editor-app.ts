import blessed from "blessed";

import {
  composeTaskFile,
  deleteForward,
  ensureCursorVisible,
  getEditableEndLine,
  getEditableStartLine,
  getRenderedLines,
  insertNewline,
  insertText,
  jumpCursor,
  loadTask,
  moveCursor,
  writeTaskToDisk,
  backspace,
} from "../core/editor.js";
import { ansi, color, highlightLine } from "../core/languages.js";
import {
  readActiveRequest,
  readOicqSession,
  updateOicqSession,
  writeActiveResult,
} from "./session-store.js";
import type {
  ActiveTask,
  OicqSessionMeta,
  OicqToolRequestRecord,
} from "../types.js";

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

export class OicqEditorApp {
  private readonly screen: blessed.Widgets.Screen;
  private readonly headerBox: blessed.Widgets.BoxElement;
  private readonly infoBox: blessed.Widgets.BoxElement;
  private readonly codeBox: blessed.Widgets.BoxElement;
  private readonly noteBox: blessed.Widgets.BoxElement;
  private readonly footerBox: blessed.Widgets.BoxElement;

  private session?: OicqSessionMeta;
  private activeRecord?: OicqToolRequestRecord;
  private activeTask?: ActiveTask;
  private submittedRequestId?: string;
  private noteBuffer = "";
  private focus: "editor" | "note" = "editor";
  private footerStatus = "Waiting for an OICQ task...";
  private refreshTimer?: NodeJS.Timeout;

  constructor(private readonly sessionDir: string) {
    this.screen = blessed.screen({
      smartCSR: true,
      fullUnicode: true,
      dockBorders: true,
      title: "OICQ Editor",
    });

    this.headerBox = blessed.box({ top: 0, left: 0, width: "100%", height: 1 });
    this.infoBox = blessed.box({
      top: 1,
      left: 0,
      width: "100%",
      height: 8,
      border: "line",
      padding: { left: 1, right: 1 },
    });
    this.codeBox = blessed.box({
      top: 9,
      left: 0,
      width: "100%",
      bottom: 5,
      border: "line",
      padding: { left: 1, right: 1 },
    });
    this.noteBox = blessed.box({
      left: 0,
      width: "100%",
      bottom: 1,
      height: 4,
      border: "line",
      padding: { left: 1, right: 1 },
    });
    this.footerBox = blessed.box({ left: 0, bottom: 0, width: "100%", height: 1 });

    this.screen.append(this.headerBox);
    this.screen.append(this.infoBox);
    this.screen.append(this.codeBox);
    this.screen.append(this.noteBox);
    this.screen.append(this.footerBox);

    this.installKeybindings();
  }

  async start(): Promise<void> {
    this.session = await readOicqSession(this.sessionDir);
    await updateOicqSession(this.sessionDir, {
      editorState: "open",
      editorUrl: undefined,
    });
    await this.refreshFromDisk();
    this.refreshTimer = setInterval(() => {
      void this.refreshFromDisk();
    }, 400);
    this.render();
  }

  private installKeybindings(): void {
    this.screen.on("keypress", (ch, key) => {
      if (key.full === "C-c") {
        this.shutdown();
        return;
      }

      if (key.full === "tab") {
        this.focus = this.focus === "editor" ? "note" : "editor";
        this.footerStatus = `Focus: ${this.focus}`;
        this.render();
        return;
      }

      if (key.full === "C-s") {
        void this.submit();
        return;
      }

      if (this.focus === "editor" && this.activeTask) {
        if (this.handleEditorKey(ch ?? "", key)) {
          this.render();
          return;
        }
      }

      if (this.handleNoteKey(ch ?? "", key)) {
        this.render();
      }
    });
  }

  private viewportHeight(): number {
    return Math.max(8, Number(this.screen.height) - 16);
  }

  private async refreshFromDisk(): Promise<void> {
    const nextRecord = await readActiveRequest(this.sessionDir);

    if (!nextRecord) {
      if (!this.activeTask) {
        this.footerStatus = "Waiting for an OICQ task...";
      }
      if (this.submittedRequestId) {
        this.submittedRequestId = undefined;
      }
      if (!this.activeRecord) {
        this.render();
        return;
      }
      this.activeRecord = undefined;
      this.activeTask = undefined;
      this.noteBuffer = "";
      this.focus = "editor";
      this.render();
      return;
    }

    if (this.submittedRequestId === nextRecord.id) {
      this.footerStatus = "Submission sent. Waiting for the agent to continue...";
      this.render();
      return;
    }

    if (this.activeRecord?.id === nextRecord.id) {
      this.render();
      return;
    }

    this.activeRecord = nextRecord;
    this.activeTask = await loadTask(nextRecord.cwd, nextRecord.request);
    this.noteBuffer = "";
    this.focus = "editor";
    this.footerStatus = `Task loaded: ${nextRecord.request.function_name}`;
    this.render();
  }

  private handleNoteKey(ch: string, key: blessed.Widgets.Events.IKeyEventArg): boolean {
    if (key.full === "backspace") {
      this.noteBuffer = this.noteBuffer.slice(0, -1);
      return true;
    }
    if (key.full === "C-u") {
      this.noteBuffer = "";
      return true;
    }
    if (!key.ctrl && !key.meta && ch) {
      this.noteBuffer += ch;
      return true;
    }
    return false;
  }

  private handleEditorKey(ch: string, key: blessed.Widgets.Events.IKeyEventArg): boolean {
    if (!this.activeTask) {
      return false;
    }

    const viewportHeight = this.viewportHeight();
    switch (key.full) {
      case "up":
        moveCursor(this.activeTask, -1, 0, viewportHeight);
        return true;
      case "down":
        moveCursor(this.activeTask, 1, 0, viewportHeight);
        return true;
      case "left":
        moveCursor(this.activeTask, 0, -1, viewportHeight);
        return true;
      case "right":
        moveCursor(this.activeTask, 0, 1, viewportHeight);
        return true;
      case "pageup":
        jumpCursor(this.activeTask, this.activeTask.cursorLine - viewportHeight, this.activeTask.cursorColumn, viewportHeight);
        return true;
      case "pagedown":
        jumpCursor(this.activeTask, this.activeTask.cursorLine + viewportHeight, this.activeTask.cursorColumn, viewportHeight);
        return true;
      case "home":
        jumpCursor(this.activeTask, this.activeTask.cursorLine, 0, viewportHeight);
        return true;
      case "end": {
        const lines = getRenderedLines(this.activeTask);
        jumpCursor(this.activeTask, this.activeTask.cursorLine, (lines[this.activeTask.cursorLine] ?? "").length, viewportHeight);
        return true;
      }
      case "enter":
        insertNewline(this.activeTask);
        ensureCursorVisible(this.activeTask, viewportHeight);
        return true;
      case "backspace":
        backspace(this.activeTask);
        ensureCursorVisible(this.activeTask, viewportHeight);
        return true;
      case "delete":
        deleteForward(this.activeTask);
        return true;
      default:
        break;
    }

    if (!key.ctrl && !key.meta && ch) {
      if (ch.length > 1 && !ch.includes("\n")) {
        this.footerStatus = "Paste blocked in OICQ editor";
        return true;
      }
      insertText(this.activeTask, ch === "\t" ? "  " : ch);
      ensureCursorVisible(this.activeTask, viewportHeight);
      return true;
    }

    return false;
  }

  private async submit(): Promise<void> {
    if (!this.activeTask || !this.activeRecord) {
      this.footerStatus = "No active task to submit";
      this.render();
      return;
    }

    const updatedFileText = composeTaskFile(this.activeTask);
    await writeTaskToDisk(this.activeTask);
    await writeActiveResult(this.sessionDir, {
      requestId: this.activeRecord.id,
      submittedAt: Date.now(),
      note: this.noteBuffer.trim(),
      updatedFileText,
    });
    this.submittedRequestId = this.activeRecord.id;
    this.footerStatus = "Submitted. Waiting for the agent...";
    this.render();
  }

  private renderHeader(): string {
    return `${color("OICQ Editor", ansi.bold)} session=${this.session?.id.slice(0, 8) ?? "none"} provider=${this.session?.provider ?? "unknown"} cwd=${this.session?.cwd ?? ""}`;
  }

  private renderInfo(): string {
    if (!this.activeRecord) {
      return [
        color("Waiting", ansi.gray),
        "",
        "This pane will automatically open the next function task when the native Claude/Codex session calls the OICQ MCP tool.",
      ].join("\n");
    }

    const constraints = this.activeRecord.request.constraints?.length
      ? this.activeRecord.request.constraints.map((item) => `- ${item}`).join("\n")
      : "- none";

    return [
      `${color("Function", ansi.bold)} ${this.activeRecord.request.function_name}`,
      `File: ${this.activeRecord.request.file_path}`,
      `Kind: ${this.activeRecord.request.kind}`,
      "",
      this.activeRecord.request.instructions,
      constraints,
    ].join("\n");
  }

  private renderCode(): string {
    if (!this.activeTask) {
      return color("No active task.", ansi.gray);
    }

    const lines = getRenderedLines(this.activeTask);
    const digits = String(lines.length).length;
    const viewportHeight = this.viewportHeight();
    ensureCursorVisible(this.activeTask, viewportHeight);
    const visibleLines = lines.slice(this.activeTask.scrollLine, this.activeTask.scrollLine + viewportHeight);

    return visibleLines
      .map((line, index) => {
        const absoluteLine = this.activeTask!.scrollLine + index;
        const editable = absoluteLine >= getEditableStartLine(this.activeTask!) && absoluteLine <= getEditableEndLine(this.activeTask!);
        const marker = absoluteLine === this.activeTask!.cursorLine
          ? color(">", editable ? ansi.green : ansi.yellow)
          : editable
            ? color("|", ansi.yellow)
            : " ";
        const lineNo = color(String(absoluteLine + 1).padStart(digits, " "), editable ? ansi.yellow : ansi.gray);

        let body = line.replace(/\t/g, "  ");
        if (absoluteLine === this.activeTask!.cursorLine && this.focus === "editor") {
          const cursorColumn = clamp(this.activeTask!.cursorColumn, 0, body.length);
          const cursorChar = body[cursorColumn] ?? " ";
          body = `${highlightLine(body.slice(0, cursorColumn), this.activeTask!.language)}${ansi.reverse}${cursorChar}${ansi.reset}${highlightLine(body.slice(cursorColumn + 1), this.activeTask!.language)}`;
        } else {
          body = highlightLine(body, this.activeTask!.language);
        }

        return `${marker} ${lineNo} ${body}`;
      })
      .join("\n");
  }

  private renderNote(): string {
    const title = this.focus === "note" ? color("NOTE", ansi.green) : color("NOTE", ansi.gray);
    const cursor = this.focus === "note" ? `${ansi.reverse} ${ansi.reset}` : "";
    return `${title}\n> ${this.noteBuffer}${cursor}\n${color("Tab switches focus. Ctrl+S submits the current implementation.", ansi.gray)}`;
  }

  private renderFooter(): string {
    return `${this.footerStatus} | Tab focus | Ctrl+S submit | Arrow keys move | Ctrl+C quit`;
  }

  private render(): void {
    this.headerBox.setContent(this.renderHeader());
    this.infoBox.setContent(this.renderInfo());
    this.codeBox.setContent(this.renderCode());
    this.noteBox.setContent(this.renderNote());
    this.footerBox.setContent(this.renderFooter());
    this.screen.render();
  }

  private shutdown(): void {
    if (this.refreshTimer) {
      clearInterval(this.refreshTimer);
    }
    void updateOicqSession(this.sessionDir, {
      editorState: "closed",
      editorUrl: undefined,
    }).catch(() => undefined);
    this.screen.destroy();
    process.exit(0);
  }
}
