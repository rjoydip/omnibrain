import { describe, expect, test } from "bun:test";
import type { Env } from "./env";
import { sendOtpEmail } from "./services/mail";

function env(overrides: Partial<Env> = {}): Env {
  return {
    DB: {} as Env["DB"],
    AUTH_SECRET: "test",
    ...overrides,
  };
}

describe("email delivery", () => {
  test("returns false without a Resend key", async () => {
    expect(await sendOtpEmail(env(), "a@example.com", "123456")).toBe(false);
  });

  test("posts the code to Resend and reports success", async () => {
    const original = globalThis.fetch;
    const calls: Array<{ url: string; body: string; auth: string }> = [];
    globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
      calls.push({
        url: String(url),
        body: String(init?.body ?? ""),
        auth: String((init?.headers as Record<string, string>)?.authorization ?? ""),
      });
      return new Response(JSON.stringify({ id: "email_1" }), { status: 200 });
    }) as unknown as typeof fetch;

    try {
      const ok = await sendOtpEmail(
        env({ RESEND_KEY: "re_test", RESEND_FROM: "OmniBrain <login@example.com>" }),
        "person@example.com",
        "654321",
      );
      expect(ok).toBe(true);
      const call = calls[0];
      expect(call?.url).toContain("api.resend.com/emails");
      expect(call?.auth).toBe("Bearer re_test");
      expect(call?.body).toContain("654321");
      expect(call?.body).toContain("login@example.com");
      expect(call?.body).toContain("person@example.com");
    } finally {
      globalThis.fetch = original;
    }
  });

  test("reports provider failure", async () => {
    const original = globalThis.fetch;
    globalThis.fetch = (async () =>
      new Response("nope", { status: 500 })) as unknown as typeof fetch;
    try {
      expect(await sendOtpEmail(env({ RESEND_KEY: "re_test" }), "a@example.com", "111111")).toBe(
        false,
      );
    } finally {
      globalThis.fetch = original;
    }
  });
});
