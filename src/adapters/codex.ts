import { BaseCliAgentClient } from "./base.js";
import type { AgentTurnHandlers } from "../types.js";

function extractTextPayload(value: unknown): string {
  if (typeof value === "string") {
    return value;
  }
  if (Array.isArray(value)) {
    return value.map((item) => extractTextPayload(item)).join("");
  }
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    if (typeof record.text === "string") {
      return record.text;
    }
    if (record.content) {
      return extractTextPayload(record.content);
    }
  }
  return "";
}

export class CodexClient extends BaseCliAgentClient {
  protected buildArgs(prompt: string): string[] {
    const args = this.sessionId
      ? ["exec", "resume", "--json", "--dangerously-bypass-approvals-and-sandbox", "--skip-git-repo-check", this.sessionId, prompt]
      : ["exec", "--json", "--dangerously-bypass-approvals-and-sandbox", "--skip-git-repo-check", prompt];

    return args;
  }

  protected handleEvent(
    event: Record<string, unknown>,
    state: { finalText: string; streamedText: string; warnings: string[]; fatalError?: string; meta: Record<string, unknown> },
    handlers: AgentTurnHandlers,
  ): void {
    const type = typeof event.type === "string" ? event.type : "";

    if (type === "thread.started" && typeof event.thread_id === "string") {
      this.setSession(event.thread_id, handlers);
      handlers.onEvent?.({ type: "session", sessionId: event.thread_id });
      return;
    }

    if (type === "item.completed" && event.item && typeof event.item === "object") {
      const item = event.item as Record<string, unknown>;
      if (item.type === "agent_message") {
        state.finalText = extractTextPayload(item.text || item.content);
        return;
      }
    }

    const streamedDelta =
      (typeof event.delta === "string" ? event.delta : "") ||
      (event.item && typeof event.item === "object" && typeof (event.item as Record<string, unknown>).delta === "string"
        ? ((event.item as Record<string, unknown>).delta as string)
        : "");

    if (streamedDelta) {
      state.streamedText += streamedDelta;
      handlers.onDelta?.(streamedDelta);
    }

    if (type === "error" && typeof event.message === "string") {
      state.warnings.push(event.message);
      handlers.onWarning?.(event.message);
      handlers.onEvent?.({ type: "status", text: event.message });
      return;
    }

    if (type === "turn.failed") {
      const error = event.error && typeof event.error === "object"
        ? (event.error as Record<string, unknown>).message
        : undefined;
      state.fatalError = typeof error === "string" ? error : "Codex turn failed";
      return;
    }

    if (type === "turn.completed") {
      handlers.onEvent?.({ type: "status", text: "turn finished" });
    }
  }
}
