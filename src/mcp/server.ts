import fs from "node:fs/promises";
import { randomUUID } from "node:crypto";

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import type { ServerNotification } from "@modelcontextprotocol/sdk/types.js";
import * as z from "zod/v4";

import { OICQ_MCP_TOOL_NAME } from "../native/prompts.js";
import { ensureEditorSidecar } from "../native/editor-sidecar.js";
import {
  archiveInteraction,
  buildToolResultText,
  clearActiveFiles,
  readActiveRequest,
  readOicqSession,
  resolveWorkspacePath,
  updateOicqSession,
  waitForMatchingResult,
  writeActiveRequest,
} from "../native/session-store.js";
import type { OicqToolRequestRecord, UserImplRequest } from "../types.js";

const toolInputSchema = {
  kind: z.enum(["implement_function_body", "insert_function_at_marker"]),
  file_path: z.string().min(1),
  function_name: z.string().min(1),
  instructions: z.string().min(1),
  constraints: z.array(z.string()).optional(),
  related_code: z.array(z.object({
    label: z.string().min(1),
    file_path: z.string().min(1),
    start_line: z.number().int().positive().optional(),
    code: z.array(z.string()).min(1),
  })).optional(),
  start_line: z.number().int().positive().optional(),
  end_line: z.number().int().positive().optional(),
  insert_after_line: z.number().int().nonnegative().optional(),
  initial_content: z.array(z.string()).optional(),
};

const MAX_BEGINNER_EDIT_LINES = 12;
const MAX_REAL_MODE_EDIT_LINES = 240;
const MAX_RELATED_CODE_BLOCKS = 6;
const MAX_RELATED_CODE_LINES_PER_BLOCK = 40;
const MAX_USER_VISIBLE_INSTRUCTION_CHARS = 420;
const MAX_USER_VISIBLE_INSTRUCTION_SENTENCES = 6;
const DISALLOWED_USER_VISIBLE_TERMS = /\b(easy|trivial|tiny|beginner|ceremony|ceremonial|comically|simple|small|auxiliary|helper|leaf|safe|scoped down)\b|简单|很简单|最简单|小函数|辅助函数|帮助函数|收尾|边角|不重要|无关紧要|容易|决胜时刻|最后一战|成败在此一举/i;
const WAIT_HEARTBEAT_MS = 15000;

function parseSessionDir(argv: string[]): string {
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === "--session-dir") {
      const next = argv[index + 1];
      if (!next) {
        throw new Error("--session-dir requires a value");
      }
      return next;
    }
  }

  const fromEnv = process.env.OICQ_SESSION_DIR;
  if (fromEnv) {
    return fromEnv;
  }

  throw new Error("Missing --session-dir for OICQ MCP server");
}

async function createRequestRecord(sessionDir: string, payload: UserImplRequest): Promise<OicqToolRequestRecord> {
  const session = await readOicqSession(sessionDir);
  const absolutePath = resolveWorkspacePath(session.cwd, payload.file_path);
  const originalFileText = await fs.readFile(absolutePath, "utf8");

  return {
    id: randomUUID(),
    provider: session.provider,
    cwd: session.cwd,
    absolutePath,
    createdAt: Date.now(),
    request: payload,
    originalFileText,
  };
}

function buildToolDescription(realMode: boolean): string {
  return realMode
    ? "Final-step gate for the current coding request: after the rest of that patch is done, route one genuinely difficult and repo-central user-owned function through the OICQ editor, present it like an important handoff, then return the resulting diff. Later code-changing requests in the same terminal session should open a new OICQ handoff instead of reusing an older one."
    : "Final-step gate for the current coding request: after the rest of that patch is done, route one tiny user-owned function through the OICQ editor, present it like an important handoff, then return the resulting diff. Later code-changing requests in the same terminal session should open a new OICQ handoff instead of reusing an older one.";
}

function validateUserRequest(input: UserImplRequest, realMode: boolean): string | undefined {
  const normalizedInstructions = input.instructions.replace(/\s+/g, " ").trim();
  if (normalizedInstructions.length > MAX_USER_VISIBLE_INSTRUCTION_CHARS) {
    return `OICQ user-facing instructions must stay reasonably compact. Keep them under ${MAX_USER_VISIBLE_INSTRUCTION_CHARS} characters while still clearly naming the file/function, expected behavior, and key references.`;
  }

  const sentenceCount = normalizedInstructions
    .split(/[.!?。！？]+/)
    .map((part) => part.trim())
    .filter(Boolean)
    .length;
  if (sentenceCount > MAX_USER_VISIBLE_INSTRUCTION_SENTENCES) {
    return `OICQ user-facing instructions must stay within ${MAX_USER_VISIBLE_INSTRUCTION_SENTENCES} concise sentences. Make them specific, not bloated.`;
  }

  if (DISALLOWED_USER_VISIBLE_TERMS.test(normalizedInstructions)) {
    return "OICQ user-facing instructions must not reveal that the task is easy, tiny, helper-level, or merely ceremonial, and should also avoid epic phrases like 决胜时刻. Rephrase it as a concrete request for help.";
  }

  if (input.related_code && input.related_code.length > MAX_RELATED_CODE_BLOCKS) {
    return `OICQ related_code should stay compact. Keep it within ${MAX_RELATED_CODE_BLOCKS} focused snippets.`;
  }

  for (const block of input.related_code ?? []) {
    if (block.code.length > MAX_RELATED_CODE_LINES_PER_BLOCK) {
      return `OICQ related_code snippet "${block.label}" is too long. Keep each snippet within ${MAX_RELATED_CODE_LINES_PER_BLOCK} lines.`;
    }
  }

  if (input.kind === "implement_function_body") {
    if (!input.start_line || !input.end_line) {
      return "OICQ requires start_line and end_line for implement_function_body.";
    }
    const lineCount = input.end_line - input.start_line + 1;
    const limit = realMode ? MAX_REAL_MODE_EDIT_LINES : MAX_BEGINNER_EDIT_LINES;
    if (lineCount > limit) {
      return realMode
        ? `OICQ real mode still expects a single-function handoff. This request spans ${lineCount} lines. Narrow it to one core function within ${MAX_REAL_MODE_EDIT_LINES} lines.`
        : `OICQ only accepts beginner-friendly leaf tasks. This request spans ${lineCount} lines. Extract a smaller helper first and keep the editable logic within ${MAX_BEGINNER_EDIT_LINES} lines.`;
    }
    return undefined;
  }

  const lineCount = input.initial_content?.length ?? 0;
  const limit = realMode ? MAX_REAL_MODE_EDIT_LINES : MAX_BEGINNER_EDIT_LINES;
  if (lineCount > limit) {
    return realMode
      ? `OICQ real mode still expects one focused function. This insertion stub is ${lineCount} lines long. Keep it within ${MAX_REAL_MODE_EDIT_LINES} lines.`
      : `OICQ only accepts beginner-friendly leaf tasks. This insertion stub is ${lineCount} lines long. Insert a smaller helper skeleton first and keep it within ${MAX_BEGINNER_EDIT_LINES} lines.`;
  }
  return undefined;
}

function getProgressToken(extra: {
  _meta?: {
    progressToken?: string | number;
  };
}): string | number | undefined {
  return extra._meta?.progressToken;
}

function startWaitingHeartbeat(
  extra: {
    signal: AbortSignal;
    sendNotification: (notification: ServerNotification) => Promise<void>;
    _meta?: {
      progressToken?: string | number;
    };
  },
  request: OicqToolRequestRecord,
): () => void {
  const progressToken = getProgressToken(extra);
  let tick = 0;

  const sendHeartbeat = (): void => {
    if (extra.signal.aborted) {
      return;
    }

    tick += 1;
    const waitMinutes = Math.floor((tick * WAIT_HEARTBEAT_MS) / 60000);
    const message = waitMinutes > 0
      ? `OICQ 仍在等待用户完成 ${request.request.file_path} 中的 ${request.request.function_name} 并提交。`
      : `OICQ 已打开用户任务，正在等待 ${request.request.file_path} 中的 ${request.request.function_name} 被提交。`;

    void extra.sendNotification({
      method: "notifications/message",
      params: {
        level: "info",
        logger: "oicq",
        data: message,
      },
    } as ServerNotification).catch(() => undefined);

    if (progressToken === undefined) {
      return;
    }

    void extra.sendNotification({
      method: "notifications/progress",
      params: {
        progressToken,
        progress: 0,
        total: 1,
        message,
      },
    } as ServerNotification).catch(() => undefined);
  };

  sendHeartbeat();
  const timer = setInterval(sendHeartbeat, WAIT_HEARTBEAT_MS);
  extra.signal.addEventListener("abort", () => clearInterval(timer), { once: true });
  return () => clearInterval(timer);
}

export async function startOicqMcpServer(sessionDir: string): Promise<void> {
  const session = await readOicqSession(sessionDir);

  const server = new McpServer({
    name: "oicq",
    version: "0.1.0",
  });

  server.registerTool(
    OICQ_MCP_TOOL_NAME,
    {
      description: buildToolDescription(session.realMode),
      inputSchema: toolInputSchema,
    },
    async (input, extra) => {
      const validationError = validateUserRequest(input, session.realMode);
      if (validationError) {
        return {
          content: [
            {
              type: "text",
              text: validationError,
            },
          ],
          isError: true,
        };
      }

      const active = await readActiveRequest(sessionDir);
      if (active) {
        return {
          content: [
            {
              type: "text",
              text: `OICQ already has an active final-step user task for ${active.request.file_path}:${active.request.function_name}. Wait for it to finish before opening another task.`,
            },
          ],
          isError: true,
        };
      }

      const requestRecord = await createRequestRecord(sessionDir, {
        ...input,
        blocking: true,
      });

      await clearActiveFiles(sessionDir);
      await updateOicqSession(sessionDir, {
        status: "awaiting_user",
        lastRequestId: requestRecord.id,
      });
      await writeActiveRequest(sessionDir, requestRecord);
      await ensureEditorSidecar(sessionDir);
      console.error(`[oicq] waiting for user implementation ${requestRecord.id} in ${requestRecord.request.file_path}`);

      const stopHeartbeat = startWaitingHeartbeat(extra, requestRecord);

      try {
        const result = await waitForMatchingResult(sessionDir, requestRecord.id);
        await archiveInteraction(sessionDir, requestRecord, result);
        await clearActiveFiles(sessionDir);
        await updateOicqSession(sessionDir, {
          status: "idle",
          lastRequestId: requestRecord.id,
        });

        return {
          content: [
            {
              type: "text",
              text: buildToolResultText(requestRecord, result),
            },
          ],
        };
      } finally {
        stopHeartbeat();
      }
    },
  );

  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error(`[oicq] MCP server running for session ${sessionDir}`);
}
