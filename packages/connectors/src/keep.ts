import type { ConnectorItem, ListResult } from "./types";

interface KeepNote {
  name: string;
  createTime?: string;
  title?: string;
  body?: { text?: { text?: string } };
  trashed?: boolean;
}

const PAGE_SIZE = 100;

/**
 * Notes from the Google Keep API (`GET /v1/notes`). Google Workspace accounts
 * with the Keep API enabled; private Gmail accounts are not supported.
 * The cursor is the opaque page token.
 */
export async function listKeepNotes(input: {
  token: string;
  cursor?: string | null;
  fetchImpl?: typeof fetch;
}): Promise<ListResult> {
  const fetchImpl = input.fetchImpl ?? fetch;
  const url = new URL("https://keep.googleapis.com/v1/notes");
  url.searchParams.set("pageSize", String(PAGE_SIZE));
  if (input.cursor) url.searchParams.set("pageToken", input.cursor);

  const res = await fetchImpl(url, {
    headers: { authorization: `Bearer ${input.token}`, accept: "application/json" },
  });
  if (!res.ok) throw new Error(`keep ${res.status}: ${await res.text()}`);
  const body = (await res.json()) as { notes?: KeepNote[]; nextPageToken?: string };

  const items: ConnectorItem[] = (body.notes ?? [])
    .filter((note) => note?.name && !note.trashed)
    .map((note) => {
      const text = note.body?.text?.text?.trim() ?? "";
      return {
        externalId: note.name,
        kind: "note",
        title: (note.title?.trim() || text.split("\n")[0]?.slice(0, 120) || "Keep note").slice(
          0,
          500,
        ),
        note: text || undefined,
        tags: ["keep"],
        capturedAt: note.createTime ? Date.parse(note.createTime) : undefined,
      };
    });

  return { items, nextCursor: body.nextPageToken ?? null };
}
