import { describe, expect, test } from "bun:test";
import { cleanGeneratedTags } from "./tags";

describe("cleanGeneratedTags", () => {
  test("drops type and source words, lowercases and dedupes", () => {
    expect(cleanGeneratedTags(["Bookmark", "notion", "Rust", "rust", "github", "file"])).toEqual([
      "rust",
    ]);
  });

  test("keeps at most six topical tags", () => {
    expect(cleanGeneratedTags(Array.from({ length: 10 }, (_, i) => `topic-${i}`))).toHaveLength(6);
  });
});
