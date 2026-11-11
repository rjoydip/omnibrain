import { describe, expect, test } from "bun:test";
import { parseBookmarksHtml } from "./browser";
import { listGithubGists } from "./github";
import { APP_CATALOG, getApp, syncApp } from "./registry";

const SAMPLE = `<!DOCTYPE NETSCAPE-Bookmark-file-1>
<DL><p>
  <DT><H3 ADD_DATE="1600000000">Dev</H3>
  <DL><p>
    <DT><A HREF="https://bun.sh/docs?x=1&amp;y=2" ADD_DATE="1700000000">Bun &amp; workspaces</A>
    <DT><H3>Nested</H3>
    <DL><p>
      <DT><A HREF="https://example.com/n">Nested link</A>
    </DL><p>
    <DT><A HREF="javascript:alert(1)">bad</A>
  </DL><p>
</DL><p>`;

describe("browser bookmarks parser", () => {
  test("extracts links, decodes entities and folder tags", () => {
    const items = parseBookmarksHtml(SAMPLE);
    expect(items).toHaveLength(2);
    expect(items[0]?.url).toBe("https://bun.sh/docs?x=1&y=2");
    expect(items[0]?.title).toBe("Bun & workspaces");
    expect(items[0]?.tags).toEqual(["Dev"]);
    expect(items[0]?.capturedAt).toBe(1_700_000_000_000);
    expect(items[1]?.tags).toEqual(["Dev", "Nested"]);
    expect(items[1]?.folder).toBe("Dev / Nested");
  });

  test("drops unsafe schemes and duplicates", () => {
    const items = parseBookmarksHtml(
      `<DL><DT><A HREF="https://a.example">A</A><DT><A HREF="https://a.example">A again</A><DT><A HREF="javascript:x">J</A></DL>`,
    );
    expect(items).toHaveLength(1);
  });

  test("empty input is safe", () => {
    expect(parseBookmarksHtml("")).toEqual([]);
  });
});

describe("github gists adapter", () => {
  test("maps gists, loads file content and pages by number", async () => {
    const seen: string[] = [];
    const fetchImpl = (async (input: Parameters<typeof fetch>[0]) => {
      const url = String(input);
      seen.push(url);
      if (url.includes("/gists?")) {
        return new Response(
          JSON.stringify([
            {
              id: "abc123",
              html_url: "https://gist.github.com/octocat/abc123",
              description: "Fast runtime notes",
              created_at: "2024-01-01T00:00:00Z",
              files: { "notes.md": { filename: "notes.md", language: "Markdown" } },
              owner: { login: "octocat" },
            },
          ]),
          { status: 200 },
        );
      }
      return new Response(
        JSON.stringify({
          files: {
            "notes.md": { filename: "notes.md", content: "# Fast runtime\nbun --watch" },
          },
        }),
        { status: 200 },
      );
    }) as typeof fetch;

    const res = await listGithubGists({ token: "t", fetchImpl });
    expect(seen[0]).toContain("/gists?");
    expect(seen.some((url) => url.endsWith("/gists/abc123"))).toBe(true);
    expect(res.items[0]).toMatchObject({
      externalId: "abc123",
      kind: "note",
      url: "https://gist.github.com/octocat/abc123",
      title: "Fast runtime notes",
      note: "# Fast runtime\nbun --watch",
      lang: "markdown",
      tags: [],
      author: "octocat",
    });
    expect(res.items[0]?.capturedAt).toBe(Date.parse("2024-01-01T00:00:00Z"));
    expect(res.nextCursor).toBeNull();
  });

  test("keeps multiple files structured for per-file tabs", async () => {
    const fetchImpl = (async (input: Parameters<typeof fetch>[0]) => {
      const url = String(input);
      if (url.includes("/gists?")) {
        return new Response(
          JSON.stringify([
            {
              id: "multi",
              html_url: "https://gist.github.com/octocat/multi",
              description: "Multi-file gist",
              files: {
                "README.md": { filename: "README.md", language: "Markdown" },
                "index.ts": { filename: "index.ts", language: "TypeScript" },
              },
              owner: { login: "octocat" },
            },
          ]),
          { status: 200 },
        );
      }
      return new Response(
        JSON.stringify({
          files: {
            "README.md": { filename: "README.md", content: "# Title" },
            "index.ts": { filename: "index.ts", content: "export const x = 1;" },
          },
        }),
        { status: 200 },
      );
    }) as typeof fetch;

    const res = await listGithubGists({ token: "t", fetchImpl });
    expect(res.items[0]?.lang).toBe("markdown");
    expect(res.items[0]?.files).toEqual([
      { name: "README.md", lang: "markdown", content: "# Title" },
      { name: "index.ts", lang: "ts", content: "export const x = 1;" },
    ]);
    expect(res.items[0]?.note).toContain("```ts");
  });

  test("registry routes github to the adapter", async () => {
    const fetchImpl = (async () => new Response("[]", { status: 200 })) as unknown as typeof fetch;
    await expect(syncApp({ appId: "github", token: "t", fetchImpl })).resolves.toEqual({
      items: [],
      nextCursor: null,
    });
  });
});

describe("catalog", () => {
  test("has the launch set with honest auth kinds", () => {
    expect(getApp("browser")?.auth).toBe("file-import");
    expect(getApp("notion")?.auth).toBe("oauth2");
    expect(getApp("github")?.tokenAuth).toBe(true);
    expect(APP_CATALOG.length).toBeGreaterThanOrEqual(3);
  });

  test("live sync refuses import-only apps", async () => {
    await expect(syncApp({ appId: "browser", token: "x" })).rejects.toThrow("import flow");
  });
});
