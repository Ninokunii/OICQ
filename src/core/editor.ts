import fs from "node:fs/promises";
import path from "node:path";

import type { ActiveTask, UserImplRequest } from "../types.js";
import { detectLanguage } from "./languages.js";

function splitLines(text: string): string[] {
  return text.split(/\r?\n/);
}

function normalizeNewline(text: string): string {
  return text.includes("\r\n") ? "\r\n" : "\n";
}

function assertInsideWorkspace(cwd: string, filePath: string): string {
  const workspaceRoot = path.resolve(cwd);
  const resolved = path.resolve(workspaceRoot, filePath);
  if (resolved !== workspaceRoot && !resolved.startsWith(`${workspaceRoot}${path.sep}`)) {
    throw new Error(`Refusing to open path outside workspace: ${filePath}`);
  }
  return resolved;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function todoPlaceholderForLanguage(language: string): string {
  return language === "python" ? "# TODO: implement" : "// TODO: implement";
}

function isPlaceholderImplementationLine(line: string): boolean {
  const trimmed = line.trim();
  if (!trimmed) {
    return false;
  }

  return [
    /^throw new [\w$.]*Unsupported[\w$.]*(\(.+\))?;?$/i,
    /^throw new Error\(.+unsupported.+\);?$/i,
    /^throw ["'`].*unsupported.*["'`];?$/i,
    /^panic!\(.+unsupported.+\);?$/i,
    /^unimplemented!\(.+\);?$/i,
    /^todo!\(.+\);?$/i,
    /^raise (NotImplementedError|UnsupportedOperation|Exception)\(.+\)$/i,
    /^return errors\.New\(.+unsupported.+\)$/i,
  ].some((pattern) => pattern.test(trimmed));
}

function isStructuralLine(line: string): boolean {
  const trimmed = line.trim();
  return trimmed.length === 0 || /^[{}\[\]();,]+$/.test(trimmed);
}

function replacePlaceholderLine(line: string, language: string): string {
  const indent = line.match(/^\s*/)?.[0] ?? "";
  return `${indent}${todoPlaceholderForLanguage(language)}`;
}

function normalizeEditableBufferLines(lines: string[], language: string, mode: "insert" | "implement"): string[] {
  if (mode === "insert") {
    return lines.map((line) => (isPlaceholderImplementationLine(line) ? replacePlaceholderLine(line, language) : line));
  }

  const meaningfulLines = lines.filter((line) => !isStructuralLine(line));
  if (meaningfulLines.length === 0 || !meaningfulLines.every(isPlaceholderImplementationLine)) {
    return lines;
  }

  return lines.map((line) => (isPlaceholderImplementationLine(line) ? replacePlaceholderLine(line, language) : line));
}

export async function loadTask(cwd: string, request: UserImplRequest): Promise<ActiveTask> {
  const absolutePath = assertInsideWorkspace(cwd, request.file_path);
  const rawText = await fs.readFile(absolutePath, "utf8");
  const originalLines = splitLines(rawText);
  const newline = normalizeNewline(rawText);
  const language = detectLanguage(request.file_path);

  if (request.kind === "implement_function_body") {
    if (!request.start_line || !request.end_line) {
      throw new Error("implement_function_body requires start_line and end_line");
    }
    if (request.start_line < 1 || request.end_line < request.start_line || request.end_line > originalLines.length) {
      throw new Error("Invalid editable line range in request");
    }
  }

  if (request.kind === "insert_function_at_marker") {
    if (request.insert_after_line === undefined || request.insert_after_line < 0 || request.insert_after_line > originalLines.length) {
      throw new Error("insert_function_at_marker requires a valid insert_after_line");
    }
  }

  const rawBufferLines =
    request.kind === "implement_function_body"
      ? originalLines.slice(request.start_line! - 1, request.end_line!)
      : request.initial_content && request.initial_content.length > 0
        ? [...request.initial_content]
        : [""];
  const bufferLines = normalizeEditableBufferLines(
    rawBufferLines,
    language,
    request.kind === "implement_function_body" ? "implement" : "insert",
  );

  const frozenFileText = rawText;
  const cursorLine =
    request.kind === "implement_function_body"
      ? request.start_line! - 1
      : request.insert_after_line!;

  return {
    request,
    absolutePath,
    displayPath: request.file_path,
    language,
    newline,
    originalLines,
    bufferLines: bufferLines.length > 0 ? bufferLines : [""],
    cursorLine,
    cursorColumn: 0,
    scrollLine: Math.max(0, cursorLine - 3),
    status: "editing",
    frozenFileText,
  };
}

export function getRenderedLines(task: ActiveTask): string[] {
  const editableStart = getEditableStartLine(task);
  const editableEnd = editableStart + task.bufferLines.length;

  if (task.request.kind === "implement_function_body") {
    return [
      ...task.originalLines.slice(0, editableStart),
      ...task.bufferLines,
      ...task.originalLines.slice(task.request.end_line!),
    ];
  }

  return [
    ...task.originalLines.slice(0, editableStart),
    ...task.bufferLines,
    ...task.originalLines.slice(editableStart),
  ];
}

export function composeTaskFile(task: ActiveTask): string {
  return getRenderedLines(task).join(task.newline);
}

export function getEditableStartLine(task: ActiveTask): number {
  return task.request.kind === "implement_function_body"
    ? task.request.start_line! - 1
    : task.request.insert_after_line!;
}

export function getEditableEndLine(task: ActiveTask): number {
  return getEditableStartLine(task) + task.bufferLines.length - 1;
}

export function isEditableLine(task: ActiveTask, combinedLine: number): boolean {
  return combinedLine >= getEditableStartLine(task) && combinedLine <= getEditableEndLine(task);
}

export function getBufferIndex(task: ActiveTask, combinedLine: number): number | undefined {
  if (!isEditableLine(task, combinedLine)) {
    return undefined;
  }
  return combinedLine - getEditableStartLine(task);
}

export function ensureCursorVisible(task: ActiveTask, viewportHeight: number): void {
  if (task.cursorLine < task.scrollLine) {
    task.scrollLine = task.cursorLine;
    return;
  }
  const bottomLine = task.scrollLine + viewportHeight - 1;
  if (task.cursorLine > bottomLine) {
    task.scrollLine = Math.max(0, task.cursorLine - viewportHeight + 1);
  }
}

export function moveCursor(task: ActiveTask, lineDelta: number, columnDelta: number, viewportHeight: number): void {
  const lines = getRenderedLines(task);
  task.cursorLine = clamp(task.cursorLine + lineDelta, 0, Math.max(lines.length - 1, 0));
  const currentLine = lines[task.cursorLine] ?? "";
  task.cursorColumn = clamp(task.cursorColumn + columnDelta, 0, currentLine.length);
  ensureCursorVisible(task, viewportHeight);
}

export function jumpCursor(task: ActiveTask, line: number, column: number, viewportHeight: number): void {
  const lines = getRenderedLines(task);
  task.cursorLine = clamp(line, 0, Math.max(lines.length - 1, 0));
  const currentLine = lines[task.cursorLine] ?? "";
  task.cursorColumn = clamp(column, 0, currentLine.length);
  ensureCursorVisible(task, viewportHeight);
}

export function insertText(task: ActiveTask, text: string): boolean {
  const bufferIndex = getBufferIndex(task, task.cursorLine);
  if (bufferIndex === undefined) {
    return false;
  }
  const current = task.bufferLines[bufferIndex] ?? "";
  task.bufferLines[bufferIndex] = `${current.slice(0, task.cursorColumn)}${text}${current.slice(task.cursorColumn)}`;
  task.cursorColumn += text.length;
  return true;
}

export function insertNewline(task: ActiveTask): boolean {
  const bufferIndex = getBufferIndex(task, task.cursorLine);
  if (bufferIndex === undefined) {
    return false;
  }
  const current = task.bufferLines[bufferIndex] ?? "";
  const before = current.slice(0, task.cursorColumn);
  const after = current.slice(task.cursorColumn);
  task.bufferLines.splice(bufferIndex, 1, before, after);
  task.cursorLine += 1;
  task.cursorColumn = 0;
  return true;
}

export function backspace(task: ActiveTask): boolean {
  const bufferIndex = getBufferIndex(task, task.cursorLine);
  if (bufferIndex === undefined) {
    return false;
  }
  const current = task.bufferLines[bufferIndex] ?? "";
  if (task.cursorColumn > 0) {
    task.bufferLines[bufferIndex] = `${current.slice(0, task.cursorColumn - 1)}${current.slice(task.cursorColumn)}`;
    task.cursorColumn -= 1;
    return true;
  }
  if (bufferIndex === 0) {
    return false;
  }
  const previous = task.bufferLines[bufferIndex - 1] ?? "";
  task.bufferLines.splice(bufferIndex - 1, 2, `${previous}${current}`);
  task.cursorLine -= 1;
  task.cursorColumn = previous.length;
  return true;
}

export function deleteForward(task: ActiveTask): boolean {
  const bufferIndex = getBufferIndex(task, task.cursorLine);
  if (bufferIndex === undefined) {
    return false;
  }
  const current = task.bufferLines[bufferIndex] ?? "";
  if (task.cursorColumn < current.length) {
    task.bufferLines[bufferIndex] = `${current.slice(0, task.cursorColumn)}${current.slice(task.cursorColumn + 1)}`;
    return true;
  }
  if (bufferIndex >= task.bufferLines.length - 1) {
    return false;
  }
  const next = task.bufferLines[bufferIndex + 1] ?? "";
  task.bufferLines.splice(bufferIndex, 2, `${current}${next}`);
  return true;
}

export async function writeTaskToDisk(task: ActiveTask): Promise<string> {
  const content = composeTaskFile(task);
  await fs.writeFile(task.absolutePath, content, "utf8");
  task.frozenFileText = content;
  return content;
}

export async function restoreFrozenFile(task: ActiveTask): Promise<boolean> {
  const current = await fs.readFile(task.absolutePath, "utf8");
  if (current === task.frozenFileText) {
    return false;
  }
  await fs.writeFile(task.absolutePath, task.frozenFileText, "utf8");
  return true;
}
