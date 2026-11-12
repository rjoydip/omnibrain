/**
 * Small, dependency-free markdown subset for note previews.
 * Supports headings, paragraphs, lists, quotes, rules, fenced code,
 * inline code, bold, italic, strikethrough and links. Raw HTML is never
 * interpreted — the renderer maps this tree to React elements.
 *
 * ponytail: intentionally incomplete (no tables, images, nested lists);
 * swap for a full parser if notes ever need CommonMark parity.
 */

export type MarkdownInline =
  | { type: "text"; value: string }
  | { type: "strong"; children: MarkdownInline[] }
  | { type: "em"; children: MarkdownInline[] }
  | { type: "del"; children: MarkdownInline[] }
  | { type: "code"; value: string }
  | { type: "link"; href: string; children: MarkdownInline[] }
  | { type: "break" };

export type MarkdownBlock =
  | { type: "heading"; level: number; children: MarkdownInline[] }
  | { type: "paragraph"; children: MarkdownInline[] }
  | { type: "list"; ordered: boolean; start: number; items: MarkdownInline[][] }
  | { type: "tasks"; items: Array<{ checked: boolean; children: MarkdownInline[] }> }
  | {
      type: "table";
      align: Array<"left" | "center" | "right" | null>;
      header: MarkdownInline[][];
      rows: MarkdownInline[][][];
    }
  | { type: "code"; lang: string | null; value: string }
  | { type: "quote"; children: MarkdownBlock[] }
  | { type: "rule" };

const FENCE = /^ {0,3}(?:```|~~~)\s*(\S*)\s*$/;
const HEADING = /^ {0,3}(#{1,6})\s+(.*?)\s*#*\s*$/;
const RULE = /^ {0,3}(?:(?:\*\s*){3,}|(?:-\s*){3,}|(?:_\s*){3,})$/;
const QUOTE = /^ {0,3}>\s?(.*)$/;
const BULLET = /^ {0,3}[-*+]\s+(.*)$/;
const NUMBERED = /^ {0,3}(\d{1,9})[.)]\s+(.*)$/;
const TASK = /^ {0,3}[-*+]\s+\[([ xX])\]\s+(.*)$/;
const TABLE_SEP = /^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)*\|?\s*$/;

function isTableStart(lines: string[], index: number): boolean {
  return (lines[index] ?? "").includes("|") && TABLE_SEP.test(lines[index + 1] ?? "");
}

function blockStart(lines: string[], index: number): boolean {
  const line = lines[index] ?? "";
  return (
    FENCE.test(line) ||
    HEADING.test(line) ||
    RULE.test(line) ||
    QUOTE.test(line) ||
    BULLET.test(line) ||
    NUMBERED.test(line) ||
    TASK.test(line) ||
    isTableStart(lines, index)
  );
}

function splitRow(line: string): string[] {
  const trimmed = line.trim().replace(/^\|/, "").replace(/\|$/, "");
  const cells: string[] = [];
  let current = "";
  for (let i = 0; i < trimmed.length; i++) {
    const char = trimmed[i] ?? "";
    if (char === "\\" && trimmed[i + 1] === "|") {
      current += "|";
      i++;
      continue;
    }
    if (char === "|") {
      cells.push(current.trim());
      current = "";
      continue;
    }
    current += char;
  }
  cells.push(current.trim());
  return cells;
}

function parseAlign(cell: string): "left" | "center" | "right" | null {
  const left = cell.startsWith(":");
  const right = cell.endsWith(":");
  if (left && right) return "center";
  if (left) return "left";
  if (right) return "right";
  return null;
}

function safeHref(href: string): string | null {
  if (/^(https?:|mailto:)/i.test(href)) return href;
  if (/^(#|\/|\.{1,2}\/)/.test(href)) return href;
  return null;
}

function parseInline(text: string): MarkdownInline[] {
  const nodes: MarkdownInline[] = [];
  let buffer = "";
  let i = 0;

  const flush = () => {
    if (buffer) nodes.push({ type: "text", value: buffer });
    buffer = "";
  };

  while (i < text.length) {
    const rest = text.slice(i);
    const char = rest[0] ?? "";

    if (char === "\n") {
      flush();
      nodes.push({ type: "break" });
      i++;
      continue;
    }

    const code = /^`([^`\n]+)`/.exec(rest);
    if (code) {
      flush();
      nodes.push({ type: "code", value: code[1] ?? "" });
      i += code[0].length;
      continue;
    }

    const link = /^\[([^\]\n]+)\]\(([^)\s]+)(?:\s+"[^"]*")?\)/.exec(rest);
    if (link) {
      const href = safeHref(link[2] ?? "");
      if (href) {
        flush();
        nodes.push({ type: "link", href, children: parseInline(link[1] ?? "") });
        i += link[0].length;
        continue;
      }
    }

    const strong = /^(\*\*|__)(?=\S)([\s\S]*?\S)\1/.exec(rest);
    if (strong) {
      flush();
      nodes.push({ type: "strong", children: parseInline(strong[2] ?? "") });
      i += strong[0].length;
      continue;
    }

    const del = /^~~(?=\S)([\s\S]*?\S)~~/.exec(rest);
    if (del) {
      flush();
      nodes.push({ type: "del", children: parseInline(del[1] ?? "") });
      i += del[0].length;
      continue;
    }

    const em = /^(\*|_)(?=\S)([\s\S]*?\S)\1/.exec(rest);
    if (em && (char !== "_" || !/[A-Za-z0-9]/.test(text[i - 1] ?? ""))) {
      flush();
      nodes.push({ type: "em", children: parseInline(em[2] ?? "") });
      i += em[0].length;
      continue;
    }

    buffer += char;
    i++;
  }

  flush();
  return nodes;
}

/** Parse markdown into a render-agnostic block tree. */
export function parseMarkdown(source: string): MarkdownBlock[] {
  const lines = source.replace(/\r\n?/g, "\n").split("\n");
  const blocks: MarkdownBlock[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i] ?? "";

    if (!line.trim()) {
      i++;
      continue;
    }

    const fence = FENCE.exec(line);
    if (fence) {
      const lang = fence[1] || null;
      const body: string[] = [];
      i++;
      while (i < lines.length && !FENCE.test(lines[i] ?? "")) {
        body.push(lines[i] ?? "");
        i++;
      }
      if (i < lines.length) i++;
      blocks.push({ type: "code", lang, value: body.join("\n") });
      continue;
    }

    const heading = HEADING.exec(line);
    if (heading) {
      blocks.push({
        type: "heading",
        level: (heading[1] ?? "#").length,
        children: parseInline(heading[2] ?? ""),
      });
      i++;
      continue;
    }

    if (isTableStart(lines, i)) {
      const header = splitRow(line).map((cell) => parseInline(cell));
      const align = splitRow(lines[i + 1] ?? "").map(parseAlign);
      i += 2;
      const rows: MarkdownInline[][][] = [];
      while (i < lines.length) {
        const current = lines[i] ?? "";
        if (!current.trim() || !current.includes("|")) break;
        rows.push(splitRow(current).map((cell) => parseInline(cell)));
        i++;
      }
      blocks.push({ type: "table", align, header, rows });
      continue;
    }

    if (RULE.test(line)) {
      blocks.push({ type: "rule" });
      i++;
      continue;
    }

    if (QUOTE.test(line)) {
      const body: string[] = [];
      while (i < lines.length) {
        const match = QUOTE.exec(lines[i] ?? "");
        if (!match) break;
        body.push(match[1] ?? "");
        i++;
      }
      blocks.push({ type: "quote", children: parseMarkdown(body.join("\n")) });
      continue;
    }

    const task = TASK.exec(line);
    if (task) {
      const items: Array<{ checked: boolean; children: MarkdownInline[] }> = [];
      while (i < lines.length) {
        const match = TASK.exec(lines[i] ?? "");
        if (!match) break;
        items.push({
          checked: (match[1] ?? "").toLowerCase() === "x",
          children: parseInline(match[2] ?? ""),
        });
        i++;
      }
      blocks.push({ type: "tasks", items });
      continue;
    }

    const bullet = BULLET.exec(line);
    const numbered = NUMBERED.exec(line);
    if (bullet || numbered) {
      const ordered = Boolean(numbered);
      const start = numbered ? Number(numbered[1]) : 1;
      const items: MarkdownInline[][] = [];
      while (i < lines.length) {
        const current = lines[i] ?? "";
        const match = ordered ? NUMBERED.exec(current) : BULLET.exec(current);
        if (!match) break;
        const text = ordered ? (match[2] ?? "") : (match[1] ?? "");
        items.push(parseInline(text));
        i++;
      }
      blocks.push({ type: "list", ordered, start, items });
      continue;
    }

    const paragraph: string[] = [];
    while (i < lines.length) {
      const current = lines[i] ?? "";
      if (!current.trim() || (paragraph.length > 0 && blockStart(lines, i))) break;
      paragraph.push(current.trim());
      i++;
    }
    blocks.push({ type: "paragraph", children: parseInline(paragraph.join("\n")) });
  }

  return blocks;
}

const MARKDOWN_HINT =
  /(^|\n)\s{0,3}(?:#{1,6}\s|>\s|[-*+]\s|\d{1,9}[.)]\s|```|~~~)|(?:^|\n)\s{0,3}(?:(?:\*\s*){3,}|(?:-\s*){3,}|(?:_\s*){3,})\s*(?:\n|$)|\*\*[^*\n]+\*\*|__[^_\n]+__|`[^`\n]+`|\[[^\]\n]+\]\([^)\s]+\)|~~[^~\n]+~~|(?:^|[\s(])\*[^*\s][^*\n]*\*|(?:^|\n)\s*\|?.+\|.+\n\s*\|?\s*:?-{3,}/;

/** Best-effort check: does this note contain markdown worth previewing? */
export function isMarkdown(text: string): boolean {
  return MARKDOWN_HINT.test(text);
}
