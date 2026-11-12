import { detectIntent } from "@omnibrain/search";
import { Badge, Spinner } from "@omnibrain/ui";
import { useEffect, useMemo, useRef, useState } from "react";
import { ApiError, api, type Item, type SearchHit, type SearchResponse } from "../lib/api";
import { shortUrl, sourceMeta } from "../lib/format";
import type { Theme, View } from "../lib/nav";
import { ArrowUpRightIcon, LinkIcon, SearchIcon, SparkIcon, StreamIcon } from "./icons";
import { SourceGlyph } from "./SourceGlyph";

type Mode = "keyword" | "question" | "url" | "command";

interface Command {
  id: string;
  label: string;
  hint: string;
  run: () => void;
}

export function Recall({
  open,
  seed,
  recent,
  onClose,
  onOpenItem,
  onNavigate,
  onCaptured,
  onTheme,
  theme,
  toast,
}: {
  open: boolean;
  seed: string;
  recent: Item[];
  onClose: () => void;
  onOpenItem: (id: string) => void;
  onNavigate: (view: View) => void;
  onCaptured: () => void;
  onTheme: (theme: Theme) => void;
  theme: Theme;
  toast: (message: string, tone?: "ok" | "error") => void;
}) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchHit[]>([]);
  const [answer, setAnswer] = useState<string | null>(null);
  const [meta, setMeta] = useState<SearchResponse["meta"] | null>(null);
  const [loading, setLoading] = useState(false);
  const [active, setActive] = useState(0);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const requestRef = useRef(0);

  const mode: Mode = useMemo(() => {
    if (!query.trim()) return "keyword";
    return detectIntent(query);
  }, [query]);

  useEffect(() => {
    if (!open) return;
    setQuery(seed);
    setResults([]);
    setAnswer(null);
    setMeta(null);
    setError(null);
    setActive(0);
    const timer = setTimeout(() => inputRef.current?.focus(), 40);
    return () => clearTimeout(timer);
  }, [open, seed]);

  useEffect(() => {
    if (!open) return;
    const q = query.trim();
    if (!q || mode === "url" || mode === "command") {
      setResults([]);
      setAnswer(null);
      setMeta(null);
      setLoading(false);
      return;
    }
    const timer = setTimeout(async () => {
      const request = ++requestRef.current;
      setLoading(true);
      setError(null);
      try {
        const res = await api.search({ query: q, limit: 12, answer: mode === "question" });
        if (request !== requestRef.current) return;
        setResults(res.results);
        setAnswer(res.answer);
        setMeta(res.meta);
        setActive(0);
      } catch (err) {
        if (request !== requestRef.current) return;
        setError(err instanceof ApiError ? err.message : "Search failed");
      } finally {
        if (request === requestRef.current) setLoading(false);
      }
    }, 180);
    return () => clearTimeout(timer);
  }, [query, mode, open]);

  const commands: Command[] = useMemo(() => {
    const base: Command[] = [
      {
        id: "knowledge",
        label: "Go to Knowledge",
        hint: "g k",
        run: () => onNavigate("knowledge"),
      },
      { id: "apps", label: "Open the App Store", hint: "g a", run: () => onNavigate("apps") },
      {
        id: "import",
        label: "Import bookmarks",
        hint: "g i",
        run: () => onNavigate("import"),
      },
      { id: "mcp", label: "Open MCP server", hint: "g m", run: () => onNavigate("mcp") },
      { id: "settings", label: "Open settings", hint: "g s", run: () => onNavigate("settings") },
      { id: "theme-ink", label: "Theme: Ink", hint: "dark", run: () => onTheme("ink") },
      { id: "theme-paper", label: "Theme: Paper", hint: "light", run: () => onTheme("paper") },
      {
        id: "theme-contrast",
        label: "Theme: Contrast",
        hint: "a11y",
        run: () => onTheme("contrast"),
      },
    ];
    const term = query.replace(/^\//, "").trim().toLowerCase();
    return term ? base.filter((c) => c.label.toLowerCase().includes(term)) : base;
  }, [query, onNavigate, onTheme]);

  if (!open) return null;

  const runCommand = (command: Command) => {
    command.run();
    onClose();
  };

  async function saveUrl(raw: string) {
    const value = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
    setSaving(true);
    setError(null);
    try {
      await api.createItem({ url: value, source: "web", enrich: true });
      toast("Link saved. Enrichment runs in the background.");
      onCaptured();
      onClose();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not save link");
    } finally {
      setSaving(false);
    }
  }

  async function saveNote() {
    setSaving(true);
    setError(null);
    try {
      await api.createItem({
        note: query,
        title: query.split("\n")[0]?.slice(0, 120),
        kind: "note",
        source: "web",
        enrich: false,
      });
      toast("Note saved to your library.");
      onCaptured();
      onClose();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not save note");
    } finally {
      setSaving(false);
    }
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Escape") {
      e.preventDefault();
      onClose();
      return;
    }
    if (mode === "command") {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setActive((i) => Math.min(i + 1, commands.length - 1));
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        setActive((i) => Math.max(i - 1, 0));
      }
      if (e.key === "Enter") {
        e.preventDefault();
        const command = commands[active];
        if (command) runCommand(command);
      }
      return;
    }
    if (mode === "url") {
      if (e.key === "Enter") {
        e.preventDefault();
        if (!saving) void saveUrl(query.trim());
      }
      return;
    }
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((i) => Math.min(i + 1, Math.max(results.length - 1, 0)));
    }
    if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((i) => Math.max(i - 1, 0));
    }
    if (e.key === "Enter") {
      e.preventDefault();
      const item = results[active] ?? results[0];
      if (item) {
        onOpenItem(item.id);
        onClose();
      } else if (query.trim()) {
        void saveNote();
      }
    }
  }

  const modeChip =
    mode === "url"
      ? "link"
      : mode === "command"
        ? "command"
        : mode === "question"
          ? "question"
          : mode === "keyword"
            ? query.trim()
              ? "search"
              : "recall"
            : "recall";

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center px-3 pt-[14vh] sm:pt-[16vh]">
      <button
        type="button"
        tabIndex={-1}
        aria-label="Close recall"
        onClick={onClose}
        className="recall-backdrop absolute inset-0 cursor-default bg-black/70"
      />
      <div
        className="recall-panel relative w-full max-w-3xl overflow-hidden rounded-xl bg-panel"
        role="dialog"
        aria-modal="true"
        aria-label="Recall"
      >
        <div className="flex items-center gap-3 px-4 py-3">
          <SearchIcon size={17} className={loading ? "animate-pulse text-accent" : "text-faint"} />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder="Search a half-memory, paste a link, or type / for commands…"
            aria-label="Recall query or URL"
            className="min-w-0 flex-1 bg-transparent text-[14px] text-text outline-none placeholder:text-faint"
            autoComplete="off"
            spellCheck={false}
          />
          {saving ? <Spinner className="size-3.5" /> : null}
          <Badge tone={mode === "url" ? "mint" : mode === "command" ? "muted" : "signal"}>
            {modeChip}
          </Badge>
        </div>

        <div className="max-h-[50vh] overflow-y-auto p-2">
          {error ? (
            <p role="alert" className="px-2.5 py-1.5 text-xs text-coral">
              {error}
            </p>
          ) : null}

          {mode === "url" ? (
            <div className="p-3">
              <div className="rounded-[var(--radius)] border border-line bg-canvas/40 p-4">
                <div className="flex items-start gap-3">
                  <div className="source-tile text-mint">
                    <LinkIcon size={14} />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">{query.trim()}</p>
                    <p className="mt-1 text-xs leading-relaxed text-muted">
                      Save to your library. OmniBrain fetches the page, extracts the text, and
                      generates a summary plus embeddings when AI is configured.
                    </p>
                    <div className="mt-3 flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => void saveUrl(query.trim())}
                        disabled={saving}
                        className="rounded-[var(--radius)] border border-transparent bg-signal px-3 py-1.5 text-xs font-semibold text-signal-ink hover:brightness-105 disabled:opacity-50"
                      >
                        {saving ? "Saving…" : "Save link"}
                      </button>
                      <span className="font-mono text-[10px] uppercase tracking-wider text-faint">
                        ↵ save · esc close
                      </span>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          ) : null}

          {mode === "command" ? (
            <ul className="space-y-0.5">
              {commands.map((command, index) => (
                <li key={command.id}>
                  <button
                    type="button"
                    onMouseEnter={() => setActive(index)}
                    onClick={() => runCommand(command)}
                    className={`flex w-full items-center justify-between rounded-[8px] px-2.5 py-1.5 text-left text-[13px] transition ${
                      index === active ? "bg-raised text-text" : "text-muted hover:bg-raised/60"
                    }`}
                  >
                    <span className="flex items-center gap-2.5">
                      <StreamIcon size={14} className="text-faint" />
                      {command.label}
                    </span>
                    <span className="font-mono text-[10px] uppercase tracking-wider text-faint">
                      {command.hint}
                    </span>
                  </button>
                </li>
              ))}
              {commands.length === 0 ? (
                <li className="px-3 py-6 text-center text-xs text-faint">No commands match.</li>
              ) : null}
            </ul>
          ) : null}

          {mode !== "url" && mode !== "command" ? (
            <>
              {loading && results.length === 0 ? (
                <div className="space-y-2 p-2">
                  {[0, 1, 2].map((i) => (
                    <div key={i} className="flex gap-3 rounded-[var(--radius)] p-2">
                      <div className="skeleton size-8 shrink-0" />
                      <div className="flex-1 space-y-2">
                        <div className="skeleton h-3 w-2/3" />
                        <div className="skeleton h-2.5 w-full" />
                      </div>
                    </div>
                  ))}
                </div>
              ) : null}

              {answer ? (
                <div className="m-2 rounded-[var(--radius)] bg-raised p-3">
                  <div className="mb-1.5 flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-[0.14em] text-accent">
                    <SparkIcon size={12} />
                    Answer · cited
                  </div>
                  <p className="whitespace-pre-wrap text-[13px] leading-relaxed text-text/90">
                    {answer}
                  </p>
                  <p className="mt-2 font-mono text-[10px] text-faint">
                    {results.length} sources · {meta?.tookMs ?? 0}ms · verify citations below
                  </p>
                </div>
              ) : null}

              {results.length > 0 ? (
                <ul className="space-y-0.5">
                  {results.map((item, index) => {
                    const sourceInfo = sourceMeta(item.source);
                    return (
                      <li key={item.id}>
                        <button
                          type="button"
                          onMouseEnter={() => setActive(index)}
                          onClick={() => {
                            onOpenItem(item.id);
                            onClose();
                          }}
                          className={`flex w-full gap-3 rounded-[8px] p-2.5 text-left transition ${
                            index === active ? "bg-raised" : "hover:bg-raised/60"
                          }`}
                        >
                          <div className="source-tile mt-0.5 text-accent">
                            <SourceGlyph id={item.source} size={12} />
                          </div>
                          <div className="min-w-0 flex-1">
                            <div className="flex items-baseline justify-between gap-3">
                              <span className="truncate text-[13px] font-medium text-text">
                                {item.title}
                              </span>
                              <span className="shrink-0 font-mono text-[10px] text-faint">
                                {item.matched === "semantic"
                                  ? "semantic"
                                  : item.matched === "both"
                                    ? "hybrid"
                                    : "text"}
                              </span>
                            </div>
                            <p className="mt-0.5 line-clamp-2 text-[11.5px] leading-relaxed text-muted">
                              {item.summary ?? item.excerpt ?? shortUrl(item.url)}
                            </p>
                            <div className="mt-1 flex items-center gap-2 font-mono text-[10px] text-faint">
                              <span>{sourceInfo.label}</span>
                              {item.url ? (
                                <>
                                  <span>·</span>
                                  <span className="truncate text-accent">{shortUrl(item.url)}</span>
                                </>
                              ) : null}
                            </div>
                          </div>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              ) : null}

              {!loading && query.trim() && results.length === 0 && !answer ? (
                <div className="px-3 py-8 text-center">
                  <p className="text-sm text-muted">Nothing in your library matches that.</p>
                  <p className="mt-1 text-xs text-faint">
                    Capture it now so the next search finds it.
                  </p>
                  <button
                    type="button"
                    onClick={() => void saveNote()}
                    disabled={saving}
                    className="mt-3 rounded-[var(--radius)] px-3 py-1.5 text-xs text-text hover:bg-raised disabled:opacity-50"
                  >
                    Save “{query.trim().slice(0, 48)}
                    {query.trim().length > 48 ? "…" : ""}” as a note
                  </button>
                </div>
              ) : null}

              {!query.trim() ? (
                <div>
                  <div className="px-3 pb-1 pt-2 font-mono text-[10px] uppercase tracking-[0.14em] text-faint">
                    Recent
                  </div>
                  {recent.slice(0, 5).map((item) => {
                    return (
                      <button
                        key={item.id}
                        type="button"
                        onClick={() => {
                          onOpenItem(item.id);
                          onClose();
                        }}
                        className="flex w-full items-center gap-3 rounded-[8px] p-2.5 text-left transition hover:bg-raised/60"
                      >
                        <div className="source-tile text-accent">
                          <SourceGlyph id={item.source} size={12} />
                        </div>
                        <span className="min-w-0 flex-1 truncate text-[13px] text-text">
                          {item.title}
                        </span>
                        <ArrowUpRightIcon size={13} className="shrink-0 text-faint" />
                      </button>
                    );
                  })}
                </div>
              ) : null}
            </>
          ) : null}
        </div>

        <div className="flex items-center justify-between px-2.5 py-1.5 font-mono text-[10px] text-faint">
          <div className="flex items-center gap-3">
            <span>
              <span className="kbd mr-1">↑</span>
              <span className="kbd mr-1">↓</span>
              move
            </span>
            <span>
              <span className="kbd mr-1">↵</span>
              open
            </span>
            <span>
              <span className="kbd mr-1">esc</span>
              close
            </span>
          </div>
          <span className="hidden sm:block">
            {meta ? `${meta.mode} · ${meta.lexical} text · ${meta.semantic} vector` : theme}
          </span>
        </div>
      </div>
    </div>
  );
}
