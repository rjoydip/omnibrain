import { useCallback, useEffect, useRef } from "react";
import type { Item } from "../lib/api";
import { sourceMeta } from "../lib/format";
import type { Theme } from "../lib/nav";

interface GraphNode {
  id: string;
  kind: "source" | "item";
  source: string;
  label: string;
  x: number;
  y: number;
  radius: number;
  colorIndex: number;
  count: number;
  item?: Item;
}

type Drag =
  | {
      kind: "pan";
      startX: number;
      startY: number;
      panX: number;
      panY: number;
      moved: boolean;
    }
  | {
      kind: "node";
      id: string;
      startX: number;
      startY: number;
      nodeX: number;
      nodeY: number;
      moved: boolean;
    };

const MAX_ITEMS_PER_SOURCE = 18;

function sourceColor(colorIndex: number, colors: string[]): string {
  return colors[colorIndex % colors.length] ?? colors[0] ?? "#7db4ff";
}

/** Nine lightness variants of the active accent, so each source group differs. */
function clampLightness(value: number): number {
  return Math.min(0.94, Math.max(0.28, value));
}

function accentShades(accent: string): string[] {
  const offsets = [-0.24, -0.18, -0.12, -0.06, 0, 0.06, 0.12, 0.18, 0.24];
  const oklch = /^oklch\(\s*([\d.]+)\s+([\d.]+)\s+([\d.]+)/i.exec(accent);
  if (oklch) {
    const l = Number(oklch[1]);
    const c = Number(oklch[2]);
    const h = Number(oklch[3]);
    return offsets.map((delta) => `oklch(${clampLightness(l + delta).toFixed(3)} ${c} ${h})`);
  }
  const hex = /^#([0-9a-f]{6})$/i.exec(accent);
  if (hex) {
    const raw = hex[1] ?? "7db4ff";
    const channels = [0, 2, 4].map((index) => Number.parseInt(raw.slice(index, index + 2), 16));
    return [0.45, 0.62, 0.78, 0.9, 1, 1.1, 1.22, 1.35, 1.5].map((factor) => {
      const rgb = channels.map((channel) =>
        factor <= 1
          ? Math.round(channel * factor)
          : Math.round(channel + (255 - channel) * (factor - 1)),
      );
      return `rgb(${rgb.join(" ")})`;
    });
  }
  return offsets.map(() => accent);
}

/** Stable palette slot per source, independent of the current filter or sort order. */
function sourceColorIndex(source: string): number {
  let hash = 0;
  for (let i = 0; i < source.length; i++) hash = (hash * 31 + source.charCodeAt(i)) >>> 0;
  return hash % 9;
}

function truncate(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

function buildNodes(items: Item[]): GraphNode[] {
  const groups = new Map<string, Item[]>();
  for (const item of items) {
    const list = groups.get(item.source) ?? [];
    list.push(item);
    groups.set(item.source, list);
  }
  const sources = [...groups.entries()].toSorted((a, b) => b[1].length - a[1].length);
  const nodes: GraphNode[] = [];
  const ring = Math.max(180, Math.min(520, sources.length * 72));

  sources.forEach(([source, list], index) => {
    const angle = -Math.PI / 2 + (index / Math.max(sources.length, 1)) * Math.PI * 2;
    const sx = Math.cos(angle) * ring;
    const sy = Math.sin(angle) * ring;
    const shown = list.slice(0, MAX_ITEMS_PER_SOURCE);
    const hubRadius = 14 + Math.min(12, list.length * 0.8);
    nodes.push({
      id: `source:${source}`,
      kind: "source",
      source,
      label: sourceMeta(source).label,
      x: sx,
      y: sy,
      radius: hubRadius,
      colorIndex: sourceColorIndex(source),
      count: list.length,
    });

    const orbit = hubRadius + 34 + Math.min(18, shown.length * 1.5);
    shown.forEach((item, itemIndex) => {
      const itemAngle = (itemIndex / Math.max(shown.length, 1)) * Math.PI * 2;
      nodes.push({
        id: item.id,
        kind: "item",
        source,
        label: item.title,
        x: sx + Math.cos(itemAngle) * orbit,
        y: sy + Math.sin(itemAngle) * orbit,
        radius: 5 + Math.min(4, item.tags_text.split(" ").filter(Boolean).length),
        colorIndex: sourceColorIndex(source),
        count: 0,
        item,
      });
    });
  });

  return nodes;
}

/** Source-clustered knowledge graph: drag to pan, drag nodes, scroll to zoom. */
export function ItemGraph({
  items,
  source,
  selectedId,
  theme,
  onSelect,
  onSource,
  onCloseInspector,
}: {
  items: Item[];
  source: string;
  selectedId: string | null;
  theme: Theme;
  onSelect: (id: string) => void;
  onSource: (source: string) => void;
  onCloseInspector: () => void;
}) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const nodesRef = useRef<GraphNode[]>([]);
  const viewRef = useRef({ x: 0, y: 0, k: 1 });
  const hoverRef = useRef<string | null>(null);
  const selectedRef = useRef<string | null>(selectedId);
  const dragRef = useRef<Drag | null>(null);

  const draw = useCallback(() => {
    const wrap = wrapRef.current;
    const canvas = canvasRef.current;
    if (!wrap || !canvas) return;
    const rect = wrap.getBoundingClientRect();
    if (rect.width < 40 || rect.height < 40) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.floor(rect.width * dpr);
    canvas.height = Math.floor(rect.height * dpr);
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const styles = getComputedStyle(document.documentElement);
    const color = (name: string, fallback: string) =>
      styles.getPropertyValue(name).trim() || fallback;
    const colors = accentShades(color("--accent", "#7db4ff"));
    const paper = theme === "paper";
    const text = color("--text", paper ? "#111" : "#eee");
    const faint = color("--faint", paper ? "#666" : "#777");

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, rect.width, rect.height);
    const view = viewRef.current;
    ctx.save();
    ctx.translate(rect.width / 2 + view.x, rect.height / 2 + view.y);
    ctx.scale(view.k, view.k);

    const nodes = nodesRef.current;
    const byId = new Map(nodes.map((node) => [node.id, node]));

    for (const node of nodes) {
      if (node.kind !== "item") continue;
      const hub = byId.get(`source:${node.source}`);
      if (!hub) continue;
      ctx.beginPath();
      ctx.moveTo(hub.x, hub.y);
      ctx.lineTo(node.x, node.y);
      ctx.strokeStyle = sourceColor(node.colorIndex, colors);
      ctx.globalAlpha = 0.16 + Math.min(0.35, node.radius / 16);
      ctx.lineWidth = 1;
      ctx.stroke();
      ctx.globalAlpha = 1;
    }

    for (const node of nodes) {
      const hovered = hoverRef.current === node.id;
      const selected = selectedRef.current === node.id;
      const fill = sourceColor(node.colorIndex, colors);
      ctx.beginPath();
      ctx.arc(node.x, node.y, node.radius, 0, Math.PI * 2);
      ctx.fillStyle = fill;
      ctx.globalAlpha = node.kind === "source" ? 0.9 : hovered || selected ? 1 : 0.62;
      ctx.fill();
      ctx.globalAlpha = 1;
      if (selected || node.kind === "source") {
        ctx.beginPath();
        ctx.arc(node.x, node.y, node.radius + 3, 0, Math.PI * 2);
        ctx.strokeStyle = selected ? text : fill;
        ctx.globalAlpha = selected ? 0.9 : 0.35;
        ctx.lineWidth = 1.2;
        ctx.stroke();
        ctx.globalAlpha = 1;
      }

      if (node.kind === "source") {
        ctx.font = "600 10px 'Geist Mono Variable', ui-monospace, monospace";
        ctx.fillStyle = text;
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText(String(node.count), node.x, node.y + 0.5);
        ctx.font = "10px 'Geist Mono Variable', ui-monospace, monospace";
        ctx.textBaseline = "top";
        ctx.fillText(truncate(node.label, 18), node.x, node.y + node.radius + 6);
      } else if (hovered || selected) {
        ctx.font = "10px 'Geist Mono Variable', ui-monospace, monospace";
        ctx.fillStyle = text;
        ctx.textAlign = "center";
        ctx.textBaseline = "bottom";
        ctx.fillText(truncate(node.label, 28), node.x, node.y - node.radius - 4);
      }
    }

    ctx.restore();

    ctx.font = "9px 'Geist Mono Variable', ui-monospace, monospace";
    ctx.fillStyle = faint;
    ctx.textAlign = "left";
    ctx.textBaseline = "bottom";
    ctx.fillText(
      `${nodes.filter((n) => n.kind === "source").length} sources · ${nodes.filter((n) => n.kind === "item").length} items`,
      10,
      rect.height - 8,
    );
  }, [theme]);

  const fit = useCallback(() => {
    const wrap = wrapRef.current;
    const nodes = nodesRef.current;
    if (!wrap || nodes.length === 0) return;
    const rect = wrap.getBoundingClientRect();
    if (rect.width < 40) return;
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const node of nodes) {
      minX = Math.min(minX, node.x - node.radius);
      maxX = Math.max(maxX, node.x + node.radius);
      minY = Math.min(minY, node.y - node.radius);
      maxY = Math.max(maxY, node.y + node.radius);
    }
    const spanX = Math.max(80, maxX - minX + 100);
    const spanY = Math.max(80, maxY - minY + 100);
    const k = Math.min(1.3, Math.max(0.28, Math.min(rect.width / spanX, rect.height / spanY)));
    const centerX = (minX + maxX) / 2;
    const centerY = (minY + maxY) / 2;
    viewRef.current = { x: -centerX * k, y: -centerY * k, k };
  }, []);

  useEffect(() => {
    nodesRef.current = buildNodes(items);
    fit();
    draw();
  }, [items, fit, draw]);

  useEffect(() => {
    selectedRef.current = selectedId;
    draw();
  }, [selectedId, draw]);

  useEffect(() => {
    const wrap = wrapRef.current;
    if (!wrap) return;
    const observer = new ResizeObserver(() => draw());
    observer.observe(wrap);
    return () => observer.disconnect();
  }, [draw]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const handler = (event: WheelEvent) => {
      event.preventDefault();
      if (event.deltaY > 0 && selectedRef.current) {
        onCloseInspector();
        return;
      }
      const rect = canvas.getBoundingClientRect();
      const view = viewRef.current;
      const px = event.clientX - rect.left - rect.width / 2;
      const py = event.clientY - rect.top - rect.height / 2;
      const beforeX = (px - view.x) / view.k;
      const beforeY = (py - view.y) / view.k;
      const nextK = Math.min(2.6, Math.max(0.25, view.k * (event.deltaY < 0 ? 1.12 : 0.89)));
      viewRef.current = {
        x: px - beforeX * nextK,
        y: py - beforeY * nextK,
        k: nextK,
      };
      draw();
    };
    canvas.addEventListener("wheel", handler, { passive: false });
    return () => canvas.removeEventListener("wheel", handler);
  }, [draw, onCloseInspector]);

  const nodeAt = (
    event: React.PointerEvent<HTMLCanvasElement> | React.MouseEvent<HTMLCanvasElement>,
  ) => {
    const canvas = canvasRef.current;
    if (!canvas) return null;
    const rect = canvas.getBoundingClientRect();
    const view = viewRef.current;
    const x = (event.clientX - rect.left - rect.width / 2 - view.x) / view.k;
    const y = (event.clientY - rect.top - rect.height / 2 - view.y) / view.k;
    const nodes = nodesRef.current;
    for (let i = nodes.length - 1; i >= 0; i--) {
      const node = nodes[i];
      if (!node) continue;
      if ((node.x - x) ** 2 + (node.y - y) ** 2 <= (node.radius + 3) ** 2) return node;
    }
    return null;
  };

  const onPointerDown = (event: React.PointerEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    event.preventDefault();
    const node = nodeAt(event);
    if (node) {
      dragRef.current = {
        kind: "node",
        id: node.id,
        startX: event.clientX,
        startY: event.clientY,
        nodeX: node.x,
        nodeY: node.y,
        moved: false,
      };
    } else {
      const view = viewRef.current;
      dragRef.current = {
        kind: "pan",
        startX: event.clientX,
        startY: event.clientY,
        panX: view.x,
        panY: view.y,
        moved: false,
      };
    }
    canvas.setPointerCapture(event.pointerId);
    canvas.style.cursor = "grabbing";
  };

  const onPointerMove = (event: React.PointerEvent<HTMLCanvasElement>) => {
    const drag = dragRef.current;
    const canvas = canvasRef.current;
    if (!canvas) return;
    if (!drag) {
      const node = nodeAt(event);
      const next = node?.id ?? null;
      canvas.style.cursor = node ? "pointer" : "grab";
      if (hoverRef.current !== next) {
        hoverRef.current = next;
        draw();
      }
      return;
    }

    const dx = event.clientX - drag.startX;
    const dy = event.clientY - drag.startY;
    if (Math.abs(dx) + Math.abs(dy) > 3) drag.moved = true;
    if (drag.kind === "pan") {
      viewRef.current = { ...viewRef.current, x: drag.panX + dx, y: drag.panY + dy };
    } else {
      const node = nodesRef.current.find((entry) => entry.id === drag.id);
      if (node) {
        node.x = drag.nodeX + dx / viewRef.current.k;
        node.y = drag.nodeY + dy / viewRef.current.k;
      }
    }
    draw();
  };

  const endDrag = (event: React.PointerEvent<HTMLCanvasElement>) => {
    const drag = dragRef.current;
    dragRef.current = null;
    const canvas = canvasRef.current;
    if (canvas) {
      canvas.style.cursor = "grab";
      if (canvas.hasPointerCapture(event.pointerId)) canvas.releasePointerCapture(event.pointerId);
    }
    if (!drag || drag.kind !== "node" || drag.moved) return;
    const node = nodesRef.current.find((entry) => entry.id === drag.id);
    if (!node) return;
    if (node.kind === "source") {
      onSource(source === node.source ? "all" : node.source);
    } else if (node.item) {
      onSelect(node.item.id);
    }
  };

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="text-[12px] font-medium text-text">Source graph</p>
          <p className="font-mono text-[9px] uppercase tracking-wider text-faint">
            drag to pan · scroll to zoom · click an item to inspect
          </p>
        </div>
        <p className="font-mono text-[9px] uppercase tracking-wider text-faint">
          click a source hub to filter
        </p>
      </div>
      <div
        ref={wrapRef}
        className="relative h-[30rem] w-full touch-none overflow-hidden rounded-[var(--radius)] bg-panel"
      >
        <canvas
          ref={canvasRef}
          className="atlas-canvas"
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={endDrag}
          onPointerCancel={endDrag}
          onPointerLeave={() => {
            hoverRef.current = null;
            draw();
          }}
          role="img"
          aria-label="Knowledge graph grouped by source"
        />
      </div>
    </div>
  );
}
