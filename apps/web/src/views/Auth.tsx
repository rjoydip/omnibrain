import { Spinner } from "@omnibrain/ui";
import type { FormEvent } from "react";
import { useState } from "react";
import { AtlasIcon, LockIcon, SparkIcon } from "../components/icons";
import { ApiError, api, type Me } from "../lib/api";

export function AuthScreen({ onAuthed }: { onAuthed: (me: Me) => void }) {
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [step, setStep] = useState<"email" | "code">("email");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [devCode, setDevCode] = useState<string | null>(null);
  const [delivered, setDelivered] = useState(false);

  async function requestCode(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await api.requestOtp(email.trim());
      setStep("code");
      setDevCode(res.dev_code ?? null);
      setDelivered(res.delivered);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not send a code");
    } finally {
      setBusy(false);
    }
  }

  async function verify(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await api.verifyOtp(email.trim(), code.trim());
      onAuthed({ user: res.user, workspace: res.workspace, workspaces: [res.workspace] });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not verify that code");
      setBusy(false);
    }
  }

  return (
    <div className="relative z-10 grid min-h-full lg:grid-cols-[1.05fr_1fr]">
      <section className="relative hidden flex-col justify-between overflow-hidden border-r border-line p-10 lg:flex">
        <div className="flex items-center gap-3">
          <div className="grid size-9 place-items-center rounded-[var(--radius)] border border-line bg-panel">
            <AtlasIcon size={18} className="text-signal" />
          </div>
          <div className="text-sm font-semibold tracking-tight">OmniBrain</div>
          <span className="font-mono text-[10px] uppercase tracking-widest text-faint">v0.1</span>
        </div>

        <div className="max-w-lg">
          <p className="mb-4 font-mono text-[11px] uppercase tracking-[0.18em] text-signal">
            Recall layer · multi-source
          </p>
          <h1 className="text-4xl font-semibold leading-[1.02] tracking-[-0.03em] text-text">
            Recall,
            <br />
            not storage.
          </h1>
          <p className="mt-5 max-w-md text-[15px] leading-relaxed text-muted">
            Bookmarks, Notion pages and GitHub gists in one place. Search by the shape of the
            memory, not the folder you filed it in.
          </p>
          <ul className="mt-8 space-y-3 text-[13px] text-muted">
            {[
              "Hybrid lexical + semantic search, with citations",
              "Real connector lifecycle: scopes, sync health, disconnect",
              "Remote MCP so your agents can search your own corpus",
            ].map((line) => (
              <li key={line} className="flex items-start gap-2.5">
                <SparkIcon size={14} className="mt-0.5 shrink-0 text-signal" />
                {line}
              </li>
            ))}
          </ul>
        </div>

        <div className="flex items-center gap-2 font-mono text-[11px] text-faint">
          <LockIcon size={13} />
          Email codes only. Sessions live in an HttpOnly cookie.
        </div>

        <div className="pointer-events-none absolute -right-24 top-1/2 -translate-y-1/2 opacity-40">
          <div className="size-[440px] rounded-full border border-line" />
          <div className="absolute inset-16 rounded-full border border-line" />
          <div className="absolute inset-32 rounded-full border border-line" />
          <div className="absolute inset-[46%] rounded-full bg-signal/70 blur-[2px]" />
        </div>
      </section>

      <section className="flex items-center justify-center p-6">
        <div className="w-full max-w-sm">
          <div className="mb-8 flex items-center gap-3 lg:hidden">
            <div className="grid size-9 place-items-center rounded-[var(--radius)] border border-line bg-panel">
              <AtlasIcon size={18} className="text-signal" />
            </div>
            <span className="text-sm font-semibold">OmniBrain</span>
          </div>

          <div className="panel p-5">
            <h2 className="text-lg font-semibold tracking-tight">
              {step === "email" ? "Sign in" : "Check your email"}
            </h2>
            <p className="mt-1 text-xs leading-relaxed text-muted">
              {step === "email"
                ? "No password. We send a six-digit code."
                : delivered
                  ? `Code sent to ${email}. It expires in 10 minutes.`
                  : `Use the code for ${email}. It expires in 10 minutes.`}
            </p>

            {step === "email" ? (
              <form onSubmit={requestCode} className="mt-5 space-y-3">
                <label className="block text-[11px] font-medium uppercase tracking-wider text-faint">
                  Email
                  <input
                    type="email"
                    required
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="you@example.com"
                    className="field mt-1.5"
                  />
                </label>
                {error ? <p className="text-xs text-coral">{error}</p> : null}
                <button
                  type="submit"
                  disabled={busy || !email.includes("@")}
                  className="w-full rounded-[var(--radius)] border border-transparent bg-signal px-3.5 py-2.5 text-[13px] font-semibold text-signal-ink transition hover:brightness-105 disabled:opacity-50"
                >
                  {busy ? "Sending…" : "Send code"}
                </button>
              </form>
            ) : (
              <form onSubmit={verify} className="mt-5 space-y-3">
                <label className="block text-[11px] font-medium uppercase tracking-wider text-faint">
                  Six-digit code
                  <input
                    inputMode="numeric"
                    autoComplete="one-time-code"
                    pattern="\d{6}"
                    maxLength={6}
                    required
                    value={code}
                    onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
                    placeholder="000000"
                    className="field mt-1.5 text-center font-mono text-xl tracking-[0.5em]"
                  />
                </label>

                {devCode ? (
                  <button
                    type="button"
                    onClick={() => setCode(devCode)}
                    className="flex w-full items-center justify-between rounded-[var(--radius)] border border-signal/30 bg-signal/5 px-3 py-2 text-left text-[11px] text-muted transition hover:border-signal/60"
                  >
                    <span>
                      Dev mode code <span className="ml-1 font-mono text-signal">{devCode}</span>
                    </span>
                    <span className="font-mono text-[10px] uppercase tracking-wider text-faint">
                      fill
                    </span>
                  </button>
                ) : null}

                {error ? <p className="text-xs text-coral">{error}</p> : null}

                <button
                  type="submit"
                  disabled={busy || code.length !== 6}
                  className="flex w-full items-center justify-center gap-2 rounded-[var(--radius)] border border-transparent bg-signal px-3.5 py-2.5 text-[13px] font-semibold text-signal-ink transition hover:brightness-105 disabled:opacity-50"
                >
                  {busy ? (
                    <Spinner className="size-3.5 border-signal-ink/40 border-t-signal-ink" />
                  ) : null}
                  {busy ? "Verifying…" : "Open my workspace"}
                </button>

                <button
                  type="button"
                  onClick={() => {
                    setStep("email");
                    setCode("");
                    setError(null);
                  }}
                  className="w-full text-center text-[11px] text-faint underline-offset-2 hover:text-muted hover:underline"
                >
                  Use a different email
                </button>
              </form>
            )}
          </div>

          <p className="mt-4 text-center text-[11px] leading-relaxed text-faint">
            By continuing you agree to keep your own data portable. Export or delete it any time.
          </p>
        </div>
      </section>
    </div>
  );
}
