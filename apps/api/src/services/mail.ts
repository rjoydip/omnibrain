import type { Env } from "../env";

/** Sends the OTP through Resend. Production never logs the code. */
export async function sendOtpEmail(env: Env, email: string, code: string): Promise<boolean> {
  if (!env.RESEND_KEY) return false;

  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        authorization: `Bearer ${env.RESEND_KEY}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        from: env.RESEND_FROM ?? "OmniBrain <onboarding@resend.dev>",
        to: email,
        subject: `Your OmniBrain code: ${code}`,
        text: `Sign in to OmniBrain with ${code}. It expires in 10 minutes.`,
        html: `<div style="font-family:ui-sans-serif,system-ui,sans-serif;background:#f4f4f2;padding:32px">
          <div style="max-width:420px;margin:0 auto;background:#fff;padding:24px">
            <p style="margin:0 0 8px;font-size:13px;color:#666">OmniBrain</p>
            <h1 style="margin:0 0 16px;font-size:20px;color:#16181d">Your sign-in code</h1>
            <p style="margin:0 0 20px;font-family:ui-monospace,monospace;font-size:30px;letter-spacing:6px;color:#16181d">${code}</p>
            <p style="margin:0;font-size:12px;color:#666">The code expires in 10 minutes. If you did not request it, ignore this email.</p>
          </div>
        </div>`,
      }),
    });
    if (!res.ok) console.error("resend failed", res.status, await res.text());
    return res.ok;
  } catch (error) {
    console.error("resend error", String(error));
    return false;
  }
}
