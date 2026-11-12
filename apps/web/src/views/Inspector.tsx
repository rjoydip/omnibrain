import { Badge, Button, Modal, Tooltip } from "@omnibrain/ui";
import { isMarkdown } from "@omnibrain/core/markdown";
import { cleanGeneratedTags } from "@omnibrain/core/tags";
import { lazy, Suspense, useEffect, useMemo, useRef, useState } from "react";
import {
  CheckIcon,
  CloseIcon,
  CodeIcon,
  CopyIcon,
  DownloadIcon,
  EyeIcon,
  GlobeIcon,
  NewTabIcon,
  RefreshIcon,
  RestoreIcon,
  ShareIcon,
  SparkIcon,
  UsersIcon,
  TrashIcon,
  WrapIcon,
} from "../components/icons";
import { NoteText } from "../components/NoteText";
import { SourceGlyph } from "../components/SourceGlyph";
import { ApiError, api, type Item, type RelatedItem, type SharePerson } from "../lib/api";
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

/** Reader opens in its own tab, styled by the app shell. */
function openReader(item: Item) {
  window.open(
    `${window.location.pathname}?reader=${encodeURIComponent(item.id)}`,
    "_blank",
    "noopener",
  );
}

function ShareLinkField({
  url,
  copied,
  onCopy,
}: {
  url: string;
  copied: boolean;
  onCopy: () => void;
}) {
  return (
    <div className="relative">
      <code className="block truncate rounded-[6px] bg-raised py-2 pr-9 pl-2.5 font-mono text-[11px] text-muted">
        {url}
      </code>
      <Tooltip label={copied ? "Copied" : "Copy link"}>
        <button
          type="button"
          onClick={onCopy}
          aria-label="Copy share link"
          className="absolute top-1/2 right-1 grid size-7 -translate-y-1/2 place-items-center rounded text-faint transition hover:bg-panel hover:text-text"
        >
          {copied ? <CheckIcon size={12} /> : <CopyIcon size={12} />}
        </button>
      </Tooltip>
    </div>
  );
}

function Provenance({ item }: { item: Item }) {
  const summary = item.summary ?? "";
  return (
    <div className="rounded-[var(--radius)] bg-raised p-3">
      <div className="mb-1.5 flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-[0.14em] text-accent">
        <SparkIcon size={12} />
        AI summary · generated
      </div>
      {isMarkdown(summary) ? (
        <Suspense fallback={<NoteText text={summary} className="text-[12.5px]" />}>
          <Markdown text={summary} className="text-[12.5px] leading-relaxed" />
        </Suspense>
      ) : (
        <p className="text-[12.5px] leading-relaxed text-text/90">{summary}</p>
      )}
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
  const [shareOpen, setShareOpen] = useState(false);
  const [shareTab, setShareTab] = useState<"public" | "private">("public");
  const [shareToken, setShareToken] = useState<string | null>(null);
  const [shareAudience, setShareAudience] = useState<"public" | "users" | null>(null);
  const [recipients, setRecipients] = useState<SharePerson[]>([]);
  const [peopleQuery, setPeopleQuery] = useState("");
  const [people, setPeople] = useState<SharePerson[]>([]);
  const [peopleBusy, setPeopleBusy] = useState(false);
  const [shareBusy, setShareBusy] = useState(false);
  const [shareCopied, setShareCopied] = useState(false);
  const [shareError, setShareError] = useState<string | null>(null);
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
  // Connector items imported before their adapter carried text (e.g. Notion
  // pages, older gists) still markdown-render when the content looks like it.
  const extractedMarkdown =
    item && item.kind !== "note" && item.excerpt ? isMarkdown(item.excerpt) : false;

  const activeMarkdown = activeFile
    ? activeFile.lang
      ? activeFile.lang === "markdown"
      : isMarkdown(activeFile.content)
    : noteIsMarkdown || extractedMarkdown;

  const codeView = Boolean(content) && !activeMarkdown;

  // "Enrich" the first time, "Re-enrich" once text or a summary exists.
  const enriched =
    item?.embedding_state === "ready" ||
    item?.embedding_state === "failed" ||
    Boolean(item?.summary);

  // Type/source words ("bookmark", "notion") are not topics; older rows still carry them.
  const tagList = item ? cleanGeneratedTags(item.tags_text?.split(" ") ?? []) : [];

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

  const shareUrl = (token: string) =>
    `${window.location.origin}${window.location.pathname}?share=${encodeURIComponent(token)}`;

  const openShare = async () => {
    if (!item) return;
    setShareOpen(true);
    setShareTab("public");
    setShareError(null);
    setShareCopied(false);
    setShareToken(null);
    setShareAudience(null);
    setRecipients([]);
    setPeopleQuery("");
    setPeople([]);
    try {
      const res = await api.itemShare(item.id);
      setShareToken(res.share?.token ?? null);
      setShareAudience(res.share?.audience ?? null);
      setRecipients(res.share?.recipients ?? []);
      if (res.share?.audience === "users") setShareTab("private");
    } catch {
      // A fresh item simply has no link yet.
    }
  };

  const copyShareLink = async (token: string) => {
    try {
      await navigator.clipboard.writeText(shareUrl(token));
      setShareCopied(true);
      setTimeout(() => setShareCopied(false), 1500);
    } catch {
      setShareError("Clipboard is unavailable in this context.");
    }
  };

  const createShare = async (audience: "public" | "users") => {
    if (!item) return;
    if (audience === "users" && recipients.length === 0) return;
    setShareBusy(true);
    setShareError(null);
    try {
      const res = await api.shareItem(
        item.id,
        audience === "users" ? recipients.map((person) => person.id) : [],
      );
      setShareToken(res.token);
      setShareAudience(audience);
      await copyShareLink(res.token);
    } catch (err) {
      setShareError(err instanceof ApiError ? err.message : "Could not create the link");
    } finally {
      setShareBusy(false);
    }
  };

  const revokeShare = async () => {
    if (!item) return;
    setShareBusy(true);
    try {
      await api.unshareItem(item.id);
      setShareToken(null);
      setShareAudience(null);
      setShareCopied(false);
    } catch (err) {
      setShareError(err instanceof ApiError ? err.message : "Could not revoke the link");
    } finally {
      setShareBusy(false);
    }
  };

  // People search for the private audience, debounced.
  useEffect(() => {
    if (!shareOpen || shareTab !== "private") return;
    const query = peopleQuery.trim();
    if (query.length < 2) {
      setPeople([]);
      setPeopleBusy(false);
      return;
    }
    let alive = true;
    setPeopleBusy(true);
    const timer = setTimeout(() => {
      api
        .people(query)
        .then((res) => {
          if (alive) setPeople(res.people);
        })
        .catch(() => {
          if (alive) setPeople([]);
        })
        .finally(() => {
          if (alive) setPeopleBusy(false);
        });
    }, 250);
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [peopleQuery, shareOpen, shareTab]);

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
                <LangIcon lang={file.lang} size={12} />
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

      {tagList.length > 0 && item?.source !== "github" ? (
        <div>
          <p className="mb-1 font-mono text-[9px] uppercase tracking-[0.14em] text-faint">Tags</p>
          <div className="flex flex-wrap gap-1">
            {tagList.map((tag) => (
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
                        <LangIcon lang={lang} size={14} />
                      </span>
                    </Tooltip>
                  );
                })}
              </span>
            ) : (
              <Tooltip label={langMeta(languages[0]).label}>
                <span className="inline-flex">
                  <LangIcon lang={languages[0]} size={14} />
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
          {enriched ? "Re-enrich" : "Enrich"}
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
                <Button asChild variant="ghost" size="icon-sm" className="text-muted">
                  <a href={item.url} target="_blank" rel="noreferrer" aria-label="Open link">
                    <GlobeIcon size={13} />
                  </a>
                </Button>
              </Tooltip>
            ) : null}
            {item ? (
              <>
                <Tooltip label="Share">
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    className="text-muted"
                    onClick={() => void openShare()}
                    aria-label="Share item"
                  >
                    <ShareIcon size={13} />
                  </Button>
                </Tooltip>
                <Tooltip label="Open reader">
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    className="text-muted"
                    onClick={() => openReader(item)}
                    aria-label="Open note and summary in a new window"
                  >
                    <NewTabIcon size={13} />
                  </Button>
                </Tooltip>
              </>
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
                    className="rounded p-1 text-muted hover:bg-raised hover:text-text"
                  >
                    <GlobeIcon size={14} />
                  </a>
                </Tooltip>
              ) : null}
              <Tooltip label="Share">
                <button
                  type="button"
                  onClick={() => void openShare()}
                  aria-label="Share item"
                  className="rounded p-1 text-muted hover:bg-raised hover:text-text"
                >
                  <ShareIcon size={14} />
                </button>
              </Tooltip>
              <Tooltip label="Open reader">
                <button
                  type="button"
                  onClick={() => openReader(item)}
                  aria-label="Open note and summary in a new window"
                  className="rounded p-1 text-muted hover:bg-raised hover:text-text"
                >
                  <NewTabIcon size={14} />
                </button>
              </Tooltip>
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

      <Modal
        open={shareOpen}
        onClose={() => setShareOpen(false)}
        title="Share"
        description="Choose who can open this note."
        width="max-w-md"
      >
        <div
          role="tablist"
          aria-label="Audience"
          className="mt-1 mb-4 grid grid-cols-2 gap-1 rounded-[var(--radius)] bg-raised p-1"
        >
          {[
            { id: "public" as const, label: "Public", icon: GlobeIcon },
            { id: "private" as const, label: "People", icon: UsersIcon },
          ].map((tab) => {
            const Icon = tab.icon;
            const active = shareTab === tab.id;
            return (
              <button
                key={tab.id}
                type="button"
                role="tab"
                aria-selected={active}
                onClick={() => setShareTab(tab.id)}
                className={`flex items-center justify-center gap-1.5 rounded-[6px] px-2 py-1.5 text-[11.5px] transition ${
                  active ? "bg-panel text-text shadow-sm" : "text-muted hover:text-text"
                }`}
              >
                <Icon size={12} />
                {tab.label}
              </button>
            );
          })}
        </div>

        {shareTab === "public" ? (
          <div className="space-y-3">
            <p className="text-[11.5px] leading-relaxed text-muted">
              Anyone with the link can read the AI summary and the original note.
            </p>
            {shareToken && shareAudience === "public" ? (
              <>
                <ShareLinkField
                  url={shareUrl(shareToken)}
                  copied={shareCopied}
                  onCopy={() => void copyShareLink(shareToken)}
                />
                <div className="flex items-center justify-between">
                  <span className="font-mono text-[9px] uppercase tracking-[0.14em] text-accent">
                    Public link active
                  </span>
                  <button
                    type="button"
                    disabled={shareBusy}
                    onClick={() => void revokeShare()}
                    className="rounded px-1.5 py-1 text-[11px] text-faint transition hover:bg-raised hover:text-coral"
                  >
                    Revoke
                  </button>
                </div>
              </>
            ) : (
              <Button
                type="button"
                size="sm"
                className="w-full"
                disabled={shareBusy}
                onClick={() => void createShare("public")}
              >
                <ShareIcon size={12} />
                Create public link
              </Button>
            )}
          </div>
        ) : (
          <div className="space-y-3">
            <div>
              <label
                htmlFor="share-people"
                className="mb-1 block font-mono text-[9px] uppercase tracking-[0.14em] text-faint"
              >
                Add people
              </label>
              <input
                id="share-people"
                value={peopleQuery}
                onChange={(event) => setPeopleQuery(event.target.value)}
                placeholder="Email or name"
                autoComplete="off"
                className="h-8 w-full rounded-[6px] bg-raised px-2.5 text-[12px] text-text outline-none placeholder:text-faint focus:ring-1 focus:ring-accent/40"
              />
            </div>

            {peopleQuery.trim().length >= 2 ? (
              <ul className="max-h-36 overflow-y-auto rounded-[6px] border border-line/60">
                {peopleBusy && people.length === 0 ? (
                  <li className="px-2.5 py-2 text-[11.5px] text-faint">Searching…</li>
                ) : people.filter((person) => !recipients.some((row) => row.id === person.id))
                    .length === 0 ? (
                  <li className="px-2.5 py-2 text-[11.5px] text-faint">No matching member</li>
                ) : (
                  people
                    .filter((person) => !recipients.some((row) => row.id === person.id))
                    .map((person) => (
                      <li key={person.id}>
                        <button
                          type="button"
                          onClick={() => {
                            setRecipients((prev) => [...prev, person]);
                            setPeopleQuery("");
                            setPeople([]);
                          }}
                          className="flex w-full items-center justify-between gap-2 px-2.5 py-1.5 text-left text-[12px] text-muted transition hover:bg-raised hover:text-text"
                        >
                          <span className="truncate">{person.name ?? person.email}</span>
                          <span className="truncate font-mono text-[10px] text-faint">
                            {person.email}
                          </span>
                        </button>
                      </li>
                    ))
                )}
              </ul>
            ) : null}

            {recipients.length > 0 ? (
              <div className="flex flex-wrap gap-1">
                {recipients.map((person) => (
                  <span
                    key={person.id}
                    className="flex items-center gap-1 rounded-full bg-raised px-2 py-0.5 text-[11px] text-muted"
                  >
                    {person.name ?? person.email}
                    <button
                      type="button"
                      onClick={() =>
                        setRecipients((prev) => prev.filter((row) => row.id !== person.id))
                      }
                      aria-label={`Remove ${person.email}`}
                      className="text-faint transition hover:text-coral"
                    >
                      <CloseIcon size={10} />
                    </button>
                  </span>
                ))}
              </div>
            ) : (
              <p className="text-[11px] text-faint">Nobody selected yet.</p>
            )}

            <Button
              type="button"
              size="sm"
              className="w-full"
              disabled={shareBusy || recipients.length === 0}
              onClick={() => void createShare("users")}
            >
              <ShareIcon size={12} />
              {shareAudience === "users" ? "Update private link" : "Create private link"}
            </Button>

            {shareToken && shareAudience === "users" ? (
              <>
                <ShareLinkField
                  url={shareUrl(shareToken)}
                  copied={shareCopied}
                  onCopy={() => void copyShareLink(shareToken)}
                />
                <div className="flex items-center justify-between">
                  <span className="font-mono text-[9px] uppercase tracking-[0.14em] text-accent">
                    Private · {recipients.length} {recipients.length === 1 ? "person" : "people"}
                  </span>
                  <button
                    type="button"
                    disabled={shareBusy}
                    onClick={() => void revokeShare()}
                    className="rounded px-1.5 py-1 text-[11px] text-faint transition hover:bg-raised hover:text-coral"
                  >
                    Revoke
                  </button>
                </div>
              </>
            ) : null}
          </div>
        )}

        {shareError ? <p className="mt-2 text-[11.5px] text-coral">{shareError}</p> : null}
      </Modal>
    </>
  );
}
