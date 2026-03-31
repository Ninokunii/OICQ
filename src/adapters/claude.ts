import { BaseCliAgentClient } from "./base.js";
import type { AgentTurnHandlers } from "../types.js";

function extractClaudeText(content: unknown): string {
  if (!Array.isArray(content)) {
    return "";
  }
  return content
    .flatMap((item) => {
      if (item && typeof item === "object" && "text" in item && typeof item.text === "string") {
        return [item.text];
      }
      return [];
    })
    .join("");
}

export class ClaudeClient extends BaseCliAgentClient {
  protected buildArgs(prompt: string): string[] {
    const args = [
      "-p",
      "--verbose",
      "--include-partial-messages",
      "--output-format",
      "stream-json",
      "--permission-mode",
      "bypassPermissions",
      "--system-prompt",
      this.systemPrompt,
    ];

    if (this.sessionId) {
      args.push("--resume", this.sessionId);
    }

    args.push(prompt);
    return args;
  }

  protected handleEvent(
    event: Record<string, unknown>,
    state: { finalText: string; streamedText: string; warnings: string[]; fatalError?: string; meta: Record<string, unknown> },
    handlers: AgentTurnHandlers,
  ): void {
    const blockTypes = (state.meta.blockTypes as Record<number, string> | undefined) ?? {};
    state.meta.blockTypes = blockTypes;
    const type = typeof event.type === "string" ? event.type : "";
    if (type === "system" && event.subtype === "init" && typeof event.session_id === "string") {
      this.setSession(event.session_id, handlers);
      handlers.onEvent?.({ type: "session", sessionId: event.session_id });
      return;
    }

    if (type === "user" && event.tool_use_result && typeof event.tool_use_result === "object") {
      const toolUseResult = event.tool_use_result as Record<string, unknown>;
      handlers.onEvent?.({
        type: "tool_result",
        stdout: typeof toolUseResult.stdout === "string" ? toolUseResult.stdout : undefined,
        stderr: typeof toolUseResult.stderr === "string" ? toolUseResult.stderr : undefined,
        isError: Boolean(toolUseResult.is_error),
      });
      return;
    }

    if (type === "stream_event" && event.event && typeof event.event === "object") {
      const streamEvent = event.event as Record<string, unknown>;
      if (streamEvent.type === "content_block_start" && streamEvent.content_block && typeof streamEvent.content_block === "object") {
        const block = streamEvent.content_block as Record<string, unknown>;
        if (typeof streamEvent.index === "number" && typeof block.type === "string") {
          blockTypes[streamEvent.index] = block.type;
        }
      }
      if (streamEvent.type === "content_block_delta" && streamEvent.delta && typeof streamEvent.delta === "object") {
        const delta = streamEvent.delta as Record<string, unknown>;
        if (typeof delta.text === "string") {
          state.streamedText += delta.text;
          handlers.onDelta?.(delta.text);
        }
        if (typeof delta.thinking === "string") {
          handlers.onEvent?.({ type: "thinking_delta", text: delta.thinking });
        }
      }
      if (streamEvent.type === "content_block_stop" && typeof streamEvent.index === "number" && blockTypes[streamEvent.index] === "thinking") {
        handlers.onEvent?.({ type: "thinking_done" });
      }
      return;
    }

    if (type === "assistant" && event.message && typeof event.message === "object") {
      const message = event.message as Record<string, unknown>;
      state.finalText = extractClaudeText(message.content);
      if (Array.isArray(message.content)) {
        for (const item of message.content) {
          if (item && typeof item === "object") {
            const contentItem = item as Record<string, unknown>;
            if (contentItem.type === "tool_use") {
              handlers.onEvent?.({
                type: "tool_use",
                name: typeof contentItem.name === "string" ? contentItem.name : "tool",
                input: contentItem.input ? JSON.stringify(contentItem.input) : undefined,
              });
            }
          }
        }
      }
      return;
    }

    if (type === "result" && event.is_error === true) {
      state.fatalError = typeof event.result === "string" ? event.result : "Claude turn failed";
      return;
    }

    if (type === "result" && event.subtype === "success" && typeof event.duration_ms === "number") {
      handlers.onEvent?.({ type: "status", text: `turn finished in ${event.duration_ms}ms` });
    }
  }
}
