import type { Env } from "../env";

/** Sends the OTP through Cloudflare Email Service. Production never logs the code. */
export async function sendOtpEmail(env: Env, email: string, code: string): Promise<boolean> {
  if (!env.EMAIL) return false;

  const from = env.EMAIL_FROM?.trim() || "OmniBrain <no-reply@omnibrain.ai>";

  try {
    await env.EMAIL.send({
      from,
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
    });
    return true;
  } catch (error) {
    console.error("email send failed", String(error));
    return false;
  }
}
