import type { AgentClient, ProviderName } from "../types.js";
import { ClaudeClient } from "./claude.js";
import { CodexClient } from "./codex.js";

export function createAgentClient(provider: ProviderName, cwd: string, systemPrompt: string, commandPath: string): AgentClient {
  if (provider === "codex") {
    return new CodexClient(provider, cwd, systemPrompt, commandPath);
  }
  return new ClaudeClient(provider, cwd, systemPrompt, commandPath);
}
