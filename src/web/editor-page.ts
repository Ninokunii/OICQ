export function renderEditorHtml(): string {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>OICQ Editor</title>
    <style>
      :root {
        color-scheme: light;
        --bg: #f5f1e8;
        --panel: #fffdf8;
        --ink: #1f1a17;
        --muted: #74685d;
        --line: #d8cbbc;
        --accent: #2457d6;
        --accent-2: #f08a24;
        --danger: #a72f1f;
        --shadow: 0 18px 48px rgba(58, 40, 19, 0.12);
      }

      * { box-sizing: border-box; }
      html, body { margin: 0; height: 100%; }
      body {
        font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        color: var(--ink);
        background:
          radial-gradient(circle at top left, rgba(240, 138, 36, 0.12), transparent 28%),
          linear-gradient(180deg, #f8f4eb 0%, #efe4d2 100%);
      }

      .shell {
        display: grid;
        grid-template-columns: minmax(300px, 360px) 1fr;
        gap: 16px;
        height: 100%;
        padding: 16px;
      }

      .panel {
        background: var(--panel);
        border: 1px solid var(--line);
        border-radius: 18px;
        box-shadow: var(--shadow);
        overflow: hidden;
      }

      .sidebar {
        display: flex;
        flex-direction: column;
      }

      .brand {
        padding: 18px 20px 14px;
        border-bottom: 1px solid var(--line);
      }

      .eyebrow {
        font-size: 12px;
        letter-spacing: 0.12em;
        text-transform: uppercase;
        color: var(--accent);
        margin-bottom: 8px;
      }

      h1 {
        margin: 0;
        font-size: 26px;
        line-height: 1.05;
      }

      .sub {
        margin-top: 8px;
        color: var(--muted);
        font-size: 14px;
        line-height: 1.45;
      }

      .meta, .instructions, .context, .note {
        padding: 16px 20px;
        border-bottom: 1px solid var(--line);
      }

      .meta-grid {
        display: grid;
        grid-template-columns: 76px 1fr;
        gap: 8px 10px;
        font-size: 14px;
      }

      .meta-grid dt {
        color: var(--muted);
      }

      .meta-grid dd {
        margin: 0;
        word-break: break-word;
      }

      .instructions-body, .context pre {
        margin: 10px 0 0;
        font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
        font-size: 13px;
        line-height: 1.5;
        white-space: pre-wrap;
      }

      .context pre {
        background: #fbf7ef;
        border: 1px solid #eadfce;
        border-radius: 12px;
        padding: 12px;
        overflow: auto;
        max-height: 180px;
      }

      .note textarea {
        width: 100%;
        min-height: 88px;
        resize: vertical;
        border: 1px solid var(--line);
        border-radius: 12px;
        padding: 10px 12px;
        background: #fff;
        color: var(--ink);
        font: inherit;
      }

      .editor-panel {
        display: grid;
        grid-template-rows: auto 1fr auto;
      }

      .toolbar {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 12px;
        padding: 16px 18px;
        border-bottom: 1px solid var(--line);
      }

      .toolbar-title {
        font-size: 18px;
        font-weight: 700;
      }

      .toolbar-subtitle {
        color: var(--muted);
        font-size: 13px;
        margin-top: 4px;
      }

      .status {
        font-size: 13px;
        color: var(--muted);
      }

      #editor {
        min-height: 360px;
      }

      .footer {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 12px;
        padding: 14px 18px;
        border-top: 1px solid var(--line);
        background: rgba(255, 255, 255, 0.72);
      }

      .hint {
        color: var(--muted);
        font-size: 13px;
      }

      button {
        border: 0;
        border-radius: 999px;
        padding: 12px 18px;
        font-size: 14px;
        font-weight: 700;
        color: white;
        background: linear-gradient(135deg, var(--accent), #13388f);
        cursor: pointer;
      }

      button[disabled] {
        opacity: 0.55;
        cursor: not-allowed;
      }

      .warning {
        color: var(--danger);
      }

      .hidden {
        display: none;
      }

      .editor-shell {
        position: relative;
        min-height: 360px;
      }

      .editor-loading {
        position: absolute;
        inset: 0;
        display: flex;
        align-items: center;
        justify-content: center;
        font-size: 14px;
        color: var(--muted);
        background:
          linear-gradient(135deg, rgba(240, 138, 36, 0.08), rgba(36, 87, 214, 0.04)),
          #fffdfa;
      }

      @media (max-width: 960px) {
        .shell {
          grid-template-columns: 1fr;
          grid-template-rows: auto 1fr;
        }
      }
    </style>
  </head>
  <body>
    <div class="shell">
      <aside class="panel sidebar">
        <section class="brand">
          <div class="eyebrow">OICQ</div>
          <h1>User Function Gate</h1>
          <div class="sub">The page opens only when the native agent hands one function to the user.</div>
        </section>

        <section class="meta">
          <dl class="meta-grid">
            <dt>Provider</dt><dd id="provider">-</dd>
            <dt>Session</dt><dd id="session-id">-</dd>
            <dt>File</dt><dd id="file-path">Waiting</dd>
            <dt>Function</dt><dd id="function-name">Waiting</dd>
            <dt>Mode</dt><dd id="task-kind">Waiting</dd>
          </dl>
        </section>

        <section class="instructions">
          <strong>Instructions</strong>
          <div class="instructions-body" id="instructions">Waiting for the agent to open a task.</div>
          <div class="instructions-body" id="constraints"></div>
        </section>

        <section class="context">
          <strong>Read-only Context</strong>
          <pre id="context-before">No active task.</pre>
          <pre id="context-after" class="hidden"></pre>
        </section>

        <section class="note">
          <strong>Submission Note</strong>
          <div class="sub">Optional note sent back with your submission.</div>
          <textarea id="note" placeholder="Explain tradeoffs or anything the agent should know."></textarea>
        </section>
      </aside>

      <main class="panel editor-panel">
        <header class="toolbar">
          <div>
            <div class="toolbar-title" id="editor-title">Waiting for task</div>
            <div class="toolbar-subtitle" id="editor-subtitle">OICQ will load the editable function body here.</div>
          </div>
          <div class="status" id="status">Idle</div>
        </header>

        <div class="editor-shell">
          <div id="editor-loading" class="editor-loading">Loading Monaco...</div>
          <div id="editor"></div>
        </div>

        <footer class="footer">
          <div class="hint" id="hint">Paste is blocked inside the code editor. Browser refresh is safe.</div>
          <button id="submit" disabled>Submit To Agent</button>
        </footer>
      </main>
    </div>

    <script src="/vendor/monaco/vs/loader.js"></script>
    <script src="/app.js"></script>
  </body>
</html>`;
}

export function renderEditorAppJs(): string {
  return `
const POLL_MS = 800;
const state = {
  editor: null,
  requestId: null,
  loadedRequestId: null,
  startLine: 1,
  language: "plaintext",
  monacoReady: false,
  pendingTask: null,
  submitting: false,
};

const els = {
  provider: document.getElementById("provider"),
  sessionId: document.getElementById("session-id"),
  filePath: document.getElementById("file-path"),
  functionName: document.getElementById("function-name"),
  taskKind: document.getElementById("task-kind"),
  instructions: document.getElementById("instructions"),
  constraints: document.getElementById("constraints"),
  contextBefore: document.getElementById("context-before"),
  contextAfter: document.getElementById("context-after"),
  note: document.getElementById("note"),
  editorTitle: document.getElementById("editor-title"),
  editorSubtitle: document.getElementById("editor-subtitle"),
  status: document.getElementById("status"),
  hint: document.getElementById("hint"),
  submit: document.getElementById("submit"),
  editorRoot: document.getElementById("editor"),
  editorLoading: document.getElementById("editor-loading"),
};

function escapeHtml(value) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

function languageFor(name) {
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

function renderContext(lines) {
  if (!lines || lines.length === 0) {
    return "No surrounding context.";
  }
  return lines.map((line) => String(line.lineNumber).padStart(4, " ") + "  " + line.text).join("\\n");
}

function blockClipboard(root) {
  if (!root) {
    return;
  }
  const handler = (event) => {
    event.preventDefault();
    els.hint.textContent = "Paste, copy, and cut are blocked inside the code editor.";
    els.hint.classList.add("warning");
    window.setTimeout(() => {
      els.hint.textContent = "Paste is blocked inside the code editor. Browser refresh is safe.";
      els.hint.classList.remove("warning");
    }, 1800);
  };

  root.addEventListener("paste", handler, true);
  root.addEventListener("copy", handler, true);
  root.addEventListener("cut", handler, true);
  root.addEventListener("drop", handler, true);
  root.addEventListener("contextmenu", (event) => event.preventDefault(), true);
  root.addEventListener("keydown", (event) => {
    const meta = event.metaKey || event.ctrlKey;
    if ((meta && ["c", "v", "x"].includes(event.key.toLowerCase())) || (event.shiftKey && event.key === "Insert")) {
      handler(event);
    }
  }, true);
}

function ensureEditor() {
  if (!state.monacoReady || typeof monaco === "undefined") {
    return null;
  }
  if (state.editor) {
    return state.editor;
  }

  els.editorLoading.classList.add("hidden");
  state.editor = monaco.editor.create(els.editorRoot, {
    value: "",
    language: "plaintext",
    automaticLayout: true,
    minimap: { enabled: false },
    glyphMargin: false,
    folding: false,
    lineDecorationsWidth: 12,
    overviewRulerBorder: false,
    scrollBeyondLastLine: false,
    contextmenu: false,
    fontSize: 14,
    tabSize: 2,
    insertSpaces: true,
    theme: "vs",
    lineNumbers: (lineNumber) => String(state.startLine + lineNumber - 1),
  });

  blockClipboard(els.editorRoot);
  return state.editor;
}

function resetWaiting(session) {
  state.requestId = null;
  state.loadedRequestId = null;
  state.pendingTask = null;
  state.submitting = false;
  const editor = ensureEditor();
  if (editor) {
    editor.updateOptions({ readOnly: true });
    editor.setValue("");
  }
  els.submit.disabled = true;
  els.filePath.textContent = "Waiting";
  els.functionName.textContent = "Waiting";
  els.taskKind.textContent = session.editorMode;
  els.instructions.textContent = "Waiting for the agent to open a task.";
  els.constraints.textContent = "";
  els.contextBefore.textContent = "No active task.";
  els.contextAfter.textContent = "";
  els.contextAfter.classList.add("hidden");
  els.editorTitle.textContent = "Waiting for task";
  els.editorSubtitle.textContent = "The browser editor opens lazily and stays parked until a task arrives.";
  els.status.textContent = "Idle";
  els.submit.textContent = "Submit To Agent";
}

function applyTask(session, task) {
  const nextLanguage = languageFor(task.language);
  const isNewTask = state.loadedRequestId !== task.requestId;
  state.requestId = task.requestId;
  state.startLine = task.startLine;
  state.language = nextLanguage;
  state.submitting = false;

  els.provider.textContent = session.provider;
  els.sessionId.textContent = session.id.slice(0, 8);
  els.filePath.textContent = task.filePath;
  els.functionName.textContent = task.functionName;
  els.taskKind.textContent = task.kind;
  els.instructions.textContent = task.instructions;
  els.constraints.innerHTML = task.constraints.length
    ? "<strong>Constraints</strong>\\n" + task.constraints.map((item) => "- " + escapeHtml(item)).join("<br>")
    : "";
  els.contextBefore.textContent = renderContext(task.contextBefore);
  els.contextAfter.textContent = renderContext(task.contextAfter);
  els.contextAfter.classList.toggle("hidden", task.contextAfter.length === 0);
  els.editorTitle.textContent = task.functionName;
  els.editorSubtitle.textContent = task.filePath + " · editable lines " + task.startLine + "-" + task.endLine;
  const editor = ensureEditor();
  if (!editor) {
    state.pendingTask = { session, task };
    els.status.textContent = "Loading Monaco";
    els.hint.textContent = "Task received. Monaco is still loading.";
    els.submit.disabled = true;
    return;
  }

  state.pendingTask = null;
  els.status.textContent = state.submitting ? "Submitting" : "Editing";
  els.submit.disabled = false;
  els.submit.textContent = "Submit To Agent";
  els.hint.textContent = "Paste is blocked inside the code editor. Browser refresh is safe.";
  els.hint.classList.remove("warning");

  editor.updateOptions({
    readOnly: false,
    lineNumbers: (lineNumber) => String(state.startLine + lineNumber - 1),
  });
  const model = editor.getModel();
  if (model) {
    monaco.editor.setModelLanguage(model, nextLanguage);
  }

  if (isNewTask) {
    editor.setValue(task.editableText);
    editor.setScrollTop(0);
    editor.setPosition({ lineNumber: 1, column: 1 });
    els.note.value = "";
    state.loadedRequestId = task.requestId;
  }
}

async function fetchState() {
  const response = await fetch("/api/state", { cache: "no-store" });
  if (!response.ok) {
    throw new Error("Failed to load editor state");
  }
  return await response.json();
}

async function submitCurrentTask() {
  if (!state.requestId || state.submitting) {
    return;
  }

  state.submitting = true;
  els.status.textContent = "Submitting";
  els.submit.disabled = true;
  els.submit.textContent = "Submitting...";

  const response = await fetch("/api/submit", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      requestId: state.requestId,
      editableText: ensureEditor()?.getValue() ?? "",
      note: els.note.value,
    }),
  });

  if (!response.ok) {
    state.submitting = false;
    els.status.textContent = "Submit failed";
    els.submit.disabled = false;
    els.submit.textContent = "Submit To Agent";
    els.hint.textContent = "Submit failed. The active request may have changed.";
    els.hint.classList.add("warning");
    return;
  }

  els.status.textContent = "Submitted";
  els.hint.textContent = "Submission sent. Waiting for agent review.";
  els.submit.textContent = "Submitted";
}

async function tick() {
  try {
    const payload = await fetchState();
    els.provider.textContent = payload.session.provider;
    els.sessionId.textContent = payload.session.id.slice(0, 8);

    if (payload.activeTask) {
      applyTask(payload.session, payload.activeTask);
    } else {
      resetWaiting(payload.session);
    }
  } catch (error) {
    els.status.textContent = "Disconnected";
    els.hint.textContent = error instanceof Error ? error.message : String(error);
    els.hint.classList.add("warning");
  } finally {
    window.setTimeout(tick, POLL_MS);
  }
}

els.submit.addEventListener("click", () => {
  void submitCurrentTask();
});

void tick();

if (window.require && window.require.config) {
  require.config({ paths: { vs: "/vendor/monaco/vs" } });
  require(["vs/editor/editor.main"], () => {
    state.monacoReady = true;
    const editor = ensureEditor();
    if (editor) {
      editor.updateOptions({
        lineNumbers: (lineNumber) => String(state.startLine + lineNumber - 1),
      });
      if (state.pendingTask) {
        applyTask(state.pendingTask.session, state.pendingTask.task);
      }
    }
  }, () => {
    els.editorLoading.textContent = "Monaco failed to load.";
    els.status.textContent = "Monaco load failed";
    els.submit.disabled = true;
    els.hint.textContent = "Monaco failed to load. Check the browser console and OICQ server logs.";
    els.hint.classList.add("warning");
  });
} else {
  els.editorLoading.textContent = "Monaco loader missing.";
  els.status.textContent = "Monaco loader missing";
  els.submit.disabled = true;
  els.hint.textContent = "Monaco loader did not initialize. Check the browser console and OICQ server logs.";
  els.hint.classList.add("warning");
}
`;
}
