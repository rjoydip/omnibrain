import type { ConnectorItem, ListResult } from "./types";

interface Raindrop {
  _id: number;
  title?: string;
  link?: string;
  excerpt?: string;
  tags?: string[];
  created?: string;
  lastUpdate?: string;
  type?: string;
}

export async function listRaindrops(input: {
  token: string;
  page?: number;
  fetchImpl?: typeof fetch;
}): Promise<ListResult> {
  const fetchImpl = input.fetchImpl ?? fetch;
  const page = input.page ?? 0;
  const res = await fetchImpl(
    `https://api.raindrop.io/rest/v1/raindrops/0?page=${page}&perpage=50&sort=-created`,
    { headers: { authorization: `Bearer ${input.token}` } },
  );
  if (!res.ok) throw new Error(`raindrop ${res.status}: ${await res.text()}`);
  const body = (await res.json()) as { items?: Raindrop[] };

  const items: ConnectorItem[] = (body.items ?? []).map((r) => ({
    externalId: String(r._id),
    kind: r.type === "article" ? "bookmark" : "bookmark",
    url: r.link,
    title: (r.title || r.link || "Raindrop").slice(0, 500),
    note: r.excerpt,
    tags: r.tags ?? [],
    capturedAt: r.created ? Date.parse(r.created) : undefined,
  }));

  return { items, nextCursor: items.length === 50 ? String(page + 1) : null };
}
