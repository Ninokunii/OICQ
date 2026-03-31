import { spawn } from "node:child_process";
import readline from "node:readline";

import type { AgentClient, AgentTurnHandlers, AgentTurnResult, ProviderName } from "../types.js";

interface InternalTurnState {
  finalText: string;
  streamedText: string;
  warnings: string[];
  fatalError?: string;
  meta: Record<string, unknown>;
}

export abstract class BaseCliAgentClient implements AgentClient {
  public sessionId?: string;
  public readonly provider: ProviderName;
  private readonly commandPath: string;

  public constructor(
    provider: ProviderName,
    protected readonly cwd: string,
    protected readonly systemPrompt: string,
    commandPath: string,
  ) {
    this.provider = provider;
    this.commandPath = commandPath;
  }

  protected abstract buildArgs(prompt: string): string[];
  protected abstract handleEvent(
    event: Record<string, unknown>,
    state: InternalTurnState,
    handlers: AgentTurnHandlers,
  ): void;

  async runTurn(prompt: string, handlers: AgentTurnHandlers = {}): Promise<AgentTurnResult> {
    const rawEvents: string[] = [];
    const state: InternalTurnState = {
      finalText: "",
      streamedText: "",
      warnings: [],
      meta: {},
    };

    return await new Promise<AgentTurnResult>((resolve) => {
      const child = spawn(this.command, this.buildArgs(prompt), {
        cwd: this.cwd,
        env: process.env,
        stdio: ["ignore", "pipe", "pipe"],
      });

      const stdout = readline.createInterface({ input: child.stdout });

      stdout.on("line", (line) => {
        if (!line.trim()) {
          return;
        }
        rawEvents.push(line);
        try {
          const event = JSON.parse(line) as Record<string, unknown>;
          this.handleEvent(event, state, handlers);
        } catch {
          state.warnings.push(line);
          handlers.onWarning?.(line);
        }
      });

      child.stderr.on("data", (chunk: Buffer) => {
        const text = chunk.toString("utf8").trim();
        if (!text) {
          return;
        }
        state.warnings.push(text);
        handlers.onWarning?.(text);
      });

      child.on("close", (code) => {
        const finalText = state.finalText || state.streamedText;
        const error = state.fatalError ?? (code && code !== 0 ? `${this.provider} exited with code ${code}` : undefined);
        resolve({
          sessionId: this.sessionId,
          text: finalText,
          rawEvents,
          error,
        });
      });

      child.on("error", (error) => {
        resolve({
          sessionId: this.sessionId,
          text: "",
          rawEvents,
          error: error instanceof Error ? error.message : String(error),
        });
      });
    });
  }

  protected setSession(sessionId: string, handlers: AgentTurnHandlers): void {
    this.sessionId = sessionId;
    handlers.onSession?.(sessionId);
  }

  protected get command(): string {
    return this.commandPath;
  }
}
