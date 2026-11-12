import { describe, expect, test } from "bun:test";
import { bootstrapUser } from "@omnibrain/db";
import { memoryClient } from "@omnibrain/db/sqlite";
import {
  canRequestOtp,
  destroySession,
  issueSession,
  MAX_OTP_ATTEMPTS,
  OTP_RESEND_MS,
  OTP_TTL_MS,
  requestOtp,
  resolveSession,
  SESSION_TTL_MS,
  verifyOtp,
} from "./index";

const SECRET = "test-secret";

async function setup() {
  const db = memoryClient();
  const { user } = await bootstrapUser(db, "person@example.com");
  return { db, user };
}

describe("otp", () => {
  test("accepts the issued code once", async () => {
    const { db } = await setup();
    const { code, expiresAt } = await requestOtp(db, "person@example.com", SECRET);
    expect(code).toMatch(/^\d{6}$/);
    expect(expiresAt).toBeGreaterThan(Date.now());
    expect((await verifyOtp(db, "person@example.com", code, SECRET)).ok).toBe(true);
    expect((await verifyOtp(db, "person@example.com", code, SECRET)).ok).toBe(false);
  });

  test("rejects expired codes", async () => {
    const { db } = await setup();
    const now = Date.now();
    const { code } = await requestOtp(db, "person@example.com", SECRET, now);
    const res = await verifyOtp(db, "person@example.com", code, SECRET, now + OTP_TTL_MS + 1);
    expect(res).toEqual({ ok: false, reason: "expired" });
  });

  test("locks after too many wrong attempts", async () => {
    const { db } = await setup();
    await requestOtp(db, "person@example.com", SECRET);
    for (let i = 0; i < MAX_OTP_ATTEMPTS; i++) {
      const res = await verifyOtp(db, "person@example.com", "000000", SECRET);
      expect(res.ok).toBe(false);
    }
    const res = await verifyOtp(db, "person@example.com", "000000", SECRET);
    expect(res).toEqual({ ok: false, reason: "too_many_attempts" });
  });

  test("a new request resets attempts", async () => {
    const { db } = await setup();
    await requestOtp(db, "person@example.com", SECRET);
    await verifyOtp(db, "person@example.com", "000000", SECRET);
    const { code } = await requestOtp(db, "person@example.com", SECRET);
    expect((await verifyOtp(db, "person@example.com", code, SECRET)).ok).toBe(true);
  });

  test("enforces a resend cooldown per address", async () => {
    const { db } = await setup();
    const now = 1_700_000_000_000;
    expect(await canRequestOtp(db, "person@example.com", now)).toBe(true);
    await requestOtp(db, "person@example.com", SECRET, now);
    expect(await canRequestOtp(db, "person@example.com", now + OTP_RESEND_MS - 1)).toBe(false);
    expect(await canRequestOtp(db, "person@example.com", now + OTP_RESEND_MS)).toBe(true);
    expect(await canRequestOtp(db, "other@example.com", now)).toBe(true);
  });
});

describe("sessions", () => {
  test("round trip and expiry", async () => {
    const { db, user } = await setup();
    const { token, expiresAt } = await issueSession(db, user.id);
    expect(expiresAt).toBeGreaterThan(Date.now() + SESSION_TTL_MS - 5000);
    expect((await resolveSession(db, token))?.user_id).toBe(user.id);
    expect(await resolveSession(db, undefined)).toBeNull();
    expect(await resolveSession(db, "nope")).toBeNull();
    expect(await resolveSession(db, token, Date.now() + SESSION_TTL_MS + 1)).toBeNull();
  });

  test("destroy invalidates", async () => {
    const { db, user } = await setup();
    const { token } = await issueSession(db, user.id);
    await destroySession(db, token);
    expect(await resolveSession(db, token)).toBeNull();
  });
});
