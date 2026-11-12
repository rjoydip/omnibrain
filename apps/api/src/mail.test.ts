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
  test("returns false without the Cloudflare email binding", async () => {
    expect(await sendOtpEmail(env(), "a@example.com", "123456")).toBe(false);
  });

  test("sends the code with the Cloudflare email binding", async () => {
    const messages: Array<{
      from: string;
      to: string;
      subject: string;
      text: string;
      html: string;
    }> = [];
    const ok = await sendOtpEmail(
      env({
        EMAIL: {
          send: async (message) => {
            messages.push(message);
            return { messageId: "email_1" };
          },
        },
        EMAIL_FROM: "OmniBrain <login@example.com>",
      }),
      "person@example.com",
      "654321",
    );

    expect(ok).toBe(true);
    const message = messages[0];
    expect(message?.from).toBe("OmniBrain <login@example.com>");
    expect(message?.to).toBe("person@example.com");
    expect(message?.subject).toContain("654321");
    expect(message?.text).toContain("654321");
    expect(message?.html).toContain("654321");
  });

  test("reports binding failure", async () => {
    const ok = await sendOtpEmail(
      env({
        EMAIL: {
          send: async () => {
            throw new Error("provider down");
          },
        },
      }),
      "a@example.com",
      "111111",
    );
    expect(ok).toBe(false);
  });
});
