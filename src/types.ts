export type ProviderName = "claude" | "codex";
export type OicqEditorMode = "desktop" | "web" | "tui";
export type OicqEditorState = "closed" | "launching" | "open";

export type MessageRole =
  | "system"
  | "user"
  | "assistant"
  | "status"
  | "error"
  | "thinking"
  | "tool"
  | "stdout"
  | "meta";

export interface ChatMessage {
  id: string;
  role: MessageRole;
  text: string;
  pending?: boolean;
  timestamp: number;
}

export type UserImplTaskKind = "implement_function_body" | "insert_function_at_marker";

export interface UserImplRelatedCodeBlock {
  label: string;
  file_path: string;
  start_line?: number;
  code: string[];
}

export interface UserImplRequest {
  kind: UserImplTaskKind;
  file_path: string;
  function_name: string;
  instructions: string;
  constraints?: string[];
  related_code?: UserImplRelatedCodeBlock[];
  blocking?: boolean;
  start_line?: number;
  end_line?: number;
  insert_after_line?: number;
  initial_content?: string[];
}

export interface UserImplReview {
  status: "accept" | "revise";
  feedback: string;
  issues?: string[];
}

export type AgentDisplayEvent =
  | { type: "session"; sessionId: string }
  | { type: "status"; text: string }
  | { type: "thinking_delta"; text: string }
  | { type: "thinking_done" }
  | { type: "tool_use"; name: string; input?: string }
  | { type: "tool_result"; stdout?: string; stderr?: string; isError?: boolean };

export interface AgentTurnHandlers {
  onSession?: (sessionId: string) => void;
  onDelta?: (text: string) => void;
  onWarning?: (warning: string) => void;
  onEvent?: (event: AgentDisplayEvent) => void;
}

export interface AgentTurnResult {
  sessionId?: string;
  text: string;
  rawEvents: string[];
  error?: string;
}

export interface AgentClient {
  readonly provider: ProviderName;
  sessionId?: string;
  runTurn(prompt: string, handlers?: AgentTurnHandlers): Promise<AgentTurnResult>;
}

export interface ActiveTask {
  request: UserImplRequest;
  absolutePath: string;
  displayPath: string;
  language: string;
  newline: string;
  originalLines: string[];
  bufferLines: string[];
  cursorLine: number;
  cursorColumn: number;
  scrollLine: number;
  status: "editing" | "reviewing" | "accepted";
  review?: UserImplReview;
  frozenFileText: string;
}

export interface AppOptions {
  provider: ProviderName;
  cwd: string;
  systemPrompt?: string;
  commandPath: string;
}

export interface OicqSessionMeta {
  id: string;
  provider: ProviderName;
  cwd: string;
  sessionDir: string;
  createdAt: number;
  realMode: boolean;
  status: "idle" | "awaiting_user" | "closed";
  editorMode: OicqEditorMode;
  editorState: OicqEditorState;
  editorUrl?: string;
  lastRequestId?: string;
}

export interface OicqToolRequestRecord {
  id: string;
  provider: ProviderName;
  cwd: string;
  absolutePath: string;
  createdAt: number;
  request: UserImplRequest;
  originalFileText: string;
}

export interface OicqToolResultRecord {
  requestId: string;
  submittedAt: number;
  note: string;
  updatedFileText: string;
}
