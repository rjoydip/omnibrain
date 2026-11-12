import { parseBookmarksHtml } from "@omnibrain/connectors/browser";
import { canonicalizeUrl } from "@omnibrain/search";
import { Badge, Button, Modal } from "@omnibrain/ui";
import { useRef, useState } from "react";
import { ImportIcon, TrashIcon } from "../components/icons";
import { ApiError, api } from "../lib/api";

const IMPORT_KIND = "browser_html";
const DROP = "bookmarks.html";
const DROP_HINT = "Browser menu → Bookmarks → Export bookmarks";
const ACCEPT = ".html,.htm,text/html";

interface Parsed {
  url?: string;
  title: string;
  note?: string;
  tags: string[];
  captured_at?: number;
  source: string;
  kind: "bookmark" | "note";
}

const CHUNK = 500;

/** Stable identity used for duplicate detection; mirrors the server's canonical URL. */
function itemKey(item: Parsed): string {
  const canonical = item.url ? canonicalizeUrl(item.url) : null;
  return canonical ?? `${item.title}|${item.note ?? ""}`;
}

/** Every item URL already in the workspace, paged up to 1,000 items. */
async function existingKeys(): Promise<Set<string>> {
  const keys = new Set<string>();
  let cursor: string | null = null;
  for (let page = 0; page < 10; page++) {
    const res = await api.items({ limit: 100, cursor: cursor ?? undefined });
    for (const item of res.items) {
      const canonical = item.url ? canonicalizeUrl(item.url) : null;
      if (canonical) keys.add(canonical);
    }
    cursor = res.nextCursor;
    if (!cursor) break;
  }
  return keys;
}

export function ImportView({
  toast,
  onChanged,
}: {
  toast: (message: string, tone?: "ok" | "error") => void;
  onChanged: () => void;
}) {
  const [fileName, setFileName] = useState<string | null>(null);
  const [parsed, setParsed] = useState<Parsed[]>([]);
  const [picked, setPicked] = useState<Set<number>>(new Set());
  const [duplicateKeys, setDuplicateKeys] = useState<Set<string>>(new Set());
  const [duplicateItems, setDuplicateItems] = useState<Parsed[]>([]);
  const [showDuplicates, setShowDuplicates] = useState(false);
  const [phase, setPhase] = useState<"idle" | "parsing" | "importing" | "done" | "error">("idle");
  const [processed, setProcessed] = useState(0);
  const [result, setResult] = useState<{
    created: number;
    duplicates: number;
    blocked: number;
  } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const known = (item: Parsed) => duplicateKeys.has(itemKey(item));
  const fresh = parsed.filter((item) => !known(item));
  const duplicateCount = parsed.length - fresh.length;

  async function readFile(file: File) {
    setError(null);
    setPhase("parsing");
    setFileName(file.name);
    setPicked(new Set());
    setResult(null);
    setDuplicateKeys(new Set());
    setDuplicateItems([]);
    setShowDuplicates(false);
    try {
      const text = await file.text();
      const items: Parsed[] = parseBookmarksHtml(text).map((i) => ({
        url: i.url,
        title: i.title,
        note: i.note,
        tags: i.tags ?? [],
        captured_at: i.capturedAt,
        source: "browser",
        kind: i.kind === "note" ? "note" : "bookmark",
      }));
      if (items.length === 0) {
        setError("No bookmarks found. Export an HTML bookmarks file from your browser.");
        setPhase("error");
        return;
      }
      let dupes: Parsed[] = [];
      try {
        const keys = await existingKeys();
        dupes = items.filter((item) => keys.has(itemKey(item)));
      } catch {
        // Duplicate detection is best-effort; the server still dedupes.
      }
      setDuplicateKeys(new Set(dupes.map(itemKey)));
      setDuplicateItems(dupes);
      setParsed(items);
      setPhase("idle");
      if (dupes.length > 0) setShowDuplicates(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not read that file");
      setPhase("error");
    }
  }

  async function start() {
    const queue = parsed.filter((item) => !known(item));
    if (queue.length === 0) return;
    const skipped = parsed.length - queue.length;
    setPhase("importing");
    setProcessed(0);
    setResult(null);
    setError(null);
    let importId: string | null = null;
    let created = 0;
    let duplicates = 0;
    let blocked = 0;
    try {
      const createdImport = await api.createImport(IMPORT_KIND, queue.length);
      importId = createdImport.import.id;

      for (let i = 0; i < queue.length; i += CHUNK) {
        const chunk = queue.slice(i, i + CHUNK).map((p) => ({
          url: p.url,
          title: p.title,
          note: p.note,
          tags: p.tags,
          source: p.source,
          kind: p.kind,
          captured_at: p.captured_at,
        }));
        const res = await api.importBatch(createdImport.import.id, chunk);
        created += res.created;
        duplicates += res.duplicates;
        blocked += res.blocked;
        setProcessed(Math.min(queue.length, i + chunk.length));
      }
      await api.finishImport(createdImport.import.id, "done");
      setResult({ created, duplicates, blocked });
      setParsed([]);
      setPicked(new Set());
      setPhase("done");
      onChanged();
      toast(
        `Imported ${created} new items${skipped ? ` · ${skipped} duplicates skipped` : ""}.`,
        "ok",
      );
    } catch (err) {
      if (importId) await api.finishImport(importId, "failed", String(err)).catch(() => {});
      setError(err instanceof ApiError ? err.message : "Import failed");
      setPhase("error");
    }
  }

  function togglePicked(index: number) {
    setPicked((prev) => {
      const next = new Set(prev);
      if (next.has(index)) next.delete(index);
      else next.add(index);
      return next;
    });
  }

  function toggleAll() {
    setPicked(picked.size === parsed.length ? new Set() : new Set(parsed.map((_, i) => i)));
  }

  function removePicked() {
    setParsed((prev) => prev.filter((_, index) => !picked.has(index)));
    setPicked(new Set());
  }

  return (
    <div className="mx-auto w-full max-w-3xl space-y-5 p-3 pb-20 md:p-4">
      <header>
        <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-faint">
          On-device import
        </p>
        <h1 className="mt-1 text-xl font-semibold tracking-[-0.02em]">Import bookmarks</h1>
        <p className="mt-1 max-w-xl text-xs leading-relaxed text-muted">
          Chrome, Edge, Firefox and Safari exports. Files are parsed in this tab; only the extracted
          titles, links and tags are sent to the server. Re-importing is safe.
        </p>
      </header>

      {phase === "parsing" ? (
        <p className="text-xs text-faint">Parsing…</p>
      ) : parsed.length === 0 ? (
        <div
          onDragOver={(e) => {
            e.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragging(false);
            const file = e.dataTransfer.files[0];
            if (file) void readFile(file);
          }}
          className={`rounded-[var(--radius)] border border-dashed p-8 text-center transition ${
            dragging ? "border-signal bg-signal/5" : "border-line bg-panel/40"
          }`}
        >
          <div className="mx-auto grid size-10 place-items-center rounded-full border border-line bg-raised text-muted">
            <ImportIcon size={17} />
          </div>
          <p className="mt-3 text-[13px] text-text">Drop {DROP} here</p>
          <p className="mt-1 text-[11px] text-faint">{DROP_HINT}</p>
          <button
            type="button"
            onClick={() => inputRef.current?.click()}
            className="mt-3 rounded-[var(--radius)] bg-cobalt px-3 py-1.5 text-xs font-medium text-signal-ink hover:brightness-105"
          >
            Choose file
          </button>
          <input
            ref={inputRef}
            type="file"
            accept={ACCEPT}
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) void readFile(file);
            }}
          />
        </div>
      ) : null}

      {error ? (
        <div className="rounded-[var(--radius)] border border-coral/30 bg-coral/5 px-3 py-2 text-xs text-coral">
          {error}
        </div>
      ) : null}

      {phase === "done" && result ? (
        <div className="rounded-[var(--radius)] border border-mint/25 bg-mint/5 px-3 py-2 text-[11.5px] text-mint">
          {result.created} new · {result.duplicates} duplicates · {result.blocked} over quota.
          Searchable now.
        </div>
      ) : null}

      {parsed.length > 0 ? (
        <div className="panel overflow-hidden">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-4 py-3">
            <div>
              <p className="text-[13px] font-medium">
                {fileName ?? "File"} · {parsed.length.toLocaleString()} items
              </p>
              <p className="mt-0.5 font-mono text-[10px] text-faint">
                bookmarks · preview
                {duplicateCount > 0 ? (
                  <>
                    {" · "}
                    <button
                      type="button"
                      onClick={() => setShowDuplicates(true)}
                      className="text-accent hover:underline"
                    >
                      {duplicateCount} duplicate{duplicateCount === 1 ? "" : "s"} · review
                    </button>
                  </>
                ) : null}
              </p>
            </div>
            <div className="flex items-center gap-1.5">
              {picked.size > 0 ? (
                <Button
                  type="button"
                  variant="danger"
                  size="sm"
                  onClick={removePicked}
                  disabled={phase === "importing"}
                >
                  <TrashIcon size={12} />
                  Remove {picked.size}
                </Button>
              ) : null}
              <Button
                type="button"
                variant="primary"
                size="sm"
                className="bg-cobalt"
                onClick={() => void start()}
                disabled={phase === "importing" || fresh.length === 0}
              >
                {phase === "importing" ? "Importing…" : `Import ${fresh.length.toLocaleString()}`}
              </Button>
            </div>
          </div>

          <div className="flex items-center gap-2 border-b border-line px-4 py-1.5 font-mono text-[10px] text-faint">
            <input
              type="checkbox"
              checked={picked.size === parsed.length}
              onChange={toggleAll}
              aria-label="Select all items"
              className="accent-[var(--signal)]"
            />
            <span>Select all</span>
            {picked.size > 0 ? (
              <span className="ml-auto text-accent">{picked.size} selected</span>
            ) : null}
          </div>

          <ul className="max-h-80 divide-y divide-line overflow-y-auto">
            {parsed.map((item, index) => {
              const dupe = known(item);
              return (
                <li key={item.url ?? `${item.title}:${item.note ?? ""}`}>
                  <label className="flex cursor-pointer items-center gap-3 px-4 py-2 hover:bg-raised/40">
                    <input
                      type="checkbox"
                      checked={picked.has(index)}
                      onChange={() => togglePicked(index)}
                      aria-label={`Select ${item.title}`}
                      className="accent-[var(--signal)]"
                    />
                    <span className="font-mono text-[10px] text-accent">
                      {String(index + 1).padStart(2, "0")}
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className={`truncate text-[12px] ${dupe ? "text-muted" : "text-text"}`}>
                        {item.title}
                      </p>
                      <p className="truncate font-mono text-[10px] text-faint">
                        {item.url ?? item.note?.slice(0, 80) ?? "note"}
                      </p>
                    </div>
                    {dupe ? (
                      <Badge tone="signal">duplicate</Badge>
                    ) : item.tags[0] ? (
                      <span className="rounded bg-raised px-1.5 py-0.5 font-mono text-[9px] text-muted">
                        #{item.tags[0]}
                      </span>
                    ) : null}
                  </label>
                </li>
              );
            })}
          </ul>

          {phase === "importing" ? (
            <div className="border-t border-line px-4 py-3">
              <div className="flex items-center justify-between font-mono text-[10px] text-faint">
                <span>Writing items</span>
                <span>
                  {processed.toLocaleString()} / {fresh.length.toLocaleString()}
                </span>
              </div>
              <div className="meter mt-1.5">
                <span
                  style={{ width: `${Math.round((processed / Math.max(1, fresh.length)) * 100)}%` }}
                />
              </div>
            </div>
          ) : null}
        </div>
      ) : null}

      <Modal
        open={showDuplicates}
        onClose={() => setShowDuplicates(false)}
        title={`${duplicateItems.length} already in your library`}
      >
        <p className="text-xs leading-relaxed text-muted">
          These items already exist in this workspace. Nothing is overwritten — duplicates are
          skipped and only new items are imported.
        </p>
        <div className="mt-3 max-h-56 overflow-y-auto rounded-[var(--radius)] bg-canvas/40">
          <table className="w-full table-fixed text-left">
            <thead className="sticky top-0 bg-canvas/90 font-mono text-[9px] uppercase tracking-wider text-faint">
              <tr>
                <th className="px-3 py-1.5 font-normal">Item</th>
                <th className="px-3 py-1.5 font-normal">Link</th>
                <th className="px-3 py-1.5 text-right font-normal">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {duplicateItems.slice(0, 50).map((item) => (
                <tr key={itemKey(item)}>
                  <td className="max-w-0 px-3 py-2">
                    <p className="truncate text-[12px] text-text">{item.title}</p>
                  </td>
                  <td className="max-w-0 px-3 py-2">
                    <p className="truncate font-mono text-[10px] text-accent">
                      {item.url ?? item.note?.slice(0, 80) ?? "note"}
                    </p>
                  </td>
                  <td className="px-3 py-2 text-right">
                    <Badge tone="muted" className="bg-amber/10 text-amber">
                      duplicate
                    </Badge>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {duplicateItems.length > 50 ? (
          <p className="mt-1 font-mono text-[10px] text-faint">
            + {duplicateItems.length - 50} more
          </p>
        ) : null}
        <div className="mt-4 flex justify-end gap-2">
          <Button type="button" variant="ghost" size="md" onClick={() => setShowDuplicates(false)}>
            Review list
          </Button>
          <Button
            type="button"
            variant="primary"
            size="md"
            className="bg-cobalt"
            disabled={fresh.length === 0}
            onClick={() => {
              setShowDuplicates(false);
              void start();
            }}
          >
            Import {fresh.length.toLocaleString()} new
          </Button>
        </div>
      </Modal>
    </div>
  );
}
