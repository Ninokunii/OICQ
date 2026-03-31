import type { OicqSessionMeta, UserImplTaskKind } from "../types.js";

export interface DesktopContextLine {
  lineNumber: number;
  text: string;
}

export interface DesktopRelatedCodeBlock {
  label: string;
  filePath: string;
  startLine?: number;
  code: string[];
}

export interface DesktopTaskPayload {
  requestId: string;
  filePath: string;
  functionName: string;
  instructions: string;
  constraints: string[];
  relatedCode: DesktopRelatedCodeBlock[];
  language: string;
  editableText: string;
  startLine: number;
  endLine: number;
  contextBefore: DesktopContextLine[];
  contextAfter: DesktopContextLine[];
}

export interface DesktopStatePayload {
  session: OicqSessionMeta;
  activeTask: DesktopTaskPayload | null;
}

export interface DesktopSubmitPayload {
  requestId: string;
  editableText: string;
  note: string;
}

export interface DesktopSubmitResult {
  ok: true;
}

export interface DesktopTerminalExitPayload {
  exitCode: number;
}

export interface OicqDesktopApi {
  getState(): Promise<DesktopStatePayload>;
  submitTask(payload: DesktopSubmitPayload): Promise<DesktopSubmitResult>;
  attachTerminal(): Promise<void>;
  sendTerminalInput(data: string): void;
  resizeTerminal(cols: number, rows: number): void;
  onStateChanged(listener: (payload: DesktopStatePayload) => void): () => void;
  onTerminalData(listener: (data: string) => void): () => void;
  onTerminalExit(listener: (payload: DesktopTerminalExitPayload) => void): () => void;
}

declare global {
  interface Window {
    oicq: OicqDesktopApi;
  }
}
