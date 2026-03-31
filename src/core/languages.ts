import path from "node:path";

export const ansi = {
  reset: "\u001b[0m",
  bold: "\u001b[1m",
  dim: "\u001b[2m",
  red: "\u001b[31m",
  green: "\u001b[32m",
  yellow: "\u001b[33m",
  blue: "\u001b[34m",
  magenta: "\u001b[35m",
  cyan: "\u001b[36m",
  gray: "\u001b[90m",
  reverse: "\u001b[7m",
};

const KEYWORDS: Record<string, string[]> = {
  python: [
    "def",
    "class",
    "return",
    "if",
    "elif",
    "else",
    "for",
    "while",
    "try",
    "except",
    "import",
    "from",
    "with",
    "as",
    "pass",
    "None",
    "True",
    "False",
  ],
  javascript: [
    "function",
    "return",
    "const",
    "let",
    "var",
    "if",
    "else",
    "for",
    "while",
    "class",
    "new",
    "await",
    "async",
    "null",
    "true",
    "false",
  ],
  typescript: [
    "function",
    "return",
    "const",
    "let",
    "type",
    "interface",
    "implements",
    "extends",
    "if",
    "else",
    "for",
    "while",
    "class",
    "new",
    "await",
    "async",
    "null",
    "true",
    "false",
  ],
  go: [
    "func",
    "return",
    "if",
    "else",
    "for",
    "range",
    "type",
    "struct",
    "interface",
    "package",
    "import",
    "nil",
    "true",
    "false",
  ],
  rust: [
    "fn",
    "let",
    "mut",
    "impl",
    "struct",
    "enum",
    "trait",
    "return",
    "if",
    "else",
    "match",
    "for",
    "while",
    "loop",
    "pub",
    "use",
    "crate",
    "self",
    "true",
    "false",
  ],
};

const LANGUAGE_BY_EXTENSION: Record<string, string> = {
  ".py": "python",
  ".js": "javascript",
  ".jsx": "javascript",
  ".ts": "typescript",
  ".tsx": "typescript",
  ".go": "go",
  ".rs": "rust",
};

export function detectLanguage(filePath: string): string {
  return LANGUAGE_BY_EXTENSION[path.extname(filePath).toLowerCase()] ?? "plain";
}

export function color(text: string, code: string): string {
  return `${code}${text}${ansi.reset}`;
}

export function highlightLine(line: string, language: string): string {
  if (language === "plain") {
    return line;
  }

  let output = line;
  const keywords = KEYWORDS[language];
  if (keywords) {
    const pattern = new RegExp(`\\b(${keywords.join("|")})\\b`, "g");
    output = output.replace(pattern, (match) => color(match, ansi.cyan));
  }

  if (language === "python" && output.trimStart().startsWith("#")) {
    return color(output, ansi.gray);
  }

  if ((language === "javascript" || language === "typescript" || language === "go" || language === "rust") && output.trimStart().startsWith("//")) {
    return color(output, ansi.gray);
  }

  return output;
}
