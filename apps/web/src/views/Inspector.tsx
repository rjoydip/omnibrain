import { Badge, Button, Tooltip } from "@omnibrain/ui";
import { isMarkdown } from "@omnibrain/core/markdown";
import { lazy, Suspense, useEffect, useRef, useState } from "react";
import {
  ArrowUpRightIcon,
  CheckIcon,
  CloseIcon,
  CodeIcon,
  CopyIcon,
  EyeIcon,
  RefreshIcon,
  RestoreIcon,
  SparkIcon,
  TrashIcon,
  WrapIcon,
} from "../components/icons";
import { NoteText } from "../components/NoteText";
import { api, type Item, type RelatedItem } from "../lib/api";
import { dayLabel, sourceMeta, timeLabel } from "../lib/format";

const Markdown = lazy(() =>
  import("../components/Markdown").then((m) => ({ default: m.Markdown })),
);

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

  const noteIsMarkdown = item?.kind === "note" && item.excerpt ? isMarkdown(item.excerpt) : false;

  const copyExcerpt = async () => {
    if (!item?.excerpt) return;
    try {
      await navigator.clipboard.writeText(item.excerpt);
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
    <div className="space-y-3">
      <div className="flex items-start justify-between gap-2">
        <div className="flex flex-wrap items-center gap-1.5">
          <Badge tone="accent">{sourceMeta(item.source).label}</Badge>
          {item.kind === "bookmark" ? null : <Badge tone="muted">{item.kind}</Badge>}
          {item.embedding_state === "ready" ? <Badge tone="mint">embedded</Badge> : null}
          {item.embedding_state === "pending" ? <Badge tone="signal">enriching</Badge> : null}
          {item.embedding_state === "failed" ? <Badge tone="coral">failed</Badge> : null}
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close inspector"
          className="rounded p-1 text-faint hover:bg-raised hover:text-text lg:hidden"
        >
          <CloseIcon size={14} />
        </button>
      </div>

      <div>
        <h2
          className={`font-semibold leading-snug tracking-[-0.01em] ${
            expanded ? "text-[18px]" : "text-[15.5px]"
          }`}
        >
          {item.title}
        </h2>
        {item.url ? (
          <a
            href={item.url}
            target="_blank"
            rel="noreferrer"
            className="mt-1.5 inline-flex items-center gap-1 break-all font-mono text-[10.5px] text-accent hover:underline"
          >
            {item.url}
            <ArrowUpRightIcon size={11} className="shrink-0" />
          </a>
        ) : null}
      </div>

      {item.summary ? <Provenance item={item} /> : null}

      {item.excerpt ? (
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
                    <CheckIcon size={12} className="text-mint" />
                  ) : (
                    <CopyIcon size={12} />
                  )}
                </button>
              </Tooltip>
              <Tooltip label={wrapText ? "Disable word wrap" : "Enable word wrap"}>
                <button
                  type="button"
                  onClick={() => setWrapText((value) => !value)}
                  aria-label="Toggle word wrap"
                  aria-pressed={wrapText}
                  className={`grid size-6 place-items-center rounded-[5px] transition hover:bg-raised ${
                    wrapText ? "text-accent" : "text-faint hover:text-text"
                  }`}
                >
                  <WrapIcon size={12} />
                </button>
              </Tooltip>
              {item.kind === "note" && noteIsMarkdown ? (
                <>
                  <Tooltip label="Rendered view">
                    <button
                      type="button"
                      onClick={() => setRawFor(null)}
                      aria-label="Rendered view"
                      aria-pressed={!rawNote}
                      className={`grid size-6 place-items-center rounded-[5px] transition hover:bg-raised ${
                        rawNote ? "text-faint hover:text-text" : "text-accent"
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
                        rawNote ? "text-accent" : "text-faint hover:text-text"
                      }`}
                    >
                      <CodeIcon size={12} />
                    </button>
                  </Tooltip>
                </>
              ) : null}
            </div>
          </div>
          {item.kind === "note" ? (
            noteIsMarkdown && !rawNote ? (
              <Suspense
                fallback={
                  <NoteText
                    text={item.excerpt}
                    wrap={wrapText}
                    className={expanded ? "max-h-[28rem]" : "max-h-64"}
                  />
                }
              >
                <Markdown
                  text={item.excerpt}
                  className={
                    expanded ? "max-h-[28rem] overflow-y-auto" : "max-h-64 overflow-y-auto"
                  }
                />
              </Suspense>
            ) : (
              <NoteText
                text={item.excerpt}
                wrap={wrapText}
                className={expanded ? "max-h-[28rem]" : "max-h-64"}
              />
            )
          ) : (
            <p
              className={`overflow-y-auto rounded-[var(--radius)] bg-canvas/50 p-3 text-[12px] leading-relaxed text-muted ${
                wrapText ? "whitespace-pre-wrap" : "overflow-x-auto whitespace-pre"
              } ${expanded ? "max-h-[28rem]" : "max-h-64"}`}
            >
              {item.excerpt}
            </p>
          )}
        </div>
      ) : null}

      {item.tags_text ? (
        <div className="flex flex-wrap gap-1">
          {item.tags_text
            .split(" ")
            .filter(Boolean)
            .map((tag) => (
              <span
                key={tag}
                className="rounded bg-raised px-1.5 py-0.5 font-mono text-[10px] text-accent"
              >
                #{tag}
              </span>
            ))}
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
          <dd className="mt-0.5 truncate text-muted">{item.lang ?? "unknown"}</dd>
        </div>
        <div className="min-w-0">
          <dt className="truncate uppercase tracking-wider text-faint">Source</dt>
          <dd className="mt-0.5 truncate text-muted">{sourceMeta(item.source).label}</dd>
        </div>
        <div className="min-w-0">
          <dt className="truncate uppercase tracking-wider text-faint">Updated</dt>
          <dd className="mt-0.5 truncate text-muted">
            {dayLabel(item.updated_at)} · {timeLabel(item.updated_at)}
          </dd>
        </div>
      </dl>

      <div className="flex flex-wrap items-center gap-2 pt-3">
        {item.url ? (
          <Button asChild variant="ghost" size="sm" className="text-accent">
            <a href={item.url} target="_blank" rel="noreferrer">
              <ArrowUpRightIcon size={12} />
              Open
            </a>
          </Button>
        ) : null}
        <Button
          type="button"
          variant="ghost"
          size="sm"
          disabled={busy}
          className="text-accent"
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
          {body}
        </div>
      ) : null}
    </>
  );
}
