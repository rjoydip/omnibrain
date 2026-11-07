import {
  Button,
  EmptyState,
  Menu,
  MenuContent,
  MenuItem,
  MenuTrigger,
  Tooltip,
} from "@omnibrain/ui";
import { useMemo } from "react";
import { Atlas, type AtlasFilter } from "../components/Atlas";
import { SourceGlyph } from "../components/SourceGlyph";
import { CloseIcon, FilterIcon } from "../components/icons";
import type { Item } from "../lib/api";
import { groupByDay, sourceMeta, timeLabel } from "../lib/format";
import type { Theme } from "../lib/nav";

const DAY = 86_400_000;

export function Knowledge({
  items,
  total,
  selectedId,
  onSelect,
  filter,
  onFilter,
  onOpenRecall,
  onNavigateImport,
  theme,
  hasMore,
  loadingMore,
  onLoadMore,
  source,
  onSource,
}: {
  items: Item[];
  total: number;
  selectedId: string | null;
  onSelect: (id: string) => void;
  filter: AtlasFilter | null;
  onFilter: (filter: AtlasFilter | null) => void;
  onOpenRecall: () => void;
  onNavigateImport: () => void;
  theme: Theme;
  hasMore: boolean;
  loadingMore: boolean;
  onLoadMore: () => void;
  source: string;
  onSource: (source: string) => void;
}) {
  const sources = useMemo(() => {
    const counts = new Map<string, number>();
    for (const item of items) counts.set(item.source, (counts.get(item.source) ?? 0) + 1);
    return [...counts.entries()].toSorted((a, b) => b[1] - a[1]);
  }, [items]);

  const filtered = useMemo(() => {
    return items.filter((item) => {
      if (source !== "all" && item.source !== source) return false;
      if (filter) {
        if (item.captured_at < filter.start || item.captured_at >= filter.end) return false;
        if (filter.sources?.length && !filter.sources.includes(item.source)) return false;
      }
      return true;
    });
  }, [items, source, filter]);

  const groups = useMemo(() => groupByDay(filtered), [filtered]);

  return (
    <div className="mx-auto w-full max-w-3xl space-y-4 p-3 md:p-4">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-faint">Memory map</p>
          <h1 className="mt-1 text-xl font-semibold tracking-[-0.02em]">Knowledge</h1>
        </div>
        <div className="flex items-center gap-4 font-mono text-[11px] text-faint">
          <span>
            <span className="text-text">{total.toLocaleString()}</span> items
          </span>
          <span>
            <span className="text-text">{sources.length}</span> sources
          </span>
        </div>
      </header>

      <Atlas items={items} filter={filter} onFilter={onFilter} theme={theme} />

      <div className="flex flex-wrap items-center justify-between gap-2 pb-3">
        <div className="flex flex-wrap items-center gap-1.5">
          <button
            type="button"
            onClick={() => onSource("all")}
            className={`rounded-full border px-2.5 py-1 text-[11px] transition ${
              source === "all"
                ? "border-line-strong bg-raised text-text"
                : "border-transparent text-muted hover:bg-raised/60"
            }`}
          >
            All <span className="ml-1 font-mono text-[10px] text-faint">{items.length}</span>
          </button>
          {sources.map(([id, count]) => {
            const meta = sourceMeta(id);
            return (
              <button
                key={id}
                type="button"
                onClick={() => onSource(source === id ? "all" : id)}
                className={`rounded-full border px-2.5 py-1 text-[11px] transition ${
                  source === id
                    ? "border-line-strong bg-raised text-text"
                    : "border-transparent text-muted hover:bg-raised/60"
                }`}
              >
                <span className="mr-1 inline-flex text-accent">
                  <SourceGlyph id={id} size={11} />
                </span>
                {meta.label}{" "}
                <span className="ml-0.5 font-mono text-[10px] text-faint">{count}</span>
              </button>
            );
          })}
        </div>

        {filter ? (
          <button
            type="button"
            onClick={() => onFilter(null)}
            className="flex items-center gap-1.5 rounded-full bg-raised px-2.5 py-1 font-mono text-[10px] text-accent transition hover:brightness-110"
          >
            <FilterIcon size={11} />
            {filter.label}
            <CloseIcon size={11} />
          </button>
        ) : (
          <Menu>
            <Tooltip label="Custom date filter">
              <MenuTrigger asChild>
                <button
                  type="button"
                  aria-label="Custom filter"
                  className="flex items-center gap-1.5 rounded-full px-2.5 py-1 font-mono text-[10px] uppercase tracking-wider text-faint transition hover:bg-raised hover:text-text"
                >
                  <FilterIcon size={12} />
                  {filtered.length} in stream
                </button>
              </MenuTrigger>
            </Tooltip>
            <MenuContent>
              <MenuItem
                onSelect={() =>
                  onFilter({
                    start: Date.now() - 7 * DAY,
                    end: Date.now(),
                    label: "Last 7 days",
                  })
                }
              >
                Last 7 days
              </MenuItem>
              <MenuItem
                onSelect={() =>
                  onFilter({
                    start: Date.now() - 30 * DAY,
                    end: Date.now(),
                    label: "Last 30 days",
                  })
                }
              >
                Last 30 days
              </MenuItem>
              <MenuItem
                onSelect={() =>
                  onFilter({
                    start: Date.now() - 90 * DAY,
                    end: Date.now(),
                    label: "Last 90 days",
                  })
                }
              >
                Last 90 days
              </MenuItem>
              <div aria-hidden="true" className="my-1 h-px bg-panel" />
              <MenuItem
                onSelect={() =>
                  onFilter({
                    start: new Date(new Date().getFullYear(), 0, 1).getTime(),
                    end: Date.now() + DAY,
                    label: `${new Date().getFullYear()} so far`,
                  })
                }
              >
                This year
              </MenuItem>
            </MenuContent>
          </Menu>
        )}
      </div>

      {items.length === 0 ? (
        <EmptyState
          title="Nothing captured yet"
          body="Save a link with ⌘K, or import the bookmarks already sitting in your browser."
          action={
            <div className="flex items-center gap-2">
              <Button type="button" variant="primary" size="sm" onClick={onOpenRecall}>
                Capture a link
              </Button>
              <Button type="button" variant="ghost" size="sm" onClick={onNavigateImport}>
                Import bookmarks
              </Button>
            </div>
          }
        />
      ) : filtered.length === 0 ? (
        <div className="py-14 text-center">
          <p className="text-sm text-muted">No items in this slice.</p>
          <Button
            type="button"
            variant="link"
            size="sm"
            onClick={() => {
              onFilter(null);
              onSource("all");
            }}
            className="mt-2"
          >
            Clear filters
          </Button>
        </div>
      ) : (
        <div className="space-y-4 pb-14">
          {groups.map((group) => (
            <section key={group.label}>
              <h2 className="sticky top-0 z-10 -mx-2 mb-1 bg-canvas px-2 py-1.5 font-mono text-[10px] uppercase tracking-[0.16em] text-faint">
                {group.label}
              </h2>
              <div className="space-y-0.5">
                {group.items.map((item) => {
                  const meta = sourceMeta(item.source);
                  const tags = item.tags_text.split(" ").filter(Boolean).slice(0, 3);
                  return (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() => onSelect(item.id)}
                      data-selected={item.id === selectedId}
                      className="row"
                    >
                      <div className="source-tile mt-0.5 text-accent">
                        <SourceGlyph id={item.source} size={12} />
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-baseline justify-between gap-3">
                          <span className="truncate text-[13.5px] font-medium text-text">
                            {item.title}
                          </span>
                          <span className="shrink-0 font-mono text-[10px] text-faint">
                            {timeLabel(item.captured_at)}
                          </span>
                        </div>
                        <p className="mt-0.5 line-clamp-1 text-[11.5px] leading-relaxed text-muted">
                          {item.summary ?? item.excerpt ?? "No text extracted yet."}
                        </p>
                        <div className="mt-1 flex items-center gap-2">
                          <span className="font-mono text-[10px] text-faint">{meta.label}</span>
                          {tags.map((tag) => (
                            <span
                              key={tag}
                              className="rounded bg-raised px-1.5 py-0.5 font-mono text-[9px] text-accent"
                            >
                              #{tag}
                            </span>
                          ))}
                          {item.embedding_state === "pending" ? (
                            <span className="font-mono text-[9px] text-accent">enriching…</span>
                          ) : null}
                          {item.embedding_state === "failed" ? (
                            <span className="font-mono text-[9px] text-coral">enrich failed</span>
                          ) : null}
                        </div>
                      </div>
                    </button>
                  );
                })}
              </div>
            </section>
          ))}

          {hasMore ? (
            <div className="pt-2">
              <button
                type="button"
                onClick={onLoadMore}
                disabled={loadingMore}
                className="w-full rounded-[var(--radius)] border border-line px-3 py-2 text-[11.5px] text-muted transition hover:bg-raised hover:text-text disabled:opacity-50"
              >
                {loadingMore ? "Loading…" : "Load more"}
              </button>
            </div>
          ) : null}
        </div>
      )}
    </div>
  );
}
