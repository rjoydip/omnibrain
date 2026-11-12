import { randomDigits, randomToken, sha256Hex } from "@omnibrain/core";
import {
  bumpOtpAttempts,
  consumeOtp,
  createOtp,
  createSession,
  deleteSession,
  getOtp,
  getSession,
  type SessionUser,
  type SqlClient,
} from "@omnibrain/db";

export const SESSION_COOKIE = "ob_session";
export const OTP_TTL_MS = 10 * 60 * 1000;
/** Minimum gap between two emails for the same address. */
export const OTP_RESEND_MS = 60 * 1000;
export const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;
export const MAX_OTP_ATTEMPTS = 5;

export function hashOtp(secret: string, email: string, code: string): Promise<string> {
  return sha256Hex(`${secret}:${email.trim().toLowerCase()}:${code}`);
}

export interface RequestedOtp {
  code: string;
  expiresAt: number;
}

/**
 * Durable per-email cooldown. The stored expiry minus the TTL is when the last
 * code was issued, so this works across Worker isolates without another column.
 */
export async function canRequestOtp(
  db: SqlClient,
  email: string,
  now = Date.now(),
): Promise<boolean> {
  const row = await getOtp(db, email);
  if (!row) return true;
  return now - (row.expires_at - OTP_TTL_MS) >= OTP_RESEND_MS;
}

/** Stores a hashed 6-digit code. The plaintext is returned only so dev mode can echo it. */
export async function requestOtp(
  db: SqlClient,
  email: string,
  secret: string,
  now = Date.now(),
): Promise<RequestedOtp> {
  const code = randomDigits();
  const expiresAt = now + OTP_TTL_MS;
  await createOtp(db, email, await hashOtp(secret, email, code), expiresAt);
  return { code, expiresAt };
}

export type VerifyResult =
  { ok: true } | { ok: false; reason: "missing" | "expired" | "too_many_attempts" | "mismatch" };

export async function verifyOtp(
  db: SqlClient,
  email: string,
  code: string,
  secret: string,
  now = Date.now(),
): Promise<VerifyResult> {
  const row = await getOtp(db, email);
  if (!row) return { ok: false, reason: "missing" };
  if (row.expires_at < now) {
    await consumeOtp(db, email);
    return { ok: false, reason: "expired" };
  }
  if (row.attempts >= MAX_OTP_ATTEMPTS) return { ok: false, reason: "too_many_attempts" };
  const expected = await hashOtp(secret, email, code);
  if (expected !== row.code_hash) {
    const attempts = await bumpOtpAttempts(db, email);
    return { ok: false, reason: attempts >= MAX_OTP_ATTEMPTS ? "too_many_attempts" : "mismatch" };
  }
  await consumeOtp(db, email);
  return { ok: true };
}

export interface IssuedSession {
  token: string;
  expiresAt: number;
}

export async function issueSession(
  db: SqlClient,
  userId: string,
  now = Date.now(),
): Promise<IssuedSession> {
  const token = randomToken(32);
  const expiresAt = now + SESSION_TTL_MS;
  await createSession(db, userId, await sha256Hex(token), expiresAt);
  return { token, expiresAt };
}

export async function resolveSession(
  db: SqlClient,
  token: string | undefined,
  now = Date.now(),
): Promise<SessionUser | null> {
  if (!token) return null;
  const session = await getSession(db, await sha256Hex(token));
  if (!session) return null;
  if (session.expires_at < now) {
    await deleteSession(db, await sha256Hex(token));
    return null;
  }
  return session;
}

export async function destroySession(db: SqlClient, token: string | undefined): Promise<void> {
  if (!token) return;
  await deleteSession(db, await sha256Hex(token));
}
