import { describe, expect, test } from "bun:test";
import { boostAndDiversify, buildFtsQuery, canonicalizeUrl, detectIntent, rrfFuse } from "./rank";

describe("canonicalizeUrl", () => {
  test("strips tracking, www, trailing slash, sorts params", () => {
    expect(canonicalizeUrl("https://WWW.Example.com/a/b/?utm_source=x&b=2&a=1&fbclid=z#frag")).toBe(
      "https://example.com/a/b?a=1&b=2",
    );
  });

  test("keeps meaningful hashbang", () => {
    expect(canonicalizeUrl("https://example.com/docs#!/api")).toContain("#!/api");
  });

  test("preserves non-default ports", () => {
    expect(canonicalizeUrl("http://localhost:8787/api/")).toBe("http://localhost:8787/api");
  });

  test("rejects non-http schemes and junk", () => {
    expect(canonicalizeUrl("notion://page/abc")).toBeNull();
    expect(canonicalizeUrl("javascript:alert(1)")).toBeNull();
    expect(canonicalizeUrl("not a url")).toBeNull();
  });

  test("root path is stable", () => {
    expect(canonicalizeUrl("https://example.com/")).toBe("https://example.com/");
  });
});

describe("intent", () => {
  test("classifies", () => {
    expect(detectIntent("https://bun.sh")).toBe("url");
    expect(detectIntent("bun.sh/docs")).toBe("url");
    expect(detectIntent("/theme")).toBe("command");
    expect(detectIntent("how do I deploy a worker?")).toBe("question");
    expect(detectIntent("cloudflare d1")).toBe("keyword");
    expect(detectIntent("3.14")).toBe("keyword");
  });
});

describe("fts", () => {
  test("builds prefix OR query and dedupes", () => {
    expect(buildFtsQuery("Cloudflare D1 d1!")).toBe('"cloudflare"* OR "d1"*');
  });
  test("empty for punctuation", () => {
    expect(buildFtsQuery("!!!")).toBe("");
  });
});

describe("rrf", () => {
  test("rewards agreement across lists", () => {
    const fused = rrfFuse([
      ["a", "b", "c"],
      ["a", "b"],
    ]);
    expect(fused[0]?.id).toBe("a");
    expect(fused[1]?.id).toBe("b");
    expect(fused).toHaveLength(3);
  });

  test("single list preserves order", () => {
    expect(rrfFuse([["x", "y"]]).map((r) => r.id)).toEqual(["x", "y"]);
  });
});

describe("diversity", () => {
  const now = Date.UTC(2026, 10, 6);

  test("caps one source then backfills", () => {
    const cands = [
      { id: "1", source: "x", capturedAt: now, score: 0.9 },
      { id: "2", source: "x", capturedAt: now, score: 0.8 },
      { id: "3", source: "x", capturedAt: now, score: 0.7 },
      { id: "4", source: "x", capturedAt: now, score: 0.6 },
      { id: "5", source: "notion", capturedAt: now, score: 0.1 },
    ];
    const out = boostAndDiversify(cands, { now, maxPerSource: 2, limit: 4 });
    expect(out.slice(0, 2).map((c) => c.source)).toEqual(["x", "x"]);
    expect(out).toHaveLength(4);
    expect(out.map((c) => c.id)).toContain("5");
  });

  test("recent items outrank older near-ties", () => {
    const fresh = { id: "fresh", source: "web", capturedAt: now, score: 1 };
    const old = { id: "old", source: "web", capturedAt: now - 800 * 86_400_000, score: 1 };
    const out = boostAndDiversify([old, fresh], { now, maxPerSource: 5, limit: 2 });
    expect(out[0]?.id).toBe("fresh");
  });
});
