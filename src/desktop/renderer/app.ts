import "./styles.css";

import { FitAddon } from "@xterm/addon-fit";
import { Terminal } from "@xterm/xterm";
import * as monaco from "monaco-editor";
import editorWorker from "monaco-editor/esm/vs/editor/editor.worker?worker";
import jsonWorker from "monaco-editor/esm/vs/language/json/json.worker?worker";
import cssWorker from "monaco-editor/esm/vs/language/css/css.worker?worker";
import htmlWorker from "monaco-editor/esm/vs/language/html/html.worker?worker";
import tsWorker from "monaco-editor/esm/vs/language/typescript/ts.worker?worker";
import "monaco-editor/esm/vs/language/json/monaco.contribution";
import "monaco-editor/esm/vs/language/css/monaco.contribution";
import "monaco-editor/esm/vs/language/html/monaco.contribution";
import "monaco-editor/esm/vs/language/typescript/monaco.contribution";
import "monaco-editor/esm/vs/basic-languages/python/python.contribution";
import "monaco-editor/esm/vs/basic-languages/go/go.contribution";
import "monaco-editor/esm/vs/basic-languages/rust/rust.contribution";

import type { DesktopStatePayload, DesktopTaskPayload } from "../contracts";

self.addEventListener("error", (event) => {
  console.error("[oicq/renderer] uncaught error", event.message);
});

self.addEventListener("unhandledrejection", (event) => {
  console.error("[oicq/renderer] unhandled rejection", String(event.reason));
});

self.MonacoEnvironment = {
  getWorker(_workerId: string, label: string) {
    if (label === "json") {
      return new jsonWorker();
    }
    if (label === "css" || label === "scss" || label === "less") {
      return new cssWorker();
    }
    if (label === "html" || label === "handlebars" || label === "razor") {
      return new htmlWorker();
    }
    if (label === "typescript" || label === "javascript") {
      return new tsWorker();
    }
    return new editorWorker();
  },
};

const state = {
  requestId: null as string | null,
  loadedRequestId: null as string | null,
  submitting: false,
};

const editorState = {
  prefixLines: 0,
  suffixLines: 0,
  editableLineCount: 0,
  firstDisplayedLine: 1,
  lastValidValue: "",
  suppressChangeGuard: false,
  hintTimer: 0 as number | undefined,
};

let editor: monaco.editor.IStandaloneCodeEditor | null = null;
let readonlyDecorations: monaco.editor.IEditorDecorationsCollection | null = null;
let fitFrame = 0;
let lastTerminalWidth = 0;
let lastTerminalHeight = 0;
let lastTerminalCols = 0;
let lastTerminalRows = 0;

const els = {
  terminalMeta: document.getElementById("terminal-meta") as HTMLDivElement,
  editorTitle: document.getElementById("editor-title") as HTMLDivElement,
  instructions: document.getElementById("instructions") as HTMLDivElement,
  hint: document.getElementById("hint") as HTMLDivElement,
  submit: document.getElementById("submit") as HTMLButtonElement,
  relatedCodeWrap: document.getElementById("related-code-wrap") as HTMLDivElement,
  relatedCodeButton: document.getElementById("related-code-button") as HTMLButtonElement,
  relatedCodeContent: document.getElementById("related-code-content") as HTMLPreElement,
  terminalRoot: document.getElementById("terminal") as HTMLDivElement,
  editorRoot: document.getElementById("editor") as HTMLDivElement,
};

function languageFor(name: string): string {
  switch (name) {
    case "typescript":
      return "typescript";
    case "javascript":
      return "javascript";
    case "python":
      return "python";
    case "go":
      return "go";
    case "rust":
      return "rust";
    default:
      return "plaintext";
  }
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

function splitParagraphs(value: string): string[] {
  return value
    .replace(/\r\n/g, "\n")
    .split(/\n{2,}/)
    .map((part) => part.trim())
    .filter(Boolean);
}

function renderInstructionText(value: string): string {
  return escapeHtml(value)
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    .replace(/\n{2,}/g, "\n")
    .replace(/\n/g, "<br>");
}

function buildUserTaskBrief(task: DesktopTaskPayload): string {
  const paragraphs = splitParagraphs(task.instructions);
  const content = paragraphs.length > 0
    ? paragraphs
    : ["我自己没法把这里写稳，所以需要你直接接手当前编辑区里的这段实现。"];
  return content.map((paragraph) => `<p>${renderInstructionText(paragraph)}</p>`).join("");
}

function renderContextLines(lines: DesktopTaskPayload["contextBefore"]): string {
  return lines.map((line) => `${String(line.lineNumber).padStart(4, " ")}  ${line.text}`).join("\n");
}

function buildRelatedCodePreview(task: DesktopTaskPayload): string {
  if (task.relatedCode.length === 0) {
    return "当前没有额外相关代码。";
  }

  return task.relatedCode.map((block) => {
    const location = block.startLine
      ? `${block.filePath}:${block.startLine}`
      : block.filePath;

    return [
      `[${block.label}]`,
      location,
      ...block.code,
    ].join("\n");
  }).join("\n\n");
}

function setHint(message = "", options?: { warning?: boolean; autoHideMs?: number }): void {
  if (editorState.hintTimer !== undefined) {
    window.clearTimeout(editorState.hintTimer);
    editorState.hintTimer = undefined;
  }

  els.hint.textContent = message;
  els.hint.classList.toggle("warning", Boolean(options?.warning));
  els.hint.classList.toggle("visible", message.length > 0);

  if (message && options?.autoHideMs) {
    editorState.hintTimer = window.setTimeout(() => {
      editorState.hintTimer = undefined;
      els.hint.textContent = "";
      els.hint.classList.remove("warning", "visible");
    }, options.autoHideMs);
  }
}

function splitEditorText(value: string): string[] {
  return value.replace(/\r\n/g, "\n").split("\n");
}

function buildEditorDocument(task: DesktopTaskPayload): {
  value: string;
  prefixLines: number;
  suffixLines: number;
  editableLineCount: number;
  firstDisplayedLine: number;
} {
  const beforeLines = task.contextBefore.map((line) => line.text);
  const editableLines = splitEditorText(task.editableText);
  const afterLines = task.contextAfter.map((line) => line.text);
  const allLines = [...beforeLines, ...editableLines, ...afterLines];

  return {
    value: allLines.join("\n"),
    prefixLines: beforeLines.length,
    suffixLines: afterLines.length,
    editableLineCount: editableLines.length,
    firstDisplayedLine: task.contextBefore[0]?.lineNumber ?? task.startLine,
  };
}

function currentEditableStartLine(): number {
  return editorState.prefixLines + 1;
}

function currentEditableEndLine(): number {
  return editorState.prefixLines + editorState.editableLineCount;
}

function applyReadonlyDecorations(activeEditor: monaco.editor.IStandaloneCodeEditor): void {
  const model = activeEditor.getModel();
  if (!model) {
    return;
  }

  readonlyDecorations ??= activeEditor.createDecorationsCollection();
  const totalLines = model.getLineCount();
  const editableStart = currentEditableStartLine();
  const editableEnd = currentEditableEndLine();
  const decorations: monaco.editor.IModelDeltaDecoration[] = [];

  if (editorState.prefixLines > 0) {
    const endLine = Math.max(1, editableStart - 1);
    decorations.push({
      range: new monaco.Range(1, 1, endLine, model.getLineMaxColumn(endLine)),
      options: {
        isWholeLine: true,
        className: "monaco-readonly-line",
      },
    });
  }

  if (editorState.suffixLines > 0 && editableEnd < totalLines) {
    const startLine = editableEnd + 1;
    decorations.push({
      range: new monaco.Range(startLine, 1, totalLines, model.getLineMaxColumn(totalLines)),
      options: {
        isWholeLine: true,
        className: "monaco-readonly-line",
      },
    });
  }

  readonlyDecorations.set(decorations);
}

function revertToLastValidValue(activeEditor: monaco.editor.IStandaloneCodeEditor): void {
  editorState.suppressChangeGuard = true;
  activeEditor.setValue(editorState.lastValidValue);
  const model = activeEditor.getModel();
  if (model) {
    const targetLine = Math.min(Math.max(currentEditableStartLine(), 1), model.getLineCount());
    activeEditor.setPosition({ lineNumber: targetLine, column: 1 });
  }
  editorState.suppressChangeGuard = false;
  setHint("只能修改中间那段需要你实现的函数内容。", { warning: true, autoHideMs: 1800 });
}

function extractEditableText(activeEditor: monaco.editor.IStandaloneCodeEditor): string {
  const model = activeEditor.getModel();
  if (!model) {
    return "";
  }

  const lines = model.getLinesContent();
  const startIndex = editorState.prefixLines;
  const endIndex = Math.max(startIndex, lines.length - editorState.suffixLines);
  return lines.slice(startIndex, endIndex).join("\n");
}

const terminal = new Terminal({
  convertEol: true,
  fontFamily: '"SF Mono", "JetBrains Mono", monospace',
  fontSize: 13,
  cursorBlink: true,
  theme: {
    background: "#0f1318",
    foreground: "#edf2fa",
  },
});

const fitAddon = new FitAddon();
terminal.loadAddon(fitAddon);
terminal.open(els.terminalRoot);

function clampTerminalHeightToExactRows(): void {
  const terminalCore = terminal as typeof terminal & {
    _core?: {
      _renderService?: {
        dimensions?: {
          css?: {
            cell?: { height?: number };
          };
        };
      };
    };
  };
  const cellHeight = terminalCore._core?._renderService?.dimensions?.css?.cell?.height;
  if (typeof cellHeight !== "number" || !Number.isFinite(cellHeight) || cellHeight <= 0) {
    return;
  }

  terminal.element?.style.setProperty("height", `${Math.floor(terminal.rows * cellHeight)}px`);
}

function fitAndResizeTerminal(): void {
  const width = els.terminalRoot.clientWidth;
  const height = els.terminalRoot.clientHeight;
  if (width <= 0 || height <= 0) {
    return;
  }
  if (width === lastTerminalWidth && height === lastTerminalHeight) {
    return;
  }

  lastTerminalWidth = width;
  lastTerminalHeight = height;
  fitAddon.fit();
  if (terminal.cols <= 0 || terminal.rows <= 0) {
    return;
  }

  clampTerminalHeightToExactRows();
  terminal.refresh(0, Math.max(0, terminal.rows - 1));

  if (terminal.cols === lastTerminalCols && terminal.rows === lastTerminalRows) {
    return;
  }

  lastTerminalCols = terminal.cols;
  lastTerminalRows = terminal.rows;
  window.oicq.resizeTerminal(terminal.cols, terminal.rows);
}

function scheduleTerminalFit(): void {
  if (fitFrame !== 0) {
    return;
  }

  fitFrame = window.requestAnimationFrame(() => {
    fitFrame = 0;
    fitAndResizeTerminal();
  });
}

function focusTerminal(): void {
  terminal.focus();
}

terminal.onData((data) => {
  window.oicq.sendTerminalInput(data);
});

const terminalResizeObserver = new ResizeObserver(() => {
  scheduleTerminalFit();
});
terminalResizeObserver.observe(els.terminalRoot);
window.addEventListener("resize", () => {
  scheduleTerminalFit();
});

window.oicq.onTerminalData((data) => {
  terminal.write(data);
});

window.oicq.onTerminalExit(({ exitCode }) => {
  els.terminalMeta.textContent = `Agent 进程已退出，退出码 ${exitCode}`;
});

function blockClipboard(root: HTMLElement): void {
  const handler = (event: Event) => {
    event.preventDefault();
    setHint("编辑器内禁止复制、粘贴和剪切。", { warning: true, autoHideMs: 1800 });
  };

  root.addEventListener("paste", handler, true);
  root.addEventListener("copy", handler, true);
  root.addEventListener("cut", handler, true);
  root.addEventListener("drop", handler, true);
  root.addEventListener("contextmenu", (event) => event.preventDefault(), true);
  root.addEventListener("keydown", (event) => {
    const keyboard = event as KeyboardEvent;
    const meta = keyboard.metaKey || keyboard.ctrlKey;
    if ((meta && ["c", "v", "x"].includes(keyboard.key.toLowerCase())) || (keyboard.shiftKey && keyboard.key === "Insert")) {
      handler(event);
    }
  }, true);
}

function ensureEditor(): monaco.editor.IStandaloneCodeEditor {
  if (editor) {
    return editor;
  }

  editor = monaco.editor.create(els.editorRoot, {
    value: "",
    language: "plaintext",
    automaticLayout: true,
    fixedOverflowWidgets: true,
    minimap: { enabled: false },
    glyphMargin: false,
    folding: false,
    scrollBeyondLastLine: false,
    overviewRulerBorder: false,
    quickSuggestions: false,
    suggestOnTriggerCharacters: false,
    wordBasedSuggestions: "off",
    snippetSuggestions: "none",
    tabCompletion: "off",
    acceptSuggestionOnEnter: "off",
    inlineSuggest: { enabled: false },
    parameterHints: { enabled: false },
    lineDecorationsWidth: 12,
    contextmenu: false,
    fontSize: 14,
    tabSize: 2,
    insertSpaces: true,
    theme: "vs-dark",
    readOnly: true,
  });

  readonlyDecorations = editor.createDecorationsCollection();
  blockClipboard(els.editorRoot);

  editor.onDidFocusEditorWidget(() => {
    document.body.classList.add("editor-focused");
  });

  editor.onDidBlurEditorWidget(() => {
    document.body.classList.remove("editor-focused");
  });

  editor.onDidChangeModelContent((event) => {
    if (editorState.suppressChangeGuard || !editor) {
      return;
    }

    const editableStart = currentEditableStartLine();
    const editableEnd = currentEditableEndLine();
    const touchedReadonly = event.changes.some((change) =>
      change.range.startLineNumber < editableStart || change.range.endLineNumber > editableEnd
    );

    if (touchedReadonly) {
      revertToLastValidValue(editor);
      return;
    }

    editorState.lastValidValue = editor.getValue();
    const model = editor.getModel();
    if (model) {
      editorState.editableLineCount = Math.max(1, model.getLineCount() - editorState.prefixLines - editorState.suffixLines);
    }
    applyReadonlyDecorations(editor);
  });

  return editor;
}

function resetWaiting(session: DesktopStatePayload["session"]): void {
  state.requestId = null;
  state.loadedRequestId = null;
  state.submitting = false;
  document.body.classList.remove("task-open");
  document.body.classList.remove("editor-focused");

  editorState.prefixLines = 0;
  editorState.suffixLines = 0;
  editorState.editableLineCount = 0;
  editorState.firstDisplayedLine = 1;
  editorState.lastValidValue = "";

  if (editor) {
    editorState.suppressChangeGuard = true;
    editor.updateOptions({ readOnly: true });
    editor.setValue("");
    editorState.suppressChangeGuard = false;
  }

  readonlyDecorations?.clear();
  els.editorTitle.textContent = "说明";
  els.instructions.innerHTML = "<p>终端仍由 agent 控制。等它真的把一段实现交给你时，这里才会显示说明。</p>";
  els.submit.disabled = true;
  els.submit.textContent = "提交给 Agent";
  els.relatedCodeContent.textContent = "当前没有额外相关代码。";
  els.relatedCodeButton.disabled = true;
  setHint();
  scheduleTerminalFit();
}

function applyTask(task: DesktopTaskPayload): void {
  document.body.classList.add("task-open");
  const activeEditor = ensureEditor();
  const documentState = buildEditorDocument(task);
  const nextLanguage = languageFor(task.language);

  state.requestId = task.requestId;
  els.editorTitle.textContent = "说明";
  els.instructions.innerHTML = buildUserTaskBrief(task);
  els.submit.disabled = false;
  els.submit.textContent = "提交给 Agent";
  els.relatedCodeContent.textContent = buildRelatedCodePreview(task);
  els.relatedCodeButton.disabled = task.relatedCode.length === 0;
  setHint();

  editorState.prefixLines = documentState.prefixLines;
  editorState.suffixLines = documentState.suffixLines;
  editorState.editableLineCount = documentState.editableLineCount;
  editorState.firstDisplayedLine = documentState.firstDisplayedLine;

  if (state.loadedRequestId !== task.requestId) {
    editorState.suppressChangeGuard = true;
    activeEditor.setValue(documentState.value);
    editorState.suppressChangeGuard = false;
    activeEditor.setScrollTop(0);
    activeEditor.setPosition({ lineNumber: documentState.prefixLines + 1, column: 1 });
    state.loadedRequestId = task.requestId;
  }

  const model = activeEditor.getModel();
  if (model) {
    monaco.editor.setModelLanguage(model, nextLanguage);
  }

  editorState.lastValidValue = activeEditor.getValue();
  activeEditor.updateOptions({
    readOnly: false,
    lineNumbers: (lineNumber) => String(editorState.firstDisplayedLine + lineNumber - 1),
  });
  applyReadonlyDecorations(activeEditor);
  activeEditor.layout();
  scheduleTerminalFit();
}

async function submit(): Promise<void> {
  if (!state.requestId || state.submitting || !editor) {
    return;
  }

  state.submitting = true;
  els.submit.disabled = true;
  els.submit.textContent = "提交中...";

  try {
    await window.oicq.submitTask({
      requestId: state.requestId,
      editableText: extractEditableText(editor),
      note: "",
    });
    setHint("已提交，等待 agent review。");
    els.submit.textContent = "已提交";
  } catch (error) {
    setHint(error instanceof Error ? error.message : String(error), { warning: true });
    els.submit.disabled = false;
    els.submit.textContent = "提交给 Agent";
  } finally {
    state.submitting = false;
  }
}

els.submit.addEventListener("click", () => {
  void submit();
});

window.oicq.onStateChanged((payload) => {
  els.terminalMeta.textContent = `${payload.session.provider} · 会话 ${payload.session.id.slice(0, 8)}`;
  if (!payload.activeTask) {
    resetWaiting(payload.session);
    return;
  }
  applyTask(payload.activeTask);
});

void window.oicq.getState().then((payload) => {
  els.terminalMeta.textContent = `${payload.session.provider} · 会话 ${payload.session.id.slice(0, 8)}`;
  if (!payload.activeTask) {
    resetWaiting(payload.session);
  } else {
    applyTask(payload.activeTask);
  }

  window.requestAnimationFrame(() => {
    scheduleTerminalFit();
    focusTerminal();
    window.setTimeout(() => {
      focusTerminal();
    }, 30);
    void window.oicq.attachTerminal();
  });
});

window.addEventListener("focus", () => {
  if (document.body.classList.contains("editor-focused")) {
    return;
  }
  focusTerminal();
});
