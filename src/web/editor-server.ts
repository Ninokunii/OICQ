import fs from "node:fs/promises";
import http from "node:http";
import path from "node:path";
import { createRequire } from "node:module";

import { composeTaskFile, loadTask, writeTaskToDisk } from "../core/editor.js";
import { readActiveRequest, readOicqSession, updateOicqSession, writeActiveResult } from "../native/session-store.js";
import { openUrl } from "../native/editor-sidecar.js";
import { renderEditorAppJs, renderEditorHtml } from "./editor-page.js";
import type { OicqToolRequestRecord } from "../types.js";

const require = createRequire(import.meta.url);
const monacoVsRoot = path.dirname(require.resolve("monaco-editor/min/vs/loader.js"));

function json(response: http.ServerResponse, statusCode: number, body: unknown): void {
  response.writeHead(statusCode, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
  });
  response.end(JSON.stringify(body));
}

function text(response: http.ServerResponse, statusCode: number, body: string, contentType: string): void {
  response.writeHead(statusCode, {
    "content-type": `${contentType}; charset=utf-8`,
    "cache-control": "no-store",
  });
  response.end(body);
}

function splitSubmittedText(value: string): string[] {
  const lines = value.replace(/\r\n/g, "\n").split("\n");
  return lines.length > 0 ? lines : [""];
}

function buildContextLines(lines: string[], startIndex: number, endIndex: number): Array<{ lineNumber: number; text: string }> {
  return lines.slice(startIndex, endIndex).map((textValue, offset) => ({
    lineNumber: startIndex + offset + 1,
    text: textValue,
  }));
}

async function buildTaskPayload(record: OicqToolRequestRecord) {
  const task = await loadTask(record.cwd, record.request);
  const startLine = task.request.kind === "implement_function_body"
    ? task.request.start_line!
    : task.request.insert_after_line! + 1;
  const endLine = startLine + task.bufferLines.length - 1;

  const beforeStart = Math.max(0, startLine - 7);
  const beforeEnd = Math.max(0, startLine - 1);
  const afterStart = Math.min(task.originalLines.length, task.request.kind === "implement_function_body"
    ? task.request.end_line!
    : task.request.insert_after_line!);
  const afterEnd = Math.min(task.originalLines.length, afterStart + 6);

  return {
    requestId: record.id,
    filePath: task.displayPath,
    functionName: task.request.function_name,
    kind: task.request.kind,
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

async function handleState(response: http.ServerResponse, sessionDir: string): Promise<void> {
  const [session, activeRecord] = await Promise.all([
    readOicqSession(sessionDir),
    readActiveRequest(sessionDir),
  ]);

  json(response, 200, {
    session,
    activeTask: activeRecord ? await buildTaskPayload(activeRecord) : null,
  });
}

async function readJsonBody(request: http.IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  const raw = Buffer.concat(chunks).toString("utf8");
  return raw ? JSON.parse(raw) : {};
}

async function handleSubmit(request: http.IncomingMessage, response: http.ServerResponse, sessionDir: string): Promise<void> {
  const payload = await readJsonBody(request) as {
    requestId?: string;
    editableText?: string;
    note?: string;
  };

  const activeRecord = await readActiveRequest(sessionDir);
  if (!activeRecord || !payload.requestId || activeRecord.id !== payload.requestId) {
    json(response, 409, { error: "Active request changed" });
    return;
  }

  const task = await loadTask(activeRecord.cwd, activeRecord.request);
  task.bufferLines = splitSubmittedText(payload.editableText ?? "");
  const updatedFileText = composeTaskFile(task);
  await writeTaskToDisk(task);
  await writeActiveResult(sessionDir, {
    requestId: activeRecord.id,
    submittedAt: Date.now(),
    note: (payload.note ?? "").trim(),
    updatedFileText,
  });

  json(response, 200, { ok: true });
}

function contentTypeFor(filePath: string): string {
  if (filePath.endsWith(".js")) {
    return "application/javascript";
  }
  if (filePath.endsWith(".css")) {
    return "text/css";
  }
  if (filePath.endsWith(".json")) {
    return "application/json";
  }
  return "text/plain";
}

async function serveMonacoAsset(response: http.ServerResponse, requestPath: string): Promise<void> {
  const relativePath = requestPath.replace(/^\/vendor\/monaco\/vs\//, "");
  const absolutePath = path.join(monacoVsRoot, relativePath);
  if (!absolutePath.startsWith(monacoVsRoot)) {
    text(response, 403, "Forbidden", "text/plain");
    return;
  }

  try {
    const file = await fs.readFile(absolutePath);
    response.writeHead(200, {
      "content-type": contentTypeFor(absolutePath),
      "cache-control": "public, max-age=3600",
    });
    response.end(file);
  } catch {
    text(response, 404, "Not found", "text/plain");
  }
}

async function route(request: http.IncomingMessage, response: http.ServerResponse, sessionDir: string): Promise<void> {
  const url = new URL(request.url ?? "/", "http://127.0.0.1");
  if (request.method === "GET" && url.pathname === "/") {
    text(response, 200, renderEditorHtml(), "text/html");
    return;
  }

  if (request.method === "GET" && url.pathname === "/app.js") {
    text(response, 200, renderEditorAppJs(), "application/javascript");
    return;
  }

  if (request.method === "GET" && url.pathname === "/api/state") {
    await handleState(response, sessionDir);
    return;
  }

  if (request.method === "POST" && url.pathname === "/api/submit") {
    await handleSubmit(request, response, sessionDir);
    return;
  }

  if (request.method === "GET" && url.pathname.startsWith("/vendor/monaco/vs/")) {
    await serveMonacoAsset(response, url.pathname);
    return;
  }

  text(response, 404, "Not found", "text/plain");
}

export async function startOicqWebEditor(sessionDir: string): Promise<void> {
  await readOicqSession(sessionDir);

  const server = http.createServer((request, response) => {
    void route(request, response, sessionDir).catch((error) => {
      text(response, 500, error instanceof Error ? error.message : String(error), "text/plain");
    });
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      server.off("error", reject);
      resolve();
    });
  });

  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("Failed to resolve web editor address");
  }

  const url = `http://127.0.0.1:${address.port}/`;
  await updateOicqSession(sessionDir, {
    editorState: "open",
    editorUrl: url,
  });

  openUrl(url);
  console.error(`[oicq] web editor listening on ${url}`);

  const shutdown = async (): Promise<void> => {
    await updateOicqSession(sessionDir, {
      editorState: "closed",
      editorUrl: undefined,
    }).catch(() => undefined);
    await new Promise<void>((resolve) => server.close(() => resolve()));
    process.exit(0);
  };

  process.on("SIGINT", () => {
    void shutdown();
  });
  process.on("SIGTERM", () => {
    void shutdown();
  });
}
