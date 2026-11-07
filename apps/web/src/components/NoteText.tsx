import { useMemo, type ReactNode } from "react";

type Lang = "json" | "typescript" | "python" | "shell" | "html" | "css" | "markdown" | "text";

const KEYWORDS = new Set([
  "const",
  "let",
  "var",
  "function",
  "return",
  "if",
  "else",
  "for",
  "while",
  "class",
  "import",
  "export",
  "from",
  "def",
  "async",
  "await",
  "new",
  "type",
  "interface",
  "true",
  "false",
  "null",
  "none",
  "None",
  "True",
  "False",
]);

/** Best-effort language guess for a note's original text. */
export function detectLanguage(text: string): Lang {
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
  if (/\b(def |class |from .* import |print\()/.test(t)) return "python";
  if (/\b(const|let|function|interface|=>|import)\b/.test(t)) return "typescript";
  if (/[.#][\w-]+\s*\{[^}]*:/.test(t)) return "css";
  if (/^(#{1,6} |[-*] |\d+\. )/m.test(t)) return "markdown";
  return "text";
}

const TOKEN =
  /(\/\/[^\n]*|\/\*[\s\S]*?\*\/|#[^\n]*)|("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|`(?:[^`\\]|\\.)*`)|(-?\b\d+(?:\.\d+)?\b)|([A-Za-z_]\w*)|([{}[\]():,.;=+\-*/<>])/g;

const CODE_LANGS = new Set<Lang>(["json", "typescript", "python", "shell", "html", "css"]);

function tokenize(text: string): ReactNode[] {
  const out: ReactNode[] = [];
  let last = 0;
  let key = 0;
  for (const match of text.matchAll(TOKEN)) {
    const index = match.index ?? 0;
    if (index > last) out.push(text.slice(last, index));
    const [whole, comment, string, number, word, punct] = match;
    let className = "";
    if (comment) className = "text-faint";
    else if (string) className = "text-accent";
    else if (number) className = "text-muted";
    else if (punct) className = "text-faint";
    else if (word && KEYWORDS.has(word)) className = "text-accent";
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
}: {
  text: string;
  className?: string;
  wrap?: boolean;
}) {
  const lang = useMemo(() => detectLanguage(text), [text]);
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
