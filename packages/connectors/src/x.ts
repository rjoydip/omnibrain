import type { ConnectorItem, ListResult } from "./types";

interface Tweet {
  id: string;
  text?: string;
  created_at?: string;
  author_id?: string;
}

/**
 * X API v2 bookmarks. Requires OAuth 2.0 user context and a paid API tier.
 * Pagination is token-based; there is no since_id, so callers stop when they
 * see an external id they already have.
 */
export async function listXBookmarks(input: {
  token: string;
  userId: string;
  paginationToken?: string | null;
  fetchImpl?: typeof fetch;
}): Promise<ListResult> {
  const fetchImpl = input.fetchImpl ?? fetch;
  const url = new URL(`https://api.x.com/2/users/${input.userId}/bookmarks`);
  url.searchParams.set("max_results", "100");
  url.searchParams.set("tweet.fields", "created_at,author_id,text");
  if (input.paginationToken) url.searchParams.set("pagination_token", input.paginationToken);

  const res = await fetchImpl(url, {
    headers: { authorization: `Bearer ${input.token}` },
  });
  if (!res.ok) throw new Error(`x ${res.status}: ${await res.text()}`);
  const body = (await res.json()) as {
    data?: Tweet[];
    meta?: { next_token?: string };
  };

  const items: ConnectorItem[] = (body.data ?? []).map((tweet) => {
    const text = (tweet.text ?? "").trim();
    return {
      externalId: tweet.id,
      kind: "bookmark",
      url: `https://x.com/i/web/status/${tweet.id}`,
      title: (text.split("\n")[0] ?? "X post").slice(0, 120),
      note: text,
      capturedAt: tweet.created_at ? Date.parse(tweet.created_at) : undefined,
      tags: ["x"],
      author: tweet.author_id,
    };
  });

  return { items, nextCursor: body.meta?.next_token ?? null };
}
