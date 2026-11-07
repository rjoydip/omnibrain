import type { ConnectorItem } from "./types";

interface KeepNote {
  title?: string;
  textContent?: string;
  listContent?: Array<{ text?: string; isChecked?: boolean }>;
  labels?: Array<{ name?: string }>;
  createdTimestampUsec?: number;
  isTrashed?: boolean;
  isArchived?: boolean;
}

/**
 * Google Keep Takeout JSON. Import-only: consumer Keep has no public API.
 */
export function parseKeepTakeout(json: string): ConnectorItem[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    return [];
  }
  const notes: KeepNote[] = Array.isArray(parsed)
    ? (parsed as KeepNote[])
    : Array.isArray((parsed as { notes?: KeepNote[] })?.notes)
      ? ((parsed as { notes: KeepNote[] }).notes as KeepNote[])
      : [parsed as KeepNote];

  const out: ConnectorItem[] = [];
  notes.forEach((note, index) => {
    if (!note || typeof note !== "object" || note.isTrashed) return;
    const listText = (note.listContent ?? [])
      .map((l) => `${l.isChecked ? "[x]" : "[ ]"} ${l.text ?? ""}`.trim())
      .filter(Boolean)
      .join("\n");
    const body = [note.textContent ?? "", listText].filter(Boolean).join("\n").trim();
    if (!body && !note.title) return;

    const title = (note.title ?? "").trim() || body.split("\n")[0]?.slice(0, 120) || "Keep note";
    const capturedAt =
      typeof note.createdTimestampUsec === "number"
        ? Math.round(note.createdTimestampUsec / 1000)
        : undefined;

    out.push({
      externalId: `keep:${title}:${capturedAt ?? index}`,
      kind: "note",
      title: title.slice(0, 500),
      note: body.slice(0, 100_000),
      tags: (note.labels ?? []).map((l) => l.name ?? "").filter(Boolean),
      capturedAt,
    });
  });
  return out;
}
