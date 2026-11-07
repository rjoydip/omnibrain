export const SOURCE_META: Record<
  string,
  { label: string; glyph: string; tone: "amber" | "cobalt" | "mint" | "coral" | "muted" }
> = {
  web: { label: "Web", glyph: "◍", tone: "cobalt" },
  browser: { label: "Bookmarks", glyph: "B", tone: "amber" },
  notion: { label: "Notion", glyph: "N", tone: "cobalt" },
  keep: { label: "Keep", glyph: "K", tone: "amber" },
  x: { label: "X", glyph: "X", tone: "coral" },
  raindrop: { label: "Raindrop", glyph: "R", tone: "mint" },
  readwise: { label: "Readwise", glyph: "◈", tone: "cobalt" },
  obsidian: { label: "Obsidian", glyph: "◆", tone: "muted" },
  mcp: { label: "MCP", glyph: "M", tone: "mint" },
  file: { label: "File", glyph: "▤", tone: "muted" },
};

export function sourceMeta(source: string) {
  return SOURCE_META[source] ?? { label: source, glyph: "·", tone: "muted" as const };
}

const DAY = 86_400_000;

export function startOfDay(ts: number): number {
  const d = new Date(ts);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

export function dayLabel(ts: number, now = Date.now()): string {
  const day = startOfDay(ts);
  const today = startOfDay(now);
  if (day === today) return "Today";
  if (day === today - DAY) return "Yesterday";
  const date = new Date(ts);
  const sameYear = date.getFullYear() === new Date(now).getFullYear();
  return date.toLocaleDateString(undefined, {
    weekday: "short",
    day: "numeric",
    month: "short",
    ...(sameYear ? {} : { year: "numeric" }),
  });
}

export function timeLabel(ts: number): string {
  return new Date(ts).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
}

export function groupByDay<T extends { captured_at: number }>(
  items: T[],
): Array<{ label: string; items: T[] }> {
  const groups: Array<{ label: string; items: T[] }> = [];
  for (const item of items) {
    const label = dayLabel(item.captured_at);
    const last = groups.at(-1);
    if (last?.label === label) last.items.push(item);
    else groups.push({ label, items: [item] });
  }
  return groups;
}

export function formatCount(n: number, limit?: number): string {
  const value = n.toLocaleString();
  return limit === undefined
    ? value
    : `${value} / ${limit === Number.POSITIVE_INFINITY ? "∞" : limit.toLocaleString()}`;
}

export function shortUrl(url: string | null): string {
  if (!url) return "";
  try {
    const u = new URL(url);
    return `${u.hostname.replace(/^www\./, "")}${u.pathname === "/" ? "" : u.pathname}`;
  } catch {
    return url;
  }
}

export function initials(email: string): string {
  return email.slice(0, 2).toUpperCase();
}

export const ACCENT_SWATCHES: Record<string, string> = {
  cobalt: "var(--a-cobalt)",
  amber: "var(--a-amber)",
  mint: "var(--a-mint)",
  coral: "var(--a-coral)",
  violet: "var(--a-violet)",
  slate: "var(--a-slate)",
};

export function relativeTime(ts: number | null): string {
  if (!ts) return "never";
  const diff = Date.now() - ts;
  if (diff < 60_000) return "just now";
  if (diff < 3_600_000) return `${Math.round(diff / 60_000)}m ago`;
  if (diff < 86_400_000) return `${Math.round(diff / 3_600_000)}h ago`;
  return `${Math.round(diff / 86_400_000)}d ago`;
}
