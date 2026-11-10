import { Badge, Button, Tooltip } from "@omnibrain/ui";
import { isMarkdown } from "@omnibrain/core/markdown";
import { lazy, Suspense, useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowUpRightIcon,
  CheckIcon,
  CloseIcon,
  CodeIcon,
  CopyIcon,
  DownloadIcon,
  EyeIcon,
  RefreshIcon,
  RestoreIcon,
  SparkIcon,
  TrashIcon,
  WrapIcon,
} from "../components/icons";
import { NoteText } from "../components/NoteText";
import { SourceGlyph } from "../components/SourceGlyph";
import { api, type Item, type RelatedItem } from "../lib/api";
import { dayLabel, sourceMeta, timeLabel } from "../lib/format";

const Markdown = lazy(() =>
  import("../components/Markdown").then((m) => ({ default: m.Markdown })),
);
const LangLogo = lazy(() =>
  import("../components/LangIcon").then((m) => ({ default: m.LangIcon })),
);

const LANG_META: Record<string, { label: string; color: string; short: string }> = {
  typescript: { label: "TypeScript", color: "#3178c6", short: "TS" },
  ts: { label: "TypeScript", color: "#3178c6", short: "TS" },
  tsx: { label: "TypeScript", color: "#3178c6", short: "TS" },
  javascript: { label: "JavaScript", color: "#d4b106", short: "JS" },
  js: { label: "JavaScript", color: "#d4b106", short: "JS" },
  jsx: { label: "JavaScript", color: "#d4b106", short: "JS" },
  python: { label: "Python", color: "#3776ab", short: "PY" },
  py: { label: "Python", color: "#3776ab", short: "PY" },
  markdown: { label: "Markdown", color: "#8a8f98", short: "MD" },
  md: { label: "Markdown", color: "#8a8f98", short: "MD" },
  shell: { label: "Shell", color: "#4eaa25", short: "SH" },
  bash: { label: "Shell", color: "#4eaa25", short: "SH" },
  sh: { label: "Shell", color: "#4eaa25", short: "SH" },
  json: { label: "JSON", color: "#b8860b", short: "{}" },
  yaml: { label: "YAML", color: "#cb171e", short: "Y" },
  yml: { label: "YAML", color: "#cb171e", short: "Y" },
  sql: { label: "SQL", color: "#e38c00", short: "SQL" },
  go: { label: "Go", color: "#00add8", short: "GO" },
  rust: { label: "Rust", color: "#dea584", short: "RS" },
  rs: { label: "Rust", color: "#dea584", short: "RS" },
  java: { label: "Java", color: "#b07219", short: "JV" },
  csharp: { label: "C#", color: "#178600", short: "C#" },
  cs: { label: "C#", color: "#178600", short: "C#" },
  cpp: { label: "C++", color: "#f34b7d", short: "C+" },
  c: { label: "C", color: "#7a8290", short: "C" },
  ruby: { label: "Ruby", color: "#cc342d", short: "RB" },
  rb: { label: "Ruby", color: "#cc342d", short: "RB" },
  php: { label: "PHP", color: "#4f5d95", short: "PHP" },
  html: { label: "HTML", color: "#e34c26", short: "<>" },
  css: { label: "CSS", color: "#563d7c", short: "#" },
};

function langMeta(lang?: string): { label: string; color: string; short: string } {
  return (
    LANG_META[(lang ?? "").toLowerCase()] ?? {
      label: lang ?? "Unknown",
      color: "#8a8f98",
      short: "?",
    }
  );
}

/** Fallback while the language icon chunk loads. */
function LangMark({ lang, size = 13 }: { lang?: string; size?: number }) {
  const meta = langMeta(lang);
  return (
    <span
      aria-hidden="true"
      className="grid shrink-0 place-items-center rounded-[3px] font-mono font-semibold leading-none"
      style={{
        width: size,
        height: size,
        background: `${meta.color}26`,
        color: meta.color,
        fontSize: Math.max(6, Math.round(size * 0.5)),
      }}
    >
      {meta.short}
    </span>
  );
}

function LangIcon({ lang, size = 13 }: { lang?: string; size?: number }) {
  return (
    <Suspense fallback={<LangMark lang={lang} size={size} />}>
      <LangLogo lang={lang} size={size} />
    </Suspense>
  );
}

const TAG_TONES = [
  "bg-amber/10 text-amber",
  "bg-coral/10 text-coral",
  "bg-amber/15 text-amber",
  "bg-coral/15 text-coral",
];

/** Stable per-tag tone so a row of tags is readable, not one repeated accent. */
function tagTone(tag: string): string {
  let hash = 0;
  for (const char of tag) hash = (hash * 31 + char.charCodeAt(0)) | 0;
  return TAG_TONES[Math.abs(hash) % TAG_TONES.length]!;
}

const EXT_LANG: Record<string, string> = {
  md: "markdown",
  markdown: "markdown",
  js: "javascript",
  jsx: "javascript",
  ts: "typescript",
  tsx: "typescript",
  py: "python",
  sh: "shell",
  bash: "shell",
  json: "json",
  yaml: "yaml",
  yml: "yaml",
  sql: "sql",
  go: "go",
  rs: "rust",
  java: "java",
  cs: "csharp",
  cpp: "cpp",
  c: "cpp",
  rb: "ruby",
  php: "php",
  html: "html",
  css: "css",
};

function langFromName(name: string): string | undefined {
  const ext = name.split(".").pop()?.toLowerCase() ?? "";
  return EXT_LANG[ext];
}

/** Fallback for gists imported before structured files: parse our markdown sections. */
function parseFileSections(text: string): Array<{ name: string; lang?: string; content: string }> {
  const out: Array<{ name: string; lang?: string; content: string }> = [];
  const pattern = /^## (.+)\n\n```([^\n]*)\n([\s\S]*?)\n```/gm;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(text))) {
    out.push({
      name: (match[1] ?? "file").trim(),
      lang: (match[2] ?? "").trim() || undefined,
      content: match[3] ?? "",
    });
  }
  return out;
}

/** Legacy single-blob format: `// filename` followed by the file body. */
function parseLegacyFileSections(
  text: string,
): Array<{ name: string; lang?: string; content: string }> {
  const out: Array<{ name: string; lang?: string; content: string }> = [];
  const pattern =
    /(?:^|\n\n)\/\/ ([\w .-]+\.[A-Za-z0-9]+)\n([\s\S]*?)(?=\n\n\/\/ [\w .-]+\.[A-Za-z0-9]+\n|$)/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(text))) {
    const name = (match[1] ?? "file").trim();
    out.push({ name, lang: langFromName(name), content: (match[2] ?? "").trimEnd() });
  }
  return out;
}

function Provenance({ item }: { item: Item }) {
  return (
    <div className="rounded-[var(--radius)] bg-raised p-3">
      <div className="mb-1.5 flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-[0.14em] text-accent">
        <SparkIcon size={12} />
        AI summary · generated
      </div>
      <p className="text-[12.5px] leading-relaxed text-text/90">{item.summary}</p>
      <p className="mt-2 font-mono text-[10px] text-faint">
        from extracted page text · not the author&apos;s words
      </p>
    </div>
  );
}

export function Inspector({
  item,
  width,
  onWidthChange,
  onDelete,
  onRetry,
  onRestore,
  onOpenItem,
  onClose,
}: {
  item: Item | null;
  width: number;
  onWidthChange: (width: number) => void;
  onDelete: (id: string) => Promise<void>;
  onRetry: (id: string) => Promise<void>;
  onRestore: (id: string) => Promise<void>;
  onOpenItem: (id: string) => void;
  onClose: () => void;
}) {
  const expanded = width >= 430;
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [resizing, setResizing] = useState(false);
  const [rawFor, setRawFor] = useState<string | null>(null);
  const [wrapText, setWrapText] = useState(true);
  const [copied, setCopied] = useState<string | null>(null);
  const [fileIndex, setFileIndex] = useState(0);
  const dragRef = useRef<{ x: number; width: number } | null>(null);
  const [related, setRelated] = useState<RelatedItem[]>([]);
  const itemId = item?.id;

  useEffect(() => {
    if (!itemId) {
      setRelated([]);
      return;
    }
    let cancelled = false;
    setRelated([]);
    api
      .related(itemId, 6)
      .then((res) => {
        if (!cancelled) setRelated(res.items);
        return null;
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [itemId]);

  const rawNote = Boolean(item) && rawFor === item?.id;

  const files = useMemo<Array<{ name: string; lang?: string; content: string }>>(() => {
    if (item?.files_json) {
      try {
        const parsed: unknown = JSON.parse(item.files_json);
        if (Array.isArray(parsed)) return parsed;
      } catch {
        // fall through to the markdown sections
      }
    }
    if (item?.source === "github" && item.excerpt) {
      if (item.lang === "markdown" && item.excerpt.startsWith("## ")) {
        const parsed = parseFileSections(item.excerpt);
        if (parsed.length > 0) return parsed;
      }
      const legacy = parseLegacyFileSections(item.excerpt);
      if (legacy.length > 0) return legacy;
    }
    return [];
  }, [item]);
  const safeFileIndex = Math.min(fileIndex, Math.max(0, files.length - 1));
  const activeFile = files[safeFileIndex];
  const content = activeFile?.content ?? item?.excerpt ?? "";
  const contentLang = activeFile?.lang ?? item?.lang ?? undefined;
  const tabs =
    files.length > 0
      ? files
      : [{ name: item?.kind === "note" ? "Note" : "Extracted text", lang: contentLang, content }];
  const languages = useMemo(() => {
    const list = files.length > 0 ? files.map((file) => file.lang) : [contentLang];
    return [...new Set(list.filter((lang): lang is string => Boolean(lang)))];
  }, [files, contentLang]);

  const noteIsMarkdown =
    item?.kind === "note" && item.excerpt
      ? item.lang
        ? item.lang === "markdown"
        : isMarkdown(item.excerpt)
      : false;
  // Older gist items imported as bookmarks: still detect markdown, otherwise
  // NoteText highlights code by content type.
  const extractedMarkdown =
    item && item.kind !== "note" && item.source === "github" && item.excerpt
      ? isMarkdown(item.excerpt)
      : false;

  const activeMarkdown = activeFile
    ? activeFile.lang
      ? activeFile.lang === "markdown"
      : isMarkdown(activeFile.content)
    : noteIsMarkdown || extractedMarkdown;

  const codeView = Boolean(content) && !activeMarkdown;

  const downloadExcerpt = () => {
    if (!item || !content) return;
    const extensions: Record<string, string> = {
      typescript: "ts",
      ts: "ts",
      javascript: "js",
      js: "js",
      python: "py",
      py: "py",
      markdown: "md",
      md: "md",
      shell: "sh",
      bash: "sh",
      html: "html",
      css: "css",
      json: "json",
      yaml: "yml",
      yml: "yml",
      sql: "sql",
      go: "go",
      rust: "rs",
      java: "java",
      csharp: "cs",
      cpp: "cpp",
      ruby: "rb",
      php: "php",
    };
    const ext = contentLang ? (extensions[contentLang.toLowerCase()] ?? "txt") : "txt";
    const slug =
      item.title
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "")
        .slice(0, 60) || "item";
    const fileName = activeFile
      ? activeFile.name.replace(/[^a-zA-Z0-9._-]+/g, "-")
      : `${slug}.${ext}`;
    const url = URL.createObjectURL(new Blob([content], { type: "text/plain;charset=utf-8" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = fileName;
    link.click();
    URL.revokeObjectURL(url);
  };

  const copyExcerpt = async () => {
    if (!item || !content) return;
    try {
      await navigator.clipboard.writeText(content);
      setCopied(item.id);
      setTimeout(() => setCopied(null), 1500);
    } catch {
      // Clipboard can be unavailable outside a secure context.
    }
  };

  const startResize = (e: React.PointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    dragRef.current = { x: e.clientX, width };
    setResizing(true);
    document.body.style.userSelect = "none";
    const move = (event: PointerEvent) => {
      const start = dragRef.current;
      if (!start) return;
      onWidthChange(Math.min(720, Math.max(300, start.width + (start.x - event.clientX))));
    };
    const up = () => {
      dragRef.current = null;
      setResizing(false);
      document.body.style.userSelect = "";
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  const nudge = (delta: number) => {
    onWidthChange(Math.min(720, Math.max(300, width + delta)));
  };

  const body = item ? (
    <div className="space-y-2.5">
      <div>
        <h2
          className={`text-balance break-words font-semibold leading-snug tracking-[-0.02em] ${
            expanded ? "text-[17px]" : "text-[15.5px]"
          }`}
        >
          {item.title}
        </h2>
        <div className="mt-2 flex flex-wrap items-center gap-1.5">
          <Badge tone="cobalt">{sourceMeta(item.source).label}</Badge>
          {item.kind === "bookmark" ? null : <Badge tone="muted">{item.kind}</Badge>}
          {item.embedding_state === "ready" ? <Badge tone="mint">embedded</Badge> : null}
          {item.embedding_state === "pending" ? (
            <Badge tone="muted" className="bg-amber/10 text-amber">
              enriching
            </Badge>
          ) : null}
          {item.embedding_state === "failed" ? <Badge tone="coral">failed</Badge> : null}
        </div>
      </div>

      {item.summary ? <Provenance item={item} /> : null}

      {content ? (
        <div>
          <div className="mb-1.5 flex items-center justify-between gap-2">
            <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-faint">
              {item.kind === "note" ? "Original note" : "Extracted text"}
            </span>
            <div className="flex items-center gap-0.5">
              <Tooltip label={copied === item.id ? "Copied" : "Copy text"}>
                <button
                  type="button"
                  onClick={() => void copyExcerpt()}
                  aria-label="Copy text"
                  className="grid size-6 place-items-center rounded-[5px] text-faint transition hover:bg-raised hover:text-text"
                >
                  {copied === item.id ? (
                    <CheckIcon size={12} className="text-muted" />
                  ) : (
                    <CopyIcon size={12} />
                  )}
                </button>
              </Tooltip>
              <Tooltip label="Download content">
                <button
                  type="button"
                  onClick={downloadExcerpt}
                  aria-label="Download content"
                  className="grid size-6 place-items-center rounded-[5px] text-faint transition hover:bg-raised hover:text-text"
                >
                  <DownloadIcon size={12} />
                </button>
              </Tooltip>
              {codeView ? (
                <Tooltip label={rawNote ? "Highlighted view" : "Raw text"}>
                  <button
                    type="button"
                    onClick={() => setRawFor(rawNote ? null : item.id)}
                    aria-label={rawNote ? "Highlighted view" : "Raw text"}
                    aria-pressed={rawNote}
                    className={`grid size-6 place-items-center rounded-[5px] transition hover:bg-raised ${
                      rawNote ? "text-muted" : "text-faint hover:text-text"
                    }`}
                  >
                    <CodeIcon size={12} />
                  </button>
                </Tooltip>
              ) : null}
              {activeMarkdown ? (
                <>
                  <Tooltip label="Rendered view">
                    <button
                      type="button"
                      onClick={() => setRawFor(null)}
                      aria-label="Rendered view"
                      aria-pressed={!rawNote}
                      className={`grid size-6 place-items-center rounded-[5px] transition hover:bg-raised ${
                        rawNote ? "text-faint hover:text-text" : "text-muted"
                      }`}
                    >
                      <EyeIcon size={12} />
                    </button>
                  </Tooltip>
                  <Tooltip label="Raw markdown">
                    <button
                      type="button"
                      onClick={() => setRawFor(item.id)}
                      aria-label="Raw markdown"
                      aria-pressed={rawNote}
                      className={`grid size-6 place-items-center rounded-[5px] transition hover:bg-raised ${
                        rawNote ? "text-muted" : "text-faint hover:text-text"
                      }`}
                    >
                      <CodeIcon size={12} />
                    </button>
                  </Tooltip>
                </>
              ) : null}
              <Tooltip label={wrapText ? "Disable word wrap" : "Enable word wrap"}>
                <button
                  type="button"
                  onClick={() => setWrapText((value) => !value)}
                  aria-label="Toggle word wrap"
                  aria-pressed={wrapText}
                  className={`grid size-6 place-items-center rounded-[5px] transition hover:bg-raised ${
                    wrapText ? "text-muted" : "text-faint hover:text-text"
                  }`}
                >
                  <WrapIcon size={12} />
                </button>
              </Tooltip>
            </div>
          </div>
          <div className="mb-1.5 flex flex-wrap gap-1">
            {tabs.map((file, index) => (
              <button
                key={`${file.name}-${index}`}
                type="button"
                onClick={() => {
                  if (files.length === 0) return;
                  setFileIndex(index);
                  setRawFor(null);
                }}
                className={`inline-flex items-center gap-1 rounded-[5px] px-2 py-1 font-mono text-[10px] transition ${
                  index === safeFileIndex
                    ? "bg-raised text-text"
                    : "text-faint hover:bg-raised hover:text-text"
                }`}
              >
                <LangIcon lang={file.lang} size={10} />
                {file.name}
              </button>
            ))}
          </div>
          {rawNote ? (
            <pre
              className={`overflow-auto rounded-[var(--radius)] bg-canvas/50 p-3 font-mono text-[11.5px] leading-relaxed text-muted ${
                wrapText ? "whitespace-pre-wrap" : "whitespace-pre"
              } ${expanded ? "max-h-[28rem]" : "max-h-64"}`}
            >
              {content}
            </pre>
          ) : activeMarkdown ? (
            <Suspense
              fallback={
                <NoteText
                  text={content}
                  lang={contentLang}
                  wrap={wrapText}
                  className={expanded ? "max-h-[28rem]" : "max-h-64"}
                />
              }
            >
              <Markdown
                text={content}
                className={expanded ? "max-h-[28rem] overflow-y-auto" : "max-h-64 overflow-y-auto"}
              />
            </Suspense>
          ) : (
            <NoteText
              text={content}
              lang={contentLang}
              wrap={wrapText}
              className={expanded ? "max-h-[28rem]" : "max-h-64"}
            />
          )}
        </div>
      ) : null}

      {item.tags_text && item.source !== "github" ? (
        <div>
          <p className="mb-1 font-mono text-[9px] uppercase tracking-[0.14em] text-faint">Tags</p>
          <div className="flex flex-wrap gap-1">
            {item.tags_text
              .split(" ")
              .filter(Boolean)
              .map((tag) => (
                <span
                  key={tag}
                  className={`rounded px-1.5 py-0.5 font-mono text-[10px] ${tagTone(tag)}`}
                >
                  #{tag}
                </span>
              ))}
          </div>
        </div>
      ) : null}

      {related.length > 0 ? (
        <div>
          <div className="mb-1.5 font-mono text-[10px] uppercase tracking-[0.14em] text-faint">
            Related
          </div>
          <ul className="space-y-0.5">
            {related.map((entry) => (
              <li key={entry.id}>
                <button
                  type="button"
                  onClick={() => onOpenItem(entry.id)}
                  className="flex w-full items-center gap-2 rounded-[6px] px-2 py-1.5 text-left transition hover:bg-raised"
                >
                  <span className="grid size-5 shrink-0 place-items-center rounded-[5px] bg-raised font-mono text-[10px] text-accent">
                    {entry.relation === "link" ? "↗" : entry.relation === "tag" ? "#" : "≈"}
                  </span>
                  <span className="min-w-0 flex-1 truncate text-[12px] text-text">
                    {entry.title}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <dl className="grid grid-cols-[minmax(0,1.5fr)_minmax(0,0.8fr)_minmax(0,0.8fr)_minmax(0,1.5fr)] gap-x-2 pt-3 font-mono text-[10px]">
        <div className="min-w-0">
          <dt className="truncate uppercase tracking-wider text-faint">Captured</dt>
          <dd className="mt-0.5 truncate text-muted">
            {dayLabel(item.captured_at)} · {timeLabel(item.captured_at)}
          </dd>
        </div>
        <div className="min-w-0">
          <dt className="truncate uppercase tracking-wider text-faint">Language</dt>
          <dd className="mt-0.5 truncate text-muted">
            {languages.length > 1 ? (
              <span className="flex items-center gap-1">
                {languages.map((lang) => {
                  const meta = langMeta(lang);
                  return (
                    <Tooltip key={lang} label={meta.label}>
                      <span className="inline-flex">
                        <LangIcon lang={lang} size={11} />
                      </span>
                    </Tooltip>
                  );
                })}
              </span>
            ) : (
              <Tooltip label={langMeta(languages[0]).label}>
                <span className="inline-flex">
                  <LangIcon lang={languages[0]} size={11} />
                </span>
              </Tooltip>
            )}
          </dd>
        </div>
        <div className="min-w-0">
          <dt className="truncate uppercase tracking-wider text-faint">Source</dt>
          <dd className="mt-0.5 flex items-center">
            <Tooltip label={sourceMeta(item.source).label}>
              <span className="inline-flex text-accent">
                <SourceGlyph id={item.source} size={13} />
              </span>
            </Tooltip>
          </dd>
        </div>
        <div className="min-w-0">
          <dt className="truncate uppercase tracking-wider text-faint">Updated</dt>
          <dd className="mt-0.5 truncate text-muted">
            {dayLabel(item.updated_at)} · {timeLabel(item.updated_at)}
          </dd>
        </div>
      </dl>

      <div className="flex flex-wrap items-center gap-2 pt-3">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          disabled={busy}
          className="text-amber"
          onClick={async () => {
            setBusy(true);
            await onRetry(item.id);
            setBusy(false);
          }}
        >
          <RefreshIcon size={12} />
          Re-enrich
        </Button>
        {item.deleted_at ? (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={busy}
            className="text-accent"
            onClick={async () => {
              setBusy(true);
              await onRestore(item.id);
              setBusy(false);
            }}
          >
            <RestoreIcon size={12} />
            Restore
          </Button>
        ) : null}

        {confirm ? (
          <span className="ml-auto flex items-center gap-1.5">
            <Button
              type="button"
              variant="danger"
              size="sm"
              disabled={busy}
              className="border-transparent bg-coral text-signal-ink hover:brightness-105"
              onClick={async () => {
                setBusy(true);
                await onDelete(item.id);
                setBusy(false);
                setConfirm(false);
              }}
            >
              Confirm delete
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              onClick={() => setConfirm(false)}
              aria-label="Cancel delete"
            >
              <CloseIcon size={13} />
            </Button>
          </span>
        ) : (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => setConfirm(true)}
            className="ml-auto text-coral hover:bg-coral/10 hover:text-coral"
          >
            <TrashIcon size={12} />
            Delete
          </Button>
        )}
      </div>
      {confirm ? (
        <p className="text-[10px] text-faint">
          Moves to trash for 30 days. Vectors are removed after that.
        </p>
      ) : null}
    </div>
  ) : null;

  return (
    <>
      <aside
        style={{ width }}
        className={`relative hidden max-w-[62vw] shrink-0 flex-col bg-panel lg:flex ${
          resizing ? "" : "inspector-spring"
        }`}
      >
        <div
          role="separator"
          aria-orientation="vertical"
          aria-label="Resize inspector"
          aria-valuemin={300}
          aria-valuemax={720}
          aria-valuenow={width}
          tabIndex={0}
          onPointerDown={startResize}
          onKeyDown={(e) => {
            if (e.key === "ArrowLeft") nudge(16);
            if (e.key === "ArrowRight") nudge(-16);
          }}
          className="absolute inset-y-0 left-0 z-10 w-1.5 cursor-col-resize bg-transparent hover:bg-accent/40 focus-visible:bg-accent"
        />
        <div className="flex items-center justify-between px-4 py-3">
          <span className="font-mono text-[10px] uppercase tracking-[0.16em] text-faint">
            Inspector
          </span>
          <div className="flex items-center gap-2">
            {item?.url ? (
              <Tooltip label="Open link">
                <Button asChild variant="ghost" size="icon-sm" className="text-accent">
                  <a href={item.url} target="_blank" rel="noreferrer" aria-label="Open link">
                    <ArrowUpRightIcon size={13} />
                  </a>
                </Button>
              </Tooltip>
            ) : null}
            <Tooltip label="Close inspector">
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                onClick={onClose}
                aria-label="Close inspector"
              >
                <CloseIcon size={13} />
              </Button>
            </Tooltip>
          </div>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto p-3">{body}</div>
      </aside>

      {item ? (
        <div className="fixed inset-x-0 bottom-0 z-40 max-h-[74vh] overflow-y-auto rounded-t-2xl bg-panel p-3 lg:hidden">
          {item ? (
            <div className="mb-2 flex items-center justify-end gap-1">
              {item.url ? (
                <Tooltip label="Open link">
                  <a
                    href={item.url}
                    target="_blank"
                    rel="noreferrer"
                    aria-label="Open link"
                    className="rounded p-1 text-accent hover:bg-raised"
                  >
                    <ArrowUpRightIcon size={14} />
                  </a>
                </Tooltip>
              ) : null}
              <button
                type="button"
                onClick={onClose}
                aria-label="Close inspector"
                className="rounded p-1 text-faint hover:bg-raised hover:text-text"
              >
                <CloseIcon size={14} />
              </button>
            </div>
          ) : null}
          {body}
        </div>
      ) : null}
    </>
  );
}
