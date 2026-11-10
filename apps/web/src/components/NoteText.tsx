import { useMemo, type ReactNode } from "react";

type Lang =
  | "json"
  | "typescript"
  | "javascript"
  | "python"
  | "shell"
  | "html"
  | "css"
  | "markdown"
  | "yaml"
  | "sql"
  | "go"
  | "rust"
  | "java"
  | "csharp"
  | "cpp"
  | "ruby"
  | "php"
  | "text";

/** GitHub/extension language names → the tokenizer's language set. */
const LANG_ALIASES: Record<string, Lang> = {
  ts: "typescript",
  tsx: "typescript",
  typescript: "typescript",
  js: "javascript",
  jsx: "javascript",
  javascript: "javascript",
  node: "javascript",
  py: "python",
  python: "python",
  sh: "shell",
  bash: "shell",
  zsh: "shell",
  shell: "shell",
  html: "html",
  css: "css",
  scss: "css",
  less: "css",
  md: "markdown",
  markdown: "markdown",
  json: "json",
  yaml: "yaml",
  yml: "yaml",
  sql: "sql",
  go: "go",
  golang: "go",
  rs: "rust",
  rust: "rust",
  java: "java",
  cs: "csharp",
  csharp: "csharp",
  "c#": "csharp",
  c: "cpp",
  h: "cpp",
  cpp: "cpp",
  "c++": "cpp",
  rb: "ruby",
  ruby: "ruby",
  php: "php",
  text: "text",
  plaintext: "text",
};

const KEYWORDS = new Set([
  "const",
  "let",
  "var",
  "function",
  "func",
  "fn",
  "def",
  "return",
  "if",
  "else",
  "elif",
  "for",
  "while",
  "loop",
  "match",
  "switch",
  "case",
  "break",
  "continue",
  "class",
  "struct",
  "enum",
  "trait",
  "impl",
  "interface",
  "type",
  "import",
  "export",
  "from",
  "use",
  "mod",
  "pub",
  "package",
  "namespace",
  "public",
  "private",
  "protected",
  "static",
  "void",
  "int",
  "string",
  "bool",
  "float",
  "double",
  "new",
  "this",
  "super",
  "try",
  "catch",
  "finally",
  "throw",
  "async",
  "await",
  "yield",
  "and",
  "or",
  "not",
  "in",
  "is",
  "nil",
  "null",
  "none",
  "None",
  "true",
  "false",
  "True",
  "False",
  "select",
  "where",
  "insert",
  "update",
  "delete",
  "create",
  "table",
  "join",
  "end",
  "puts",
  "require",
]);

/** Best-effort language guess for a note's original text. */
export function detectLanguage(text: string, hint?: string): Lang {
  const alias = hint ? LANG_ALIASES[hint.trim().toLowerCase()] : undefined;
  if (alias) return alias;
  const t = text.trim();
  if (!t) return "text";
  if (t.startsWith("{") || t.startsWith("[")) {
    try {
      JSON.parse(t);
      return "json";
    } catch {
      // not JSON, keep going
    }
  }
  if (/^<!doctype html/i.test(t) || /<\/?(html|div|span|p|a|ul|li|h[1-6])\b/i.test(t)) {
    return "html";
  }
  if (/^#!|^\$ /m.test(t) || /^(npm|bun|git|cd|sudo|docker)\b/m.test(t)) return "shell";
  if (t.startsWith("<?php")) return "php";
  if (/^package \w+|func \w+\(|:=/m.test(t)) return "go";
  if (/\bfn \w+\(|\blet mut\b|\bimpl\b/.test(t)) return "rust";
  if (/\bpublic class\b|\bSystem\.out\b|\bvoid main\b/.test(t)) return "java";
  if (/\busing System\b|\bnamespace \w+|\bpublic void\b/.test(t)) return "csharp";
  if (/^#include\b|\bstd::|\btemplate\s*</m.test(t)) return "cpp";
  if (/\bputs\b|\brequire ['"]|^\s*def \w+.*\bend\b/ms.test(t)) return "ruby";
  if (/\b(select|insert into|update \w+ set|create table)\b/i.test(t)) return "sql";
  if (/\b(def |from .* import |print\()/.test(t)) return "python";
  if (/\b(const|let|function|interface|=>|import)\b/.test(t)) return "typescript";
  if (/[.#][\w-]+\s*\{[^}]*:/.test(t)) return "css";
  if (/^(#{1,6} |[-*] |\d+\. )/m.test(t)) return "markdown";
  return "text";
}

const TOKEN =
  /(\/\/[^\n]*|\/\*[\s\S]*?\*\/|#[^\n]*|--[^\n]*)|("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|`(?:[^`\\]|\\.)*`)|(-?\b\d+(?:\.\d+)?\b)|([A-Za-z_]\w*)|([{}[\]():,.;=+\-*/<>])/g;

const CODE_LANGS = new Set<Lang>([
  "json",
  "typescript",
  "javascript",
  "python",
  "shell",
  "html",
  "css",
  "yaml",
  "sql",
  "go",
  "rust",
  "java",
  "csharp",
  "cpp",
  "ruby",
  "php",
]);

function tokenize(text: string): ReactNode[] {
  const out: ReactNode[] = [];
  let last = 0;
  let key = 0;
  for (const match of text.matchAll(TOKEN)) {
    const index = match.index ?? 0;
    if (index > last) out.push(text.slice(last, index));
    const [whole, comment, string, number, word, punct] = match;
    let className = "";
    if (comment) className = "text-[var(--syn-comment)]";
    else if (string) className = "text-[var(--syn-string)]";
    else if (number) className = "text-[var(--syn-number)]";
    else if (punct) className = "text-[var(--syn-punct)]";
    else if (word && KEYWORDS.has(word)) className = "text-[var(--syn-keyword)]";
    else if (word && text[index + whole.length] === "(") className = "text-[var(--syn-function)]";
    else if (word && /^[A-Z]/.test(word)) className = "text-[var(--syn-type)]";
    out.push(
      className ? (
        <span key={key++} className={className}>
          {whole}
        </span>
      ) : (
        whole
      ),
    );
    last = index + whole.length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

/** Original note text with a small language detector and theme-aware highlighting. */
export function NoteText({
  text,
  className,
  wrap = true,
  lang: hint,
}: {
  text: string;
  className?: string;
  wrap?: boolean;
  /** Language hint (e.g. GitHub's `TypeScript`) to force highlighting. */
  lang?: string;
}) {
  const lang = useMemo(() => detectLanguage(text, hint), [text, hint]);
  const code = CODE_LANGS.has(lang);
  const body = useMemo(() => (code ? tokenize(text) : text), [code, text]);

  return (
    <pre
      className={`overflow-x-auto overflow-y-auto rounded-[var(--radius)] bg-canvas/50 p-3 leading-relaxed text-text ${
        wrap ? "whitespace-pre-wrap" : "whitespace-pre"
      } ${code ? "font-mono text-[11.5px]" : "font-sans text-[12px]"} ${className ?? ""}`}
    >
      <code>{body}</code>
    </pre>
  );
}
