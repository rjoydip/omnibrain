import { describe, expect, test } from "bun:test";
import { isMarkdown, parseMarkdown } from "./markdown";

describe("markdown", () => {
  test("detects markdown without flagging plain prose", () => {
    expect(isMarkdown("# Heading\n\nbody")).toBe(true);
    expect(isMarkdown("- one\n- two")).toBe(true);
    expect(isMarkdown("some **bold** text")).toBe(true);
    expect(isMarkdown("[docs](https://example.com)")).toBe(true);
    expect(isMarkdown("just a plain sentence")).toBe(false);
    expect(isMarkdown("2 * 3 * 4")).toBe(false);
    expect(isMarkdown("snake_case_name")).toBe(false);
  });

  test("parses headings, lists, quotes and fenced code", () => {
    const blocks = parseMarkdown(
      ["## Title", "", "- one", "- two", "", "> quoted", "", "```ts", "const x = 1;", "```"].join(
        "\n",
      ),
    );
    expect(blocks.map((b) => b.type)).toEqual(["heading", "list", "quote", "code"]);
    const code = blocks[3];
    expect(code?.type === "code" && code.lang).toBe("ts");
    expect(code?.type === "code" && code.value).toBe("const x = 1;");
  });

  test("parses task lists and tables", () => {
    const blocks = parseMarkdown(
      ["- [ ] todo", "- [x] done", "", "| A | B |", "| --- | ---: |", "| 1 | 2 |"].join("\n"),
    );
    expect(blocks[0]?.type).toBe("tasks");
    const tasks = blocks[0];
    if (tasks?.type === "tasks") {
      expect(tasks.items.map((item) => item.checked)).toEqual([false, true]);
    }
    expect(blocks[1]?.type).toBe("table");
    const table = blocks[1];
    if (table?.type === "table") {
      expect(table.header).toHaveLength(2);
      expect(table.align).toEqual([null, "right"]);
      expect(table.rows).toHaveLength(1);
    }
    expect(isMarkdown("| A | B |\n| --- | --- |")).toBe(true);
  });

  test("parses inline styles and rejects unsafe links", () => {
    const blocks = parseMarkdown("a **bold** and `code` [safe](https://x.test)");
    const paragraph = blocks[0];
    expect(paragraph?.type).toBe("paragraph");
    if (paragraph?.type !== "paragraph") return;
    const types = paragraph.children.map((n) => n.type);
    expect(types).toContain("strong");
    expect(types).toContain("code");
    expect(types).toContain("link");

    const unsafe = parseMarkdown("[click](javascript:alert(1))")[0];
    expect(unsafe?.type === "paragraph" && unsafe.children.every((n) => n.type === "text")).toBe(
      true,
    );
  });
});
