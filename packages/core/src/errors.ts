export type ErrorCode =
  | "bad_request"
  | "unauthorized"
  | "forbidden"
  | "not_found"
  | "conflict"
  | "rate_limited"
  | "quota_exceeded"
  | "connector_not_configured"
  | "email_not_configured"
  | "email_failed"
  | "email_taken"
  | "otp_disabled"
  | "internal";

export class AppError extends Error {
  constructor(
    readonly code: ErrorCode,
    message: string,
    readonly status = 400,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = "AppError";
  }
}

export const badRequest = (message: string, details?: unknown) =>
  new AppError("bad_request", message, 400, details);
export const unauthorized = (message = "Sign in required") =>
  new AppError("unauthorized", message, 401);
export const forbidden = (message = "Not allowed") => new AppError("forbidden", message, 403);
export const notFound = (message = "Not found") => new AppError("not_found", message, 404);
export const conflict = (message: string) => new AppError("conflict", message, 409);
export const quotaExceeded = (message: string) => new AppError("quota_exceeded", message, 402);
