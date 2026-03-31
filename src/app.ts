import fs from "node:fs/promises";

import blessed from "blessed";

import { createAgentClient } from "./adapters/index.js";
import {
  backspace,
  composeTaskFile,
  deleteForward,
  ensureCursorVisible,
  getBufferIndex,
  getEditableEndLine,
  getEditableStartLine,
  getRenderedLines,
  insertNewline,
  insertText,
  jumpCursor,
  loadTask,
  moveCursor,
  restoreFrozenFile,
  writeTaskToDisk,
} from "./core/editor.js";
import { ansi, color, highlightLine } from "./core/languages.js";
import { buildContinuePrompt, buildHostSystemPrompt, buildReviewPrompt, parseAssistantText } from "./core/protocol.js";
import type { ActiveTask, AppOptions, ChatMessage } from "./types.js";

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function shortId(value?: string): string {
  return value ? value.slice(0, 8) : "none";
}

function createMessage(role: ChatMessage["role"], text: string, pending = false): ChatMessage {
  return {
    id: `${Date.now()}-${Math.random().toString(16).slice(2, 8)}`,
    role,
    text,
    pending,
    timestamp: Date.now(),
  };
}

export class OicqApp {
  private readonly systemPrompt: string;
  private readonly agent;
  private readonly screen: blessed.Widgets.Screen;
  private readonly headerBox: blessed.Widgets.BoxElement;
  private readonly chatBox: blessed.Widgets.BoxElement;
  private readonly inputBox: blessed.Widgets.BoxElement;
  private readonly codeBox: blessed.Widgets.BoxElement;
  private readonly reviewBox: blessed.Widgets.BoxElement;
  private readonly footerBox: blessed.Widgets.BoxElement;

  private readonly messages: ChatMessage[] = [];
  private readonly cwd: string;
  private readonly provider: AppOptions["provider"];

  private inputBuffer = "";
  private focus: "input" | "editor" = "input";
  private busy = false;
  private turnQueue: Promise<void> = Promise.resolve();
  private activeTask?: ActiveTask;
  private footerStatus = "Ready";

  constructor(options: AppOptions) {
    this.cwd = options.cwd;
    this.provider = options.provider;
    this.systemPrompt = buildHostSystemPrompt(options.systemPrompt);
    this.agent = createAgentClient(options.provider, options.cwd, this.systemPrompt, options.commandPath);

    this.screen = blessed.screen({
      smartCSR: true,
      fullUnicode: true,
      dockBorders: true,
      title: `OICQ (${options.provider})`,
    });

    this.headerBox = blessed.box({
      top: 0,
      left: 0,
      width: "100%",
      height: 1,
    });

    this.chatBox = blessed.box({
      top: 1,
      left: 0,
      width: "50%",
      bottom: 5,
      border: "line",
      scrollable: true,
      alwaysScroll: true,
      keys: false,
      mouse: true,
      padding: {
        left: 1,
        right: 1,
      },
    });

    this.inputBox = blessed.box({
      left: 0,
      width: "50%",
      bottom: 1,
      height: 4,
      border: "line",
      padding: {
        left: 1,
        right: 1,
      },
    });

    this.codeBox = blessed.box({
      top: 1,
      left: "50%",
      width: "50%",
      bottom: 7,
      border: "line",
      scrollable: false,
      wrap: false,
      padding: {
        left: 1,
        right: 1,
      },
    });

    this.reviewBox = blessed.box({
      left: "50%",
      width: "50%",
      bottom: 1,
      height: 6,
      border: "line",
      padding: {
        left: 1,
        right: 1,
      },
    });

    this.footerBox = blessed.box({
      left: 0,
      bottom: 0,
      width: "100%",
      height: 1,
    });

    this.screen.append(this.headerBox);
    this.screen.append(this.chatBox);
    this.screen.append(this.inputBox);
    this.screen.append(this.codeBox);
    this.screen.append(this.reviewBox);
    this.screen.append(this.footerBox);

    this.installKeybindings();
    this.pushMessage("system", `OICQ started in ${this.cwd}`);
    this.pushMessage("system", `Provider: ${this.provider}. Codex support is best-effort; Claude is fully exercised in this workspace.`);
    this.render();
  }

  start(): void {
    this.render();
  }

  private installKeybindings(): void {
    this.screen.on("keypress", (_ch, key) => {
      if (key.full === "C-c") {
        this.shutdown();
        return;
      }

      if (key.full === "tab") {
        this.focus = this.focus === "input" ? "editor" : "input";
        this.footerStatus = `Focus: ${this.focus}`;
        this.render();
        return;
      }

      if (key.full === "C-s") {
        void this.submitTask();
        return;
      }

      if (this.focus === "editor" && this.activeTask) {
        if (this.handleEditorKey(_ch ?? "", key)) {
          this.render();
          return;
        }
      }

      if (this.handleInputKey(_ch ?? "", key)) {
        this.render();
      }
    });

    this.screen.on("resize", () => {
      if (this.activeTask) {
        ensureCursorVisible(this.activeTask, this.codeViewportHeight());
      }
      this.render();
    });
  }

  private handleInputKey(ch: string, key: blessed.Widgets.Events.IKeyEventArg): boolean {
    if (key.full === "enter") {
      void this.sendInput();
      return true;
    }
    if (key.full === "backspace") {
      this.inputBuffer = this.inputBuffer.slice(0, -1);
      return true;
    }
    if (key.full === "C-u") {
      this.inputBuffer = "";
      return true;
    }
    if (!key.ctrl && !key.meta && ch) {
      this.inputBuffer += ch;
      return true;
    }
    return false;
  }

  private handleEditorKey(ch: string, key: blessed.Widgets.Events.IKeyEventArg): boolean {
    if (!this.activeTask || this.activeTask.status !== "editing") {
      return false;
    }

    const viewportHeight = this.codeViewportHeight();
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
        if (!insertNewline(this.activeTask)) {
          this.footerStatus = "Only the requested function region is editable";
        }
        ensureCursorVisible(this.activeTask, viewportHeight);
        return true;
      case "backspace":
        if (!backspace(this.activeTask)) {
          this.footerStatus = "Only the requested function region is editable";
        }
        ensureCursorVisible(this.activeTask, viewportHeight);
        return true;
      case "delete":
        if (!deleteForward(this.activeTask)) {
          this.footerStatus = "Only the requested function region is editable";
        }
        return true;
      case "tab":
        return false;
      default:
        break;
    }

    if (!key.ctrl && !key.meta && ch) {
      if (ch.length > 1 && !ch.includes("\n")) {
        this.footerStatus = "Paste blocked in OICQ editor";
        return true;
      }
      if (!insertText(this.activeTask, ch === "\t" ? "  " : ch)) {
        this.footerStatus = "Only the requested function region is editable";
      }
      ensureCursorVisible(this.activeTask, viewportHeight);
      return true;
    }

    return false;
  }

  private async sendInput(): Promise<void> {
    const prompt = this.inputBuffer.trim();
    if (!prompt) {
      return;
    }
    this.inputBuffer = "";
    this.pushMessage("user", prompt);
    this.enqueueTurn(prompt, "user");
    this.render();
  }

  private enqueueTurn(prompt: string, source: "user" | "background" | "review"): void {
    this.turnQueue = this.turnQueue
      .then(async () => {
        await this.runTurn(prompt, source);
      })
      .catch((error) => {
        this.pushMessage("error", error instanceof Error ? error.message : String(error));
        this.render();
      });
  }

  private async runTurn(prompt: string, source: "user" | "background" | "review"): Promise<void> {
    this.busy = true;
    let assistantDraft: ChatMessage | undefined;
    let thinkingDraft: ChatMessage | undefined;
    this.footerStatus = `${this.provider} is thinking...`;
    this.render();

    const ensureAssistantDraft = (): ChatMessage => {
      if (!assistantDraft) {
        assistantDraft = this.pushMessage("assistant", "", true);
      }
      return assistantDraft;
    };

    const ensureThinkingDraft = (): ChatMessage => {
      if (!thinkingDraft) {
        thinkingDraft = this.pushMessage("thinking", "", true);
      }
      return thinkingDraft;
    };

    const result = await this.agent.runTurn(prompt, {
      onSession: () => {
        this.render();
      },
      onDelta: (delta) => {
        if (thinkingDraft) {
          thinkingDraft.pending = false;
        }
        const draft = ensureAssistantDraft();
        draft.text += delta;
        this.render();
      },
      onWarning: (warning) => {
        this.pushMessage("status", warning);
        this.render();
      },
      onEvent: (event) => {
        switch (event.type) {
          case "session":
            this.pushMessage("meta", `session ${event.sessionId.slice(0, 8)}`);
            break;
          case "status":
            this.pushMessage("status", event.text);
            break;
          case "thinking_delta": {
            const draft = ensureThinkingDraft();
            draft.text += event.text;
            break;
          }
          case "thinking_done":
            if (thinkingDraft) {
              thinkingDraft.pending = false;
            }
            break;
          case "tool_use":
            if (thinkingDraft) {
              thinkingDraft.pending = false;
            }
            this.pushMessage("tool", `${event.name}${event.input ? ` ${event.input}` : ""}`);
            break;
          case "tool_result":
            if (event.stdout) {
              this.pushMessage("stdout", event.stdout);
            }
            if (event.stderr) {
              this.pushMessage(event.isError ? "error" : "stdout", event.stderr);
            }
            break;
          default:
            break;
        }
        this.render();
      },
    });

    if (thinkingDraft) {
      thinkingDraft.pending = false;
    }
    if (assistantDraft) {
      assistantDraft.pending = false;
      assistantDraft.text = result.text || assistantDraft.text || "(no assistant text)";
    } else {
      assistantDraft = this.pushMessage("assistant", result.text || "(no assistant text)");
    }
    this.busy = false;
    this.footerStatus = "Ready";

    if (result.error) {
      assistantDraft.role = "error";
      assistantDraft.text = result.error;
    } else {
      const parsed = parseAssistantText(result.text);
      assistantDraft.text = parsed.visibleText || assistantDraft.text;

      if (parsed.requestError) {
        this.pushMessage("error", `Could not parse user request block: ${parsed.requestError}`);
      }

      if (parsed.reviewError) {
        this.pushMessage("error", `Could not parse review block: ${parsed.reviewError}`);
      }

      if (parsed.request) {
        if (this.activeTask && this.activeTask.status !== "accepted") {
          this.pushMessage("error", "Ignoring extra user implementation request while another task is still active.");
        } else {
          try {
            this.activeTask = await loadTask(this.cwd, parsed.request);
            this.focus = "input";
            this.footerStatus = `Task opened for ${this.activeTask.displayPath}. Press Tab to edit the function.`;
            this.pushMessage("status", `Opened user task: ${parsed.request.function_name} in ${parsed.request.file_path}`);
            if (parsed.request.blocking === false) {
              this.enqueueTurn(buildContinuePrompt(this.activeTask), "background");
            }
          } catch (error) {
            this.pushMessage("error", error instanceof Error ? error.message : String(error));
          }
        }
      }

      if (source === "review" && parsed.review && this.activeTask) {
        this.activeTask.review = parsed.review;
        if (parsed.review.status === "accept") {
          this.activeTask.status = "accepted";
          this.focus = "input";
          this.footerStatus = "Submission accepted";
          this.pushMessage("status", `Accepted by ${this.provider} review.`);
        } else {
          this.activeTask.status = "editing";
          this.focus = "input";
          this.footerStatus = "Review requested changes. Press Tab to edit the function.";
        }
      }
    }

    if (this.activeTask) {
      const restored = await restoreFrozenFile(this.activeTask).catch(() => false);
      if (restored) {
        this.pushMessage("status", `Restored ${this.activeTask.displayPath} after agent attempted to modify the frozen target file.`);
      }
    }

    this.render();
  }

  private async submitTask(): Promise<void> {
    if (!this.activeTask) {
      this.footerStatus = "No active user task";
      this.render();
      return;
    }
    if (this.busy || this.activeTask.status !== "editing") {
      this.footerStatus = "Cannot submit while OICQ is busy";
      this.render();
      return;
    }

    this.activeTask.status = "reviewing";
    const note = this.inputBuffer.trim();
    this.inputBuffer = "";
    const fileText = await writeTaskToDisk(this.activeTask);
    this.footerStatus = "Submitting for agent review...";
    this.render();
    this.enqueueTurn(buildReviewPrompt(this.activeTask, fileText, note), "review");
  }

  private pushMessage(role: ChatMessage["role"], text: string, pending = false): ChatMessage {
    const message = createMessage(role, text, pending);
    this.messages.push(message);
    return message;
  }

  private chatContent(): string {
    const lines = this.messages.flatMap((message) => {
      const label =
        message.role === "assistant" ? "agent" :
        message.role === "user" ? "you" :
        message.role === "thinking" ? "thinking" :
        message.role === "tool" ? "tool" :
        message.role === "stdout" ? "stdout" :
        message.role === "meta" ? "meta" :
        message.role;
      const prefixColor =
        message.role === "assistant" ? ansi.green :
        message.role === "user" ? ansi.cyan :
        message.role === "thinking" ? ansi.magenta :
        message.role === "tool" ? ansi.yellow :
        message.role === "stdout" ? ansi.blue :
        message.role === "meta" ? ansi.gray :
        message.role === "error" ? ansi.red :
        ansi.gray;
      const prefix = color(`[${label}]`, prefixColor);
      const suffix = message.pending ? color(" …", ansi.yellow) : "";
      const body = message.text || "(empty)";
      return body.split("\n").map((line, index) => `${index === 0 ? prefix : " ".repeat(label.length + 2)} ${line}${index === 0 ? suffix : ""}`);
    });
    return lines.join("\n");
  }

  private inputContent(): string {
    const focusMark = this.focus === "input" ? color("INPUT", ansi.green) : color("INPUT", ansi.gray);
    const cursor = this.focus === "input" ? `${ansi.reverse} ${ansi.reset}` : "";
    const hint = this.activeTask
      ? "You can keep chatting here. Press Tab only when you want to edit the function. Ctrl+S submits and uses this line as an optional note."
      : "Type a prompt and press Enter.";
    return `${focusMark}\n> ${this.inputBuffer}${cursor}\n${color(hint, ansi.gray)}`;
  }

  private codeViewportHeight(): number {
    return Math.max(6, Number(this.screen.height) - 12);
  }

  private renderCodeContent(): string {
    if (!this.activeTask) {
      return [
        color("No active user implementation task.", ansi.gray),
        "",
        "When the agent emits a user implementation request, the right pane will open the target file and lock editing to the requested range.",
      ].join("\n");
    }

    const lines = getRenderedLines(this.activeTask);
    const viewportHeight = this.codeViewportHeight();
    ensureCursorVisible(this.activeTask, viewportHeight);
    const digits = String(lines.length).length;
    const visible = lines.slice(this.activeTask.scrollLine, this.activeTask.scrollLine + viewportHeight);

    return visible
      .map((line, index) => {
        const absoluteLine = this.activeTask!.scrollLine + index;
        const lineNo = String(absoluteLine + 1).padStart(digits, " ");
        const editable = absoluteLine >= getEditableStartLine(this.activeTask!) && absoluteLine <= getEditableEndLine(this.activeTask!);
        const marker = absoluteLine === this.activeTask!.cursorLine
          ? color(">", editable ? ansi.green : ansi.yellow)
          : editable
            ? color("|", ansi.yellow)
            : " ";

        let body = line.replace(/\t/g, "  ");
        if (absoluteLine === this.activeTask!.cursorLine && this.focus === "editor") {
          const cursorColumn = clamp(this.activeTask!.cursorColumn, 0, body.length);
          const cursorChar = body[cursorColumn] ?? " ";
          body = `${body.slice(0, cursorColumn)}${ansi.reverse}${cursorChar}${ansi.reset}${body.slice(cursorColumn + 1)}`;
        } else {
          body = highlightLine(body, this.activeTask!.language);
        }

        const lineLabel = color(lineNo, editable ? ansi.yellow : ansi.gray);
        return `${marker} ${lineLabel} ${body}`;
      })
      .join("\n");
  }

  private renderReviewContent(): string {
    if (!this.activeTask) {
      return [
        color("Review", ansi.gray),
        "",
        "No pending task.",
      ].join("\n");
    }

    const constraints = this.activeTask.request.constraints && this.activeTask.request.constraints.length > 0
      ? this.activeTask.request.constraints.map((item) => `- ${item}`).join("\n")
      : "- none";

    const reviewBlock = this.activeTask.review
      ? [
          "",
          color(`Review: ${this.activeTask.review.status}`, this.activeTask.review.status === "accept" ? ansi.green : ansi.yellow),
          this.activeTask.review.feedback,
          ...(this.activeTask.review.issues ?? []).map((issue) => `- ${issue}`),
        ].join("\n")
      : "";

    return [
      `${color("Task", ansi.bold)} ${this.activeTask.request.function_name} (${this.activeTask.request.kind})`,
      `File: ${this.activeTask.displayPath}`,
      `Status: ${this.activeTask.status}`,
      "",
      this.activeTask.request.instructions,
      constraints,
      reviewBlock,
    ].join("\n");
  }

  private renderHeader(): string {
    const busy = this.busy ? color("BUSY", ansi.yellow) : color("IDLE", ansi.green);
    const focus = this.focus === "input" ? "input" : "editor";
    return `${color("OICQ", ansi.bold)} provider=${this.provider} status=${busy} session=${shortId(this.agent.sessionId)} focus=${focus} cwd=${this.cwd}`;
  }

  private renderFooter(): string {
    const shortcuts = "Tab focus | Enter send | Ctrl+S submit | Arrow keys move | Ctrl+C quit";
    return `${this.footerStatus} | ${shortcuts}`;
  }

  private render(): void {
    this.headerBox.setContent(this.renderHeader());
    this.chatBox.setContent(this.chatContent());
    this.chatBox.setScrollPerc(100);
    this.inputBox.setContent(this.inputContent());
    this.codeBox.setContent(this.renderCodeContent());
    this.reviewBox.setContent(this.renderReviewContent());
    this.footerBox.setContent(this.renderFooter());
    this.screen.render();
  }

  private shutdown(): void {
    if (this.activeTask) {
      void fs.writeFile(this.activeTask.absolutePath, this.activeTask.frozenFileText, "utf8").finally(() => {
        this.screen.destroy();
        process.exit(0);
      });
      return;
    }
    this.screen.destroy();
    process.exit(0);
  }
}
