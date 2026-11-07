import { describe, expect, test } from "bun:test";
import { chunkText, embedTexts, parseSummary, truncate } from "./index";

describe("chunkText", () => {
  test("short text is one chunk", () => {
    expect(chunkText("hello world")).toEqual(["hello world"]);
  });

  test("respects the character cap", () => {
    const text = Array.from({ length: 40 }, (_, i) => `Paragraph ${i} ${"x".repeat(120)}`).join(
      "\n\n",
    );
    const chunks = chunkText(text, { maxChars: 500, overlap: 50 });
    expect(chunks.length).toBeGreaterThan(1);
    for (const c of chunks) expect(c.length).toBeLessThanOrEqual(500);
    expect(chunks.join(" ")).toContain("Paragraph 39");
  });

  test("hard-splits a gigantic unbroken paragraph", () => {
    const chunks = chunkText("x".repeat(5000), { maxChars: 1000, overlap: 100 });
    expect(chunks.length).toBeGreaterThanOrEqual(5);
    for (const c of chunks) expect(c.length).toBeLessThanOrEqual(1000);
  });

  test("empty input yields no chunks", () => {
    expect(chunkText("   \n\n ")).toEqual([]);
  });
});

describe("parseSummary", () => {
  test("parses fenced json", () => {
    const s = parseSummary(
      '```json\n{"summary":"A page.","tags":["Cloudflare","AI","cloudflare"]}\n```',
    );
    expect(s.summary).toBe("A page.");
    expect(s.tags).toEqual(["cloudflare", "ai"]);
  });

  test("tolerates prose around json", () => {
    const s = parseSummary('Sure: {"summary":"Hi","tags":[]} hope that helps');
    expect(s.summary).toBe("Hi");
  });

  test("falls back to text when invalid", () => {
    const s = parseSummary("not json", "fallback body");
    expect(s.summary).toBe("fallback body");
    expect(s.tags).toEqual([]);
  });

  test("caps tags at six", () => {
    const s = parseSummary(
      JSON.stringify({ summary: "x", tags: ["a", "b", "c", "d", "e", "f", "g"] }),
    );
    expect(s.tags).toHaveLength(6);
  });
});

describe("embeddings", () => {
  test("rejects wrong dimensions", async () => {
    const fake = { run: async () => ({ data: [[0.1, 0.2]] }) };
    await expect(embedTexts(fake, ["hi"])).rejects.toThrow("dimensions");
  });

  test("batches and returns vectors", async () => {
    const fake = {
      run: async (_model: string, input: { text: string[] }) => ({
        data: input.text.map(() => Array.from({ length: 1024 }, () => 0.01)),
      }),
    };
    const out = await embedTexts(fake, ["a", "b"]);
    expect(out).toHaveLength(2);
    expect(out[0]).toHaveLength(1024);
  });
});

test("truncate adds an ellipsis", () => {
  expect(truncate("abcdef", 4)).toBe("abc…");
});
