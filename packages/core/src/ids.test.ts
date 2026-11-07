import { describe, expect, test } from "bun:test";
import { AppError, forbidden, notFound, quotaExceeded } from "./errors";
import { newId, randomDigits, randomToken, sha256Hex } from "./ids";

describe("ids", () => {
  test("prefixed uuid", () => {
    expect(newId("itm")).toMatch(/^itm_[0-9a-f-]{36}$/);
  });

  test("random tokens are unique and url-safe", () => {
    const a = randomToken();
    const b = randomToken();
    expect(a).not.toBe(b);
    expect(a).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  test("digits are always 6 chars", () => {
    for (let i = 0; i < 50; i++) expect(randomDigits()).toMatch(/^\d{6}$/);
  });

  test("sha256 is stable", async () => {
    expect(await sha256Hex("abc")).toBe(
      "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
    );
  });
});

describe("errors", () => {
  test("carry status and code", () => {
    const e = quotaExceeded("over");
    expect(e).toBeInstanceOf(AppError);
    expect(e.status).toBe(402);
    expect(forbidden().status).toBe(403);
    expect(notFound().status).toBe(404);
  });
});
