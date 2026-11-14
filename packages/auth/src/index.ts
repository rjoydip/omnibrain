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

// ------------------------------------------------------------ passwords

// workerd rejects PBKDF2 above 100k iterations; this is also the CPU ceiling.
const PASSWORD_ITERATIONS = 100_000;
const PASSWORD_SALT_BYTES = 16;
const PASSWORD_KEY_BYTES = 32;

function toBase64(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function fromBase64(value: string): Uint8Array<ArrayBuffer> {
  const binary = atob(value);
  const bytes = new Uint8Array(new ArrayBuffer(binary.length));
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

async function derivePassword(
  password: string,
  salt: Uint8Array<ArrayBuffer>,
  iterations: number,
): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(password),
    "PBKDF2",
    false,
    ["deriveBits"],
  );
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", salt, iterations, hash: "SHA-256" },
    key,
    PASSWORD_KEY_BYTES * 8,
  );
  return new Uint8Array(bits);
}

/** PBKDF2-SHA256 with a random salt; the parameters travel with the hash. */
export async function hashPassword(password: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(PASSWORD_SALT_BYTES));
  const hash = await derivePassword(password, salt, PASSWORD_ITERATIONS);
  return `pbkdf2$sha256$${PASSWORD_ITERATIONS}$${toBase64(salt)}$${toBase64(hash)}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [scheme, digest, iterationsRaw, saltRaw, hashRaw] = stored.split("$");
  const iterations = Number(iterationsRaw);
  if (
    scheme !== "pbkdf2" ||
    digest !== "sha256" ||
    !saltRaw ||
    !hashRaw ||
    !Number.isInteger(iterations) ||
    iterations < 100_000 ||
    iterations > 1_000_000
  ) {
    return false;
  }
  const expected = fromBase64(hashRaw);
  const actual = await derivePassword(password, fromBase64(saltRaw), iterations);
  let diff = expected.length ^ actual.length;
  for (let i = 0; i < Math.max(expected.length, actual.length); i++) {
    diff |= (expected[i] ?? 0) ^ (actual[i] ?? 0);
  }
  return diff === 0;
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
