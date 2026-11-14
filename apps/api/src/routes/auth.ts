import {
  canRequestOtp,
  hashPassword,
  issueSession,
  requestOtp,
  resolveSession,
  SESSION_COOKIE,
  SESSION_TTL_MS,
  verifyOtp,
  verifyPassword,
} from "@omnibrain/auth";
import {
  AppError,
  LoginSchema,
  RequestOtpSchema,
  SignupSchema,
  VerifyOtpSchema,
} from "@omnibrain/core";
import {
  bootstrapUser,
  consumeOtp,
  createUserWithPassword,
  findUserByEmail,
  forWorkspace,
  listWorkspaces,
} from "@omnibrain/db";
import { Hono } from "hono";
import { getCookie } from "hono/cookie";
import { type AppEnv, dbOf, isDev, otpEnabled } from "../env";
import { clientIp, issueCookie, logout, originGuard, rateLimit } from "../http";
import { sendOtpEmail } from "../services/mail";
import { body } from "../validate";

export const authRoutes = new Hono<AppEnv>();

authRoutes.use("*", originGuard);

/** Public auth capabilities for the sign-in screen. */
authRoutes.get("/config", (c) =>
  c.json({ password_enabled: true, otp_enabled: otpEnabled(c.env) }),
);

authRoutes.post("/signup", body(SignupSchema), async (c) => {
  const ip = clientIp(c);
  if (!rateLimit(`signup:${ip}`, 10, 10 * 60_000)) {
    throw new AppError("rate_limited", "Too many sign-up attempts. Try again later.", 429);
  }

  const { email, password } = c.req.valid("json");
  const db = dbOf(c.env);
  const user = await createUserWithPassword(db, email, await hashPassword(password));
  if (!user) {
    throw new AppError(
      "email_taken",
      "An account with this email already exists. Sign in instead.",
      409,
    );
  }

  const bootstrapped = await bootstrapUser(db, email);
  const session = await issueSession(db, user.id);
  issueCookie(c, session.token, Math.floor(SESSION_TTL_MS / 1000));
  await forWorkspace(db, bootstrapped.workspace.id).audit(user.id, "auth.signup", null, { ip });
  return c.json({
    user: { id: user.id, email: user.email, name: user.name },
    workspace: bootstrapped.workspace,
    expires_at: session.expiresAt,
  });
});

authRoutes.post("/login", body(LoginSchema), async (c) => {
  const ip = clientIp(c);
  if (!rateLimit(`login:${ip}`, 20, 10 * 60_000)) {
    throw new AppError("rate_limited", "Too many sign-in attempts. Try again later.", 429);
  }

  const { email, password } = c.req.valid("json");
  const db = dbOf(c.env);
  const user = await findUserByEmail(db, email);
  if (!user?.password_hash || !(await verifyPassword(password, user.password_hash))) {
    throw new AppError("unauthorized", "Email or password is incorrect.", 401);
  }

  const { workspace } = await bootstrapUser(db, email);
  const session = await issueSession(db, user.id);
  issueCookie(c, session.token, Math.floor(SESSION_TTL_MS / 1000));
  await forWorkspace(db, workspace.id).audit(user.id, "auth.login", null, { ip });
  return c.json({
    user: { id: user.id, email: user.email, name: user.name },
    workspace,
    expires_at: session.expiresAt,
  });
});

authRoutes.post("/request-otp", body(RequestOtpSchema), async (c) => {
  if (!otpEnabled(c.env)) {
    throw new AppError("otp_disabled", "Email code sign-in is not enabled.", 403);
  }
  const { email } = c.req.valid("json");
  const ip = clientIp(c);
  const dev = isDev(c.env);
  const db = dbOf(c.env);
  const otpLimit = dev ? 50 : 10;
  if (!rateLimit(`otp:ip:${ip}`, otpLimit, 10 * 60_000)) {
    throw new AppError("rate_limited", "Too many code requests. Try again later.", 429);
  }
  if (!rateLimit(`otp:email:${email}`, dev ? 50 : 5, 10 * 60_000)) {
    throw new AppError("rate_limited", "Too many code requests for this email.", 429);
  }

  if (!dev && !c.env.EMAIL) {
    throw new AppError(
      "email_not_configured",
      "Email delivery is not configured on this deployment",
      503,
    );
  }

  // Durable cooldown: one email per address per minute, across isolates.
  if (!dev && !(await canRequestOtp(db, email))) {
    throw new AppError("rate_limited", "Please wait a minute before requesting another code.", 429);
  }

  const { code, expiresAt } = await requestOtp(db, email, c.env.AUTH_SECRET);

  if (dev) {
    console.log(`[omnibrain:dev] OTP ${code} for ${email}`);
    return c.json({
      sent: true,
      delivered: false,
      email_configured: false,
      expires_at: expiresAt,
      dev_code: code,
    });
  }

  const delivered = await sendOtpEmail(c.env, email, code);
  if (!delivered) {
    // Nothing was sent, so drop the code and let the user retry past the cooldown.
    await consumeOtp(db, email);
    throw new AppError("email_failed", "Could not send the code. Try again in a moment.", 502);
  }
  return c.json({
    sent: true,
    delivered: true,
    email_configured: true,
    expires_at: expiresAt,
  });
});

authRoutes.post("/verify", body(VerifyOtpSchema), async (c) => {
  if (!otpEnabled(c.env)) {
    throw new AppError("otp_disabled", "Email code sign-in is not enabled.", 403);
  }
  const { email, code } = c.req.valid("json");
  const ip = clientIp(c);
  if (!rateLimit(`verify:${ip}`, 20, 10 * 60_000)) {
    throw new AppError("rate_limited", "Too many attempts. Try again later.", 429);
  }

  const result = await verifyOtp(dbOf(c.env), email, code, c.env.AUTH_SECRET);
  if (!result.ok) {
    const message =
      result.reason === "expired"
        ? "Code expired. Request a new one."
        : result.reason === "too_many_attempts"
          ? "Too many attempts. Request a new code."
          : "That code is not valid.";
    throw new AppError("unauthorized", message, 401, { reason: result.reason });
  }

  const db = dbOf(c.env);
  const { user, workspace } = await bootstrapUser(db, email);
  const session = await issueSession(db, user.id);
  issueCookie(c, session.token, Math.floor(SESSION_TTL_MS / 1000));
  await forWorkspace(db, workspace.id).audit(user.id, "auth.login", null, {
    ip: clientIp(c),
  });
  return c.json({
    user: { id: user.id, email: user.email, name: user.name },
    workspace,
    expires_at: session.expiresAt,
  });
});

authRoutes.get("/me", async (c) => {
  const db = dbOf(c.env);
  const token = getCookie(c, SESSION_COOKIE);
  const session = await resolveSession(db, token);
  if (!session) throw new AppError("unauthorized", "Sign in required", 401);
  const { user, workspace } = await bootstrapUser(db, session.email);
  const workspaces = await listWorkspaces(db, user.id);
  return c.json({
    user: { id: user.id, email: user.email, name: user.name },
    workspace,
    workspaces,
  });
});

authRoutes.post("/logout", async (c) => {
  await logout(c);
  return c.json({ ok: true });
});
