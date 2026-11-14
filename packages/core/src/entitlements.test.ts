import { describe, expect, test } from "bun:test";
import {
  canSyncInterval,
  checkEntitlement,
  EMPTY_USAGE,
  entitlementSummary,
  syncIntervalsFor,
} from "./entitlements";

describe("entitlements", () => {
  test("sync cadences follow the plan", () => {
    expect(syncIntervalsFor("free")).toEqual([21600, 43200]);
    expect(syncIntervalsFor("pro")).toEqual([360, 1440]);
    expect(syncIntervalsFor("team")).toEqual([0, 15, 30, 60]);
    expect(canSyncInterval("free", 15)).toBe(false);
    expect(canSyncInterval("pro", 360)).toBe(true);
    expect(canSyncInterval("team", 0)).toBe(true);
  });
  test("free plan allows items under the cap", () => {
    const e = checkEntitlement("free", { ...EMPTY_USAGE, items: 499 }, "item");
    expect(e.allowed).toBe(true);
    expect(e.remaining).toBe(1);
  });

  test("free plan blocks the item over the cap", () => {
    const e = checkEntitlement("free", { ...EMPTY_USAGE, items: 500 }, "item");
    expect(e.allowed).toBe(false);
    expect(e.reason).toContain("Free");
  });

  test("read-only summary is allowed over quota", () => {
    const s = entitlementSummary("free", { ...EMPTY_USAGE, items: 10_000 });
    expect(s.items.allowed).toBe(true);
    expect(s.items.remaining).toBe(0);
  });

  test("team has unlimited connections", () => {
    const e = checkEntitlement("team", { ...EMPTY_USAGE, connections: 999 }, "connection");
    expect(e.allowed).toBe(true);
    expect(e.remaining).toBe(Number.POSITIVE_INFINITY);
  });

  test("pro raises the item cap", () => {
    const e = checkEntitlement("pro", { ...EMPTY_USAGE, items: 1_000 }, "item");
    expect(e.allowed).toBe(true);
  });

  test("free plan caps API keys at 10", () => {
    expect(checkEntitlement("free", { ...EMPTY_USAGE, apiKeys: 9 }, "apiKey").allowed).toBe(true);
    const blocked = checkEntitlement("free", { ...EMPTY_USAGE, apiKeys: 10 }, "apiKey");
    expect(blocked.allowed).toBe(false);
    expect(blocked.limit).toBe(10);
    expect(blocked.reason).toContain("Free");
  });
});
