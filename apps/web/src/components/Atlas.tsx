import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { EmptyState } from "@omnibrain/ui";
import type { Item } from "../lib/api";
import { sourceMeta } from "../lib/format";

export interface AtlasFilter {
  start: number;
  end: number;
  sources?: string[];
  label: string;
}

const WEEKS = 52;
const DAY = 86_400_000;
const LEFT = 72;
const RIGHT = 8;
const TOP = 6;
const BOTTOM = 18;

function startOfWeek(ts: number): number {
  const d = new Date(ts);
  const offset = (d.getDay() + 6) % 7;
  d.setHours(0, 0, 0, 0);
  return d.getTime() - offset * DAY;
}

function geometry(width: number, height: number, rowCount: number) {
  const stepX = (width - LEFT - RIGHT) / WEEKS;
  const box = Math.max(4, Math.min(10, stepX - 2));
  const rowStep = Math.max(box + 3, 11);
  const blockH = Math.max(0, rowCount * rowStep - 3);
  const top = TOP + Math.max(0, (height - TOP - BOTTOM - blockH) / 2);
  return { stepX, box, rowStep, top };
}

export function Atlas({
  items,
  sources: knownSources = [],
  filter,
  onFilter,
  theme,
}: {
  items: Item[];
  sources?: string[];
  filter: AtlasFilter | null;
  onFilter: (filter: AtlasFilter | null) => void;
  theme: string;
}) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [now] = useState(() => Date.now());
  const [hover, setHover] = useState<{ x: number; y: number; label: string } | null>(null);
  const [cursor, setCursor] = useState<"default" | "crosshair">("default");
  const [drag, setDrag] = useState<{
    startWeek: number;
    startRow: number;
    endWeek: number;
    endRow: number;
  } | null>(null);
  const [dragging, setDragging] = useState(false);
  const dragRef = useRef<typeof drag>(null);

  const data = useMemo(() => {
    const currentWeek = startOfWeek(now);
    const start = currentWeek - (WEEKS - 1) * 7 * DAY;
    const counts = new Map<string, number[]>();
    for (const source of knownSources) {
      counts.set(
        source,
        Array.from({ length: WEEKS }, () => 0),
      );
    }
    for (const item of items) {
      const week = startOfWeek(item.captured_at);
      const index = Math.round((week - start) / (7 * DAY));
      if (index < 0 || index >= WEEKS) continue;
      const row = counts.get(item.source) ?? Array.from({ length: WEEKS }, () => 0);
      row[index] = (row[index] ?? 0) + 1;
      counts.set(item.source, row);
    }
    const rows = [...counts.entries()].toSorted(
      (a, b) => b[1].reduce((x, y) => x + y, 0) - a[1].reduce((x, y) => x + y, 0),
    );
    const max = Math.max(1, ...rows.flatMap(([, row]) => row));
    return { start, rows, max };
  }, [items, knownSources, now]);

  const draw = useCallback(() => {
    void theme;
    const canvas = canvasRef.current;
    const wrap = wrapRef.current;
    if (!canvas || !wrap) return;
    const rect = wrap.getBoundingClientRect();
    const width = rect.width;
    const height = rect.height;
    if (width < 20 || height < 20) return;

    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.floor(width * dpr);
    canvas.height = Math.floor(height * dpr);
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, width, height);

    const styles = getComputedStyle(document.documentElement);
    const accent = styles.getPropertyValue("--accent").trim() || "#e9b949";
    const line = styles.getPropertyValue("--line").trim() || "#333";
    const muted = styles.getPropertyValue("--muted").trim() || "#999";
    const raised = styles.getPropertyValue("--raised").trim() || "#2a2a2a";

    const rows = data.rows.length;
    const { stepX, box, rowStep, top } = geometry(width, height, rows);

    // Quarterly guides.
    ctx.strokeStyle = line;
    ctx.globalAlpha = 0.6;
    ctx.lineWidth = 1;
    for (let w = 0; w <= WEEKS; w += 13) {
      const x = Math.round(LEFT + w * stepX) + 0.5;
      ctx.beginPath();
      ctx.moveTo(x, TOP);
      ctx.lineTo(x, height - BOTTOM);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;

    ctx.font = "10px 'Geist Mono Variable', ui-monospace, monospace";
    ctx.textBaseline = "middle";
    const activeSources = filter?.sources?.length ? filter.sources : null;
    ctx.textAlign = "left";
    data.rows.forEach(([source], rowIndex) => {
      const label = sourceMeta(source).label;
      const active = Boolean(activeSources?.includes(source));
      ctx.font = active
        ? "600 10px 'Geist Mono Variable', ui-monospace, monospace"
        : "10px 'Geist Mono Variable', ui-monospace, monospace";
      ctx.fillStyle = active ? accent : muted;
      ctx.globalAlpha = activeSources && !active ? 0.35 : 1;
      ctx.fillText(
        label.length > 10 ? `${label.slice(0, 9)}…` : label,
        8,
        top + rowIndex * rowStep + box / 2,
      );
      ctx.globalAlpha = 1;
    });
    ctx.font = "9px 'Geist Mono Variable', ui-monospace, monospace";

    // Month labels at the first week of each month.
    let lastMonth = -1;
    for (let w = 0; w < WEEKS; w++) {
      const date = new Date(data.start + w * 7 * DAY + 3 * DAY);
      if (date.getMonth() !== lastMonth) {
        lastMonth = date.getMonth();
        ctx.fillStyle = muted;
        ctx.textAlign = "left";
        ctx.globalAlpha = 0.8;
        ctx.fillText(
          date.toLocaleDateString(undefined, { month: "short" }),
          LEFT + w * stepX + 1,
          height - BOTTOM / 2,
        );
        ctx.globalAlpha = 1;
      }
    }

    data.rows.forEach(([source, counts], rowIndex) => {
      const sourceIn = !activeSources || activeSources.includes(source);
      const y = top + rowIndex * rowStep;

      // Selected sources get a tinted row band so the choice reads at a glance.
      if (activeSources && sourceIn) {
        ctx.beginPath();
        ctx.roundRect(LEFT - 3, y - 2, width - LEFT - RIGHT + 6, box + 4, 4);
        ctx.fillStyle = accent;
        ctx.globalAlpha = 0.09;
        ctx.fill();
        ctx.globalAlpha = 1;
      }

      counts.forEach((count, week) => {
        const x = LEFT + week * stepX + (stepX - box) / 2;
        const weekStart = data.start + week * 7 * DAY;
        const inFilter =
          Boolean(filter) &&
          sourceIn &&
          weekStart >= (filter?.start ?? 0) &&
          weekStart < (filter?.end ?? 0);
        const dimmed = Boolean(filter) && !inFilter;

        ctx.beginPath();
        ctx.roundRect(x, y, box, box, 2);
        if (count === 0) {
          ctx.fillStyle = raised;
          ctx.globalAlpha = dimmed ? 0.25 : 0.55;
          ctx.fill();
        } else {
          ctx.fillStyle = accent;
          ctx.globalAlpha = dimmed ? 0.16 : 0.3 + 0.7 * (count / data.max);
          ctx.fill();
        }
        ctx.globalAlpha = 1;
        if (inFilter && count > 0) {
          ctx.strokeStyle = accent;
          ctx.lineWidth = 2;
          ctx.stroke();
        }
      });
    });

    // Drag selection overlay.
    if (drag) {
      const minWeek = Math.min(drag.startWeek, drag.endWeek);
      const maxWeek = Math.max(drag.startWeek, drag.endWeek);
      const minRow = Math.min(drag.startRow, drag.endRow);
      const maxRow = Math.max(drag.startRow, drag.endRow);
      const x = LEFT + minWeek * stepX + (stepX - box) / 2;
      const y = top + minRow * rowStep;
      const w = (maxWeek - minWeek) * stepX + box;
      const h = (maxRow - minRow) * rowStep + box;
      ctx.fillStyle = accent;
      ctx.globalAlpha = 0.12;
      ctx.fillRect(x - 1, y - 1, w + 2, h + 2);
      ctx.globalAlpha = 1;
      ctx.strokeStyle = accent;
      ctx.lineWidth = 1;
      ctx.strokeRect(x - 1, y - 1, w + 2, h + 2);
    }
    // Theme is read through computed CSS variables, so it must retrigger the draw.
    // eslint-disable-next-line react/memo-dependencies
  }, [data, filter, theme, drag]);

  useLayoutEffect(() => {
    const wrap = wrapRef.current;
    if (!wrap) return;
    const observer = new ResizeObserver(() => draw());
    observer.observe(wrap);
    draw();
    const raf = requestAnimationFrame(draw);
    return () => {
      observer.disconnect();
      cancelAnimationFrame(raf);
    };
  }, [draw]);

  /** Any point inside the grid, gaps included. Drag selection starts and moves here. */
  const gridCellFromEvent = (e: React.MouseEvent<HTMLCanvasElement>, clamp = false) => {
    const canvas = canvasRef.current;
    if (!canvas || data.rows.length === 0) return null;
    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    const { stepX, box, rowStep, top } = geometry(rect.width, rect.height, data.rows.length);

    // The plot area includes the margins around the row/box block, so a drag can
    // start anywhere in the map instead of requiring a precise box hit.
    if (x < LEFT || x > rect.width - RIGHT || y < TOP || y > rect.height - BOTTOM) {
      return null;
    }

    let week = Math.floor((x - LEFT) / stepX);
    let row = Math.floor((y - top) / rowStep);
    if (clamp) {
      week = Math.min(Math.max(week, 0), WEEKS - 1);
      row = Math.min(Math.max(row, 0), data.rows.length - 1);
    } else if (y < top || y > top + data.rows.length * rowStep) {
      return null;
    }

    const entry = data.rows[row];
    if (!entry) return null;
    return {
      x,
      y,
      week,
      row,
      source: entry[0],
      count: entry[1][week] ?? 0,
      stepX,
      box,
      rowStep,
      top,
    };
  };

  /** Box-precise hit test for hover; gaps stay inert until you actually drag. */
  const cellFromEvent = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const cell = gridCellFromEvent(e);
    if (!cell) return null;
    const boxX = LEFT + cell.week * cell.stepX + (cell.stepX - cell.box) / 2;
    const boxY = cell.top + cell.row * cell.rowStep;
    if (
      cell.x < boxX - 1 ||
      cell.x > boxX + cell.box + 1 ||
      cell.y < boxY - 1 ||
      cell.y > boxY + cell.box + 1
    ) {
      return null;
    }
    return cell;
  };

  const commitDrag = useCallback(
    (selection: NonNullable<typeof drag>) => {
      const minWeek = Math.min(selection.startWeek, selection.endWeek);
      const maxWeek = Math.max(selection.startWeek, selection.endWeek);
      const minRow = Math.min(selection.startRow, selection.endRow);
      const maxRow = Math.max(selection.startRow, selection.endRow);
      const sources = data.rows.slice(minRow, maxRow + 1).map(([source]) => source);
      const start = data.start + minWeek * 7 * DAY;
      const end = data.start + (maxWeek + 1) * 7 * DAY;
      const same =
        filter?.start === start &&
        filter?.end === end &&
        (filter.sources ?? []).join(",") === sources.join(",");
      if (same) {
        onFilter(null);
        return;
      }
      const labels = sources.map((source) => sourceMeta(source).label).join(", ");
      const fmt = (ts: number) =>
        new Date(ts).toLocaleDateString(undefined, { day: "numeric", month: "short" });
      onFilter({
        start,
        end,
        sources,
        label: `${labels} · ${fmt(start)} – ${fmt(end - DAY)}`,
      });
    },
    [data, filter, onFilter],
  );

  useEffect(() => {
    if (!dragging) return;
    const onUp = () => {
      const selection = dragRef.current;
      setDragging(false);
      setDrag(null);
      dragRef.current = null;
      if (selection) commitDrag(selection);
    };
    window.addEventListener("mouseup", onUp);
    return () => window.removeEventListener("mouseup", onUp);
  }, [dragging, commitDrag]);

  const handleDown = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const cell = gridCellFromEvent(e, true);
    if (!cell) return;
    e.preventDefault();
    const selection = {
      startWeek: cell.week,
      startRow: cell.row,
      endWeek: cell.week,
      endRow: cell.row,
    };
    dragRef.current = selection;
    setDrag(selection);
    setDragging(true);
    setHover(null);
  };

  const handleMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (dragging) {
      const cell = gridCellFromEvent(e, true);
      if (!cell) return;
      setCursor("crosshair");
      const next = {
        ...(dragRef.current ?? {
          startWeek: cell.week,
          startRow: cell.row,
          endWeek: cell.week,
          endRow: cell.row,
        }),
        endWeek: cell.week,
        endRow: cell.row,
      };
      dragRef.current = next;
      setDrag(next);
      return;
    }

    const cell = cellFromEvent(e);
    if (!cell) {
      setHover(null);
      setCursor("default");
      return;
    }
    setCursor("crosshair");
    if (cell.count === 0) {
      setHover(null);
      return;
    }
    const label = `${sourceMeta(cell.source).label} · week of ${new Date(data.start + cell.week * 7 * DAY).toLocaleDateString(undefined, { day: "numeric", month: "short" })}`;
    setHover({
      x: LEFT + cell.week * cell.stepX + cell.stepX / 2,
      y: cell.top + cell.row * cell.rowStep - 4,
      label: `${label} · ${cell.count}`,
    });
  };

  if (items.length === 0) {
    return (
      <EmptyState
        title="Nothing captured yet"
        body="Capture a link or import browser bookmarks. The map fills in by source and week."
      />
    );
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.14em] text-faint">
          <span>{WEEKS} weeks</span>
          <span className="text-faint">/</span>
          <span>{data.rows.length} rows</span>
        </div>
        <div className="flex items-center gap-1.5 font-mono text-[10px] text-faint">
          <span>less</span>
          {[0.15, 0.35, 0.6, 0.85].map((alpha) => (
            <span
              key={alpha}
              className="size-2 rounded-[2px] bg-accent"
              style={{ opacity: alpha }}
            />
          ))}
          <span>more</span>
        </div>
      </div>
      <div
        ref={wrapRef}
        className="relative w-full overflow-hidden rounded-[var(--radius)] bg-panel"
        style={{ height: Math.max(112, data.rows.length * 14 + 24) }}
      >
        <canvas
          ref={canvasRef}
          className="atlas-canvas"
          style={{ cursor }}
          role="img"
          aria-label={`Capture density by source for the last ${WEEKS} weeks. Drag a box to filter the stream.`}
          onMouseDown={handleDown}
          onMouseMove={handleMove}
          onMouseLeave={() => {
            setHover(null);
            setCursor("default");
          }}
        />
        {hover ? (
          <div
            className="pointer-events-none absolute z-10 -translate-x-1/2 -translate-y-full rounded bg-raised px-2 py-1 font-mono text-[9.5px] text-text"
            style={{ left: hover.x, top: hover.y }}
          >
            {hover.label}
          </div>
        ) : null}
      </div>
      <p className="font-mono text-[9px] text-faint">
        Drag anywhere across the map to filter sources over a date range.
      </p>
    </div>
  );
}
