import { describe, expect, test } from "bun:test";
import { parseBookmarksHtml } from "./browser";
import { parseKeepTakeout } from "./keep";
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

describe("keep takeout parser", () => {
  test("maps text, list, labels and timestamps", () => {
    const notes = parseKeepTakeout(
      JSON.stringify([
        {
          title: "Shopping",
          textContent: "milk",
          listContent: [{ text: "eggs", isChecked: false }],
          labels: [{ name: "Home" }],
          createdTimestampUsec: 1_700_000_000_000_000,
        },
        { title: "Trashed", isTrashed: true },
        { title: "", textContent: "Untitled body" },
      ]),
    );
    expect(notes).toHaveLength(2);
    expect(notes[0]?.title).toBe("Shopping");
    expect(notes[0]?.note).toContain("[ ] eggs");
    expect(notes[0]?.tags).toEqual(["Home"]);
    expect(notes[0]?.capturedAt).toBe(1_700_000_000_000);
    expect(notes[1]?.title).toBe("Untitled body");
  });

  test("invalid json returns empty", () => {
    expect(parseKeepTakeout("{oops")).toEqual([]);
  });
});

describe("catalog", () => {
  test("has the launch set with honest auth kinds", () => {
    expect(getApp("browser")?.auth).toBe("file-import");
    expect(getApp("notion")?.auth).toBe("oauth2");
    expect(getApp("keep")?.status).toBe("import-only");
    expect(APP_CATALOG.length).toBeGreaterThanOrEqual(5);
  });

  test("live sync refuses import-only apps", async () => {
    await expect(syncApp({ appId: "browser", token: "x" })).rejects.toThrow("import flow");
  });
});
