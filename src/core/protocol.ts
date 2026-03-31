import { createTwoFilesPatch } from "diff";

import type { ActiveTask, UserImplRequest, UserImplReview } from "../types.js";

const REQUEST_FENCE = "user-impl-request";
const REVIEW_FENCE = "user-impl-review";

function extractFencePayload<T>(text: string, fenceName: string): { value?: T; rawBlock?: string; error?: string } {
  const pattern = new RegExp(String.raw`^\`\`\`${fenceName}\s*([\s\S]*?)^\`\`\`\s*$`, "m");
  const match = text.match(pattern);
  if (!match) {
    return {};
  }
  const rawBlock = match[0];
  try {
    return {
      value: JSON.parse(match[1].trim()) as T,
      rawBlock,
    };
  } catch (error) {
    return {
      rawBlock,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

function stripBlock(text: string, rawBlock?: string): string {
  if (!rawBlock) {
    return text.trim();
  }
  return text.replace(rawBlock, "").trim();
}

export function buildHostSystemPrompt(extraSystemPrompt?: string): string {
  const hostPrompt = `
You are running inside a host called OICQ.

When code must be implemented by the user, you must not directly write the chosen function. Instead, pick the smallest single function task and emit exactly one fenced JSON block with the language tag \`${REQUEST_FENCE}\`.

Schema for \`${REQUEST_FENCE}\`:
\`\`\`${REQUEST_FENCE}
{
  "kind": "implement_function_body" | "insert_function_at_marker",
  "file_path": "relative/path/from/workspace",
  "function_name": "name",
  "instructions": "what the user must implement",
  "constraints": ["optional constraint", "another optional constraint"],
  "related_code": [
    {
      "label": "what this snippet is",
      "file_path": "relative/path/from/workspace",
      "start_line": 12,
      "code": ["exact line 1", "exact line 2"]
    }
  ],
  "blocking": true | false,
  "start_line": 10,
  "end_line": 18,
  "insert_after_line": 42,
  "initial_content": ["optional line 1", "optional line 2"]
}
\`\`\`

Rules:
- Emit exactly one user implementation request for each new code-changing user request.
- A previously completed user implementation request does not satisfy later code-changing requests in the same session.
- Never open more than one active user task at the same time.
- The task must target exactly one existing function body or one inserted function.
- Use relative file paths.
- Include \`related_code\` when the user needs exact snippets outside the editable region, such as maps, constants, helper signatures, or relevant call sites.
- For "implement_function_body", include \`start_line\` and \`end_line\`.
- For "insert_function_at_marker", include \`insert_after_line\`. \`initial_content\` is optional but helpful.
- For "insert_function_at_marker", prefer a TODO comment placeholder inside the stub instead of throw/panic/raise placeholders.
- After opening a user task, never directly modify that target file yourself.

When the host later sends a USER_IMPL_SUBMISSION review request, you must review the submission and respond with normal prose plus exactly one fenced JSON block with the language tag \`${REVIEW_FENCE}\`.

Schema for \`${REVIEW_FENCE}\`:
\`\`\`${REVIEW_FENCE}
{
  "status": "accept" | "revise",
  "feedback": "short review summary",
  "issues": ["optional issue", "optional issue"]
}
\`\`\`

If the implementation is acceptable, return "accept". If not, return "revise" and explain the issues.
`.trim();

  return extraSystemPrompt ? `${hostPrompt}\n\n${extraSystemPrompt.trim()}` : hostPrompt;
}

export function parseAssistantText(text: string): {
  visibleText: string;
  request?: UserImplRequest;
  requestError?: string;
  review?: UserImplReview;
  reviewError?: string;
} {
  const request = extractFencePayload<UserImplRequest>(text, REQUEST_FENCE);
  const review = extractFencePayload<UserImplReview>(text, REVIEW_FENCE);

  return {
    visibleText: stripBlock(stripBlock(text, request.rawBlock), review.rawBlock),
    request: request.value,
    requestError: request.error,
    review: review.value,
    reviewError: review.error,
  };
}

export function buildReviewPrompt(task: ActiveTask, fileText: string, note: string): string {
  const diff = createTwoFilesPatch(
    task.displayPath,
    task.displayPath,
    task.originalLines.join(task.newline),
    fileText,
    "original",
    "user_submission",
  );

  const constraints = task.request.constraints && task.request.constraints.length > 0
    ? task.request.constraints.map((constraint) => `- ${constraint}`).join("\n")
    : "- none";

  return `
USER_IMPL_SUBMISSION

Please review the user's implementation for the active OICQ task. Do not modify the target file.

Task:
- kind: ${task.request.kind}
- file: ${task.displayPath}
- function: ${task.request.function_name}
- instructions: ${task.request.instructions}
- constraints:
${constraints}

User note:
${note || "(none)"}

Unified diff:
\`\`\`diff
${diff.trim()}
\`\`\`

Reply with concise prose plus one \`${REVIEW_FENCE}\` fenced JSON block.
`.trim();
}

export function buildContinuePrompt(task: ActiveTask): string {
  return `
The user implementation task is now open in OICQ for file ${task.displayPath}. You may continue only unrelated analysis or planning work. Do not modify ${task.displayPath} while the task is active.
`.trim();
}
