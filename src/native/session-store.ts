import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";

import { createTwoFilesPatch } from "diff";

import type {
  OicqEditorMode,
  OicqSessionMeta,
  OicqToolRequestRecord,
  OicqToolResultRecord,
  ProviderName,
} from "../types.js";

const RUNTIME_ROOT = ".oicq-runtime";
const SESSION_FILE = "session.json";
const REQUEST_FILE = "active-request.json";
const RESULT_FILE = "active-result.json";
const HISTORY_DIR = "history";

async function ensureDir(dirPath: string): Promise<void> {
  await fs.mkdir(dirPath, { recursive: true });
}

async function writeJsonAtomic(filePath: string, value: unknown): Promise<void> {
  const tempPath = `${filePath}.tmp`;
  await fs.writeFile(tempPath, JSON.stringify(value, null, 2), "utf8");
  await fs.rename(tempPath, filePath);
}

async function readJsonFile<T>(filePath: string): Promise<T | undefined> {
  try {
    const text = await fs.readFile(filePath, "utf8");
    return JSON.parse(text) as T;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return undefined;
    }
    throw error;
  }
}

export function getRuntimeRoot(cwd: string): string {
  return path.join(cwd, RUNTIME_ROOT);
}

export function getSessionFilePath(sessionDir: string): string {
  return path.join(sessionDir, SESSION_FILE);
}

export function getRequestFilePath(sessionDir: string): string {
  return path.join(sessionDir, REQUEST_FILE);
}

export function getResultFilePath(sessionDir: string): string {
  return path.join(sessionDir, RESULT_FILE);
}

export async function createOicqSession(
  provider: ProviderName,
  cwd: string,
  editorMode: OicqEditorMode,
  realMode: boolean,
): Promise<OicqSessionMeta> {
  const id = randomUUID();
  const sessionDir = path.join(getRuntimeRoot(cwd), id);
  await ensureDir(path.join(sessionDir, HISTORY_DIR));
  const session: OicqSessionMeta = {
    id,
    provider,
    cwd,
    sessionDir,
    createdAt: Date.now(),
    realMode,
    status: "idle",
    editorMode,
    editorState: "closed",
  };
  await writeJsonAtomic(getSessionFilePath(sessionDir), session);
  return session;
}

export async function readOicqSession(sessionDir: string): Promise<OicqSessionMeta> {
  const session = await readJsonFile<OicqSessionMeta>(getSessionFilePath(sessionDir));
  if (!session) {
    throw new Error(`Missing OICQ session metadata in ${sessionDir}`);
  }
  return {
    ...session,
    realMode: session.realMode ?? false,
  };
}

export async function updateOicqSession(sessionDir: string, patch: Partial<OicqSessionMeta>): Promise<OicqSessionMeta> {
  const session = await readOicqSession(sessionDir);
  const next = {
    ...session,
    ...patch,
  };
  await writeJsonAtomic(getSessionFilePath(sessionDir), next);
  return next;
}

export async function readActiveRequest(sessionDir: string): Promise<OicqToolRequestRecord | undefined> {
  return await readJsonFile<OicqToolRequestRecord>(getRequestFilePath(sessionDir));
}

export async function writeActiveRequest(sessionDir: string, request: OicqToolRequestRecord): Promise<void> {
  await writeJsonAtomic(getRequestFilePath(sessionDir), request);
}

export async function readActiveResult(sessionDir: string): Promise<OicqToolResultRecord | undefined> {
  return await readJsonFile<OicqToolResultRecord>(getResultFilePath(sessionDir));
}

export async function writeActiveResult(sessionDir: string, result: OicqToolResultRecord): Promise<void> {
  await writeJsonAtomic(getResultFilePath(sessionDir), result);
}

export async function clearActiveFiles(sessionDir: string): Promise<void> {
  for (const filePath of [getRequestFilePath(sessionDir), getResultFilePath(sessionDir)]) {
    try {
      await fs.unlink(filePath);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
        throw error;
      }
    }
  }
}

export async function waitForMatchingResult(sessionDir: string, requestId: string, pollMs = 250): Promise<OicqToolResultRecord> {
  while (true) {
    const result = await readActiveResult(sessionDir);
    if (result && result.requestId === requestId) {
      return result;
    }
    await new Promise((resolve) => setTimeout(resolve, pollMs));
  }
}

export async function archiveInteraction(
  sessionDir: string,
  request: OicqToolRequestRecord,
  result: OicqToolResultRecord,
): Promise<void> {
  const archivePath = path.join(sessionDir, HISTORY_DIR, `${request.id}.json`);
  await writeJsonAtomic(archivePath, { request, result });
}

export function resolveWorkspacePath(cwd: string, relativePath: string): string {
  const workspaceRoot = path.resolve(cwd);
  const resolved = path.resolve(workspaceRoot, relativePath);
  if (resolved !== workspaceRoot && !resolved.startsWith(`${workspaceRoot}${path.sep}`)) {
    throw new Error(`Refusing to access a path outside the workspace: ${relativePath}`);
  }
  return resolved;
}

export function buildToolResultText(
  request: OicqToolRequestRecord,
  result: OicqToolResultRecord,
): string {
  const diff = createTwoFilesPatch(
    request.request.file_path,
    request.request.file_path,
    request.originalFileText,
    result.updatedFileText,
    "original",
    "user_submission",
  );

  return [
    "OICQ user implementation completed for the current coding request.",
    `file: ${request.request.file_path}`,
    `function: ${request.request.function_name}`,
    `kind: ${request.request.kind}`,
    "timing: this tool is intended to be called after all other coding work is done.",
    "next: limit remaining work to integration checks, validation, and finalization.",
    `note: ${result.note || "(none)"}`,
    "",
    "Unified diff:",
    "```diff",
    diff.trim(),
    "```",
  ].join("\n");
}
