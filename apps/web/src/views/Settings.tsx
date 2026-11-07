import { Badge, Button, Input, Tooltip } from "@omnibrain/ui";
import { useState } from "react";
import { ArrowUpRightIcon, CheckIcon, LockIcon, StreamIcon, TrashIcon } from "../components/icons";
import { type Account, ApiError, api, exportData } from "../lib/api";
import { ACCENT_SWATCHES, formatCount } from "../lib/format";
import { ACCENTS, type Accent, THEMES, type Theme } from "../lib/nav";

/** Display copy for the plan cards; enforcement lives in @omnibrain/core. */
const PLAN_CARDS = [
  { id: "free", name: "Free", price: 0, apiKeys: 10, items: 500, enrichments: 200, connections: 1 },
  {
    id: "pro",
    name: "Pro",
    price: 9,
    apiKeys: 50,
    items: 25_000,
    enrichments: 5_000,
    connections: 5,
  },
  {
    id: "team",
    name: "Team",
    price: 19,
    apiKeys: Number.POSITIVE_INFINITY,
    items: 100_000,
    enrichments: 20_000,
    connections: Number.POSITIVE_INFINITY,
  },
] as const;

type PlanId = (typeof PLAN_CARDS)[number]["id"];

function Limit({ label, used, limit }: { label: string; used: number; limit: number }) {
  const percent =
    limit === Number.POSITIVE_INFINITY || limit === 0
      ? 0
      : Math.min(100, Math.round((used / limit) * 100));
  return (
    <div>
      <div className="flex items-center justify-between font-mono text-[10px] text-faint">
        <span className="uppercase tracking-wider">{label}</span>
        <span>{formatCount(used, limit)}</span>
      </div>
      <div className="meter mt-1">
        <span style={{ width: `${percent}%` }} />
      </div>
    </div>
  );
}

export function SettingsView({
  account,
  theme,
  onTheme,
  accent,
  onAccent,
  onSignedOut,
  onPlanChanged,
  toast,
}: {
  account: Account | null;
  theme: Theme;
  onTheme: (theme: Theme) => void;
  accent: Accent;
  onAccent: (accent: Accent) => void;
  onSignedOut: () => void;
  onPlanChanged: () => void;
  toast: (message: string, tone?: "ok" | "error") => void;
}) {
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [planBusy, setPlanBusy] = useState<PlanId | null>(null);

  async function changePlan(plan: PlanId) {
    setPlanBusy(plan);
    try {
      await api.changePlan(plan);
      onPlanChanged();
      toast(`Workspace moved to ${PLAN_CARDS.find((p) => p.id === plan)?.name ?? plan}.`, "ok");
    } catch (err) {
      toast(err instanceof ApiError ? err.message : "Could not change plan", "error");
    } finally {
      setPlanBusy(null);
    }
  }

  async function download() {
    try {
      const blob = await exportData();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `omnibrain-export-${new Date().toISOString().slice(0, 10)}.json`;
      a.click();
      URL.revokeObjectURL(url);
      toast("Export downloaded.", "ok");
    } catch (err) {
      toast(err instanceof ApiError ? err.message : "Export failed", "error");
    }
  }

  return (
    <div className="mx-auto w-full max-w-3xl space-y-5 p-3 pb-20 md:p-4">
      <header>
        <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-faint">Workspace</p>
        <h1 className="mt-1 text-xl font-semibold tracking-[-0.02em]">Settings</h1>
      </header>

      <section className="panel p-3">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-sm font-medium">{account?.workspace.name ?? "Personal"}</p>
            <p className="mt-0.5 font-mono text-[10px] text-faint">
              {account?.user.email ?? "—"} · {account?.role ?? "owner"} ·{" "}
              {account?.workspace.slug ?? ""}
            </p>
          </div>
          <Badge tone="signal">{(account?.workspace.plan ?? "free").toUpperCase()}</Badge>
        </div>
        {account ? (
          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            <Limit
              label="Items"
              used={account.usage.items}
              limit={account.entitlements.items?.limit ?? 500}
            />
            <Limit
              label="AI enrichments / month"
              used={account.usage.enrichments_month}
              limit={account.entitlements.enrichments?.limit ?? 200}
            />
            <Limit
              label="Connections"
              used={account.usage.connections}
              limit={account.entitlements.connections?.limit ?? 1}
            />
            <Limit
              label="MCP calls / day"
              used={account.usage.mcp_calls_day}
              limit={account.entitlements.mcp?.limit ?? 100}
            />
            <Limit
              label="API keys"
              used={account.usage.api_keys}
              limit={account.entitlements.apiKeys?.limit ?? 10}
            />
          </div>
        ) : (
          <p className="mt-3 text-xs text-faint">Loading usage…</p>
        )}
        <p className="mt-3 text-[11px] leading-relaxed text-faint">
          Limits are enforced server-side with the same entitlement function the client uses.
          Downgrading never deletes data; the workspace becomes read-only over quota.
        </p>
      </section>

      <section className="panel p-3">
        <div className="flex items-baseline justify-between gap-2">
          <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-faint">Plan</p>
          <span className="font-mono text-[9.5px] text-faint">switch applies instantly</span>
        </div>
        <div className="mt-2 grid gap-2 sm:grid-cols-3">
          {PLAN_CARDS.map((plan) => {
            const current = account?.workspace.plan === plan.id;
            return (
              <div
                key={plan.id}
                className={`flex flex-col rounded-[var(--radius)] p-3 ${
                  current ? "bg-raised" : "bg-canvas/40"
                }`}
              >
                <div className="flex items-center justify-between">
                  <span className="text-[12.5px] font-medium">{plan.name}</span>
                  <span className="font-mono text-[10px] text-faint">
                    {plan.price ? `$${plan.price}/mo` : "free"}
                  </span>
                </div>
                <p className="mt-0.5 font-mono text-[9px] uppercase tracking-wider text-faint">
                  {plan.apiKeys === Number.POSITIVE_INFINITY
                    ? "unlimited keys"
                    : `${plan.apiKeys} API keys`}
                </p>
                <ul className="mt-2 space-y-0.5 font-mono text-[9.5px] text-faint">
                  <li>{plan.items.toLocaleString()} items</li>
                  <li>{plan.enrichments.toLocaleString()} enrichments / mo</li>
                  <li>
                    {plan.connections === Number.POSITIVE_INFINITY ? "unlimited" : plan.connections}{" "}
                    connections
                  </li>
                </ul>
                <Button
                  type="button"
                  variant={current ? "ghost" : "secondary"}
                  size="sm"
                  className={`mt-auto w-full ${current ? "" : "text-accent"}`}
                  disabled={current || planBusy !== null}
                  onClick={() => void changePlan(plan.id)}
                >
                  {current
                    ? "Current plan"
                    : planBusy === plan.id
                      ? "Switching…"
                      : `Switch to ${plan.name}`}
                </Button>
              </div>
            );
          })}
        </div>
        <p className="mt-2 text-[10.5px] leading-relaxed text-faint">
          Billing is not wired in this build: switching updates entitlements immediately. Connect
          Stripe before charging real cards.
        </p>
      </section>

      <section className="panel p-3">
        <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-faint">Appearance</p>
        <div className="mt-2 grid gap-2 sm:grid-cols-3">
          {THEMES.map((option) => (
            <button
              key={option.id}
              type="button"
              onClick={() => onTheme(option.id)}
              className={`rounded-[var(--radius)] p-3 text-left transition ${
                theme === option.id ? "bg-raised" : "hover:bg-raised/60"
              }`}
            >
              <div className="flex items-center justify-between">
                <span className="text-[12.5px] font-medium">{option.label}</span>
                <span
                  className={`size-2 rounded-full ${
                    theme === option.id ? "bg-accent" : "bg-raised"
                  }`}
                />
              </div>
              <p className="mt-0.5 font-mono text-[10px] text-faint">{option.hint}</p>
            </button>
          ))}
        </div>

        <div className="mt-4 flex flex-wrap items-center justify-between gap-2">
          <div>
            <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-faint">
              Accent palette
            </p>
            <p className="mt-0.5 text-[10.5px] text-faint">
              Flat swatches. Badges, AI labels, tags, links and focus follow this color.
            </p>
          </div>
          <div className="flex items-center gap-2">
            {ACCENTS.map((option) => {
              const selected = accent === option.id;
              return (
                <Tooltip key={option.id} label={option.label}>
                  <button
                    type="button"
                    onClick={() => onAccent(option.id)}
                    aria-label={`Accent ${option.label}`}
                    aria-pressed={selected}
                    className={`grid size-6 place-items-center rounded-full text-[10px] transition ${
                      selected
                        ? "outline outline-2 outline-offset-2 outline-accent"
                        : "outline-none hover:brightness-110"
                    }`}
                    style={{ background: ACCENT_SWATCHES[option.id] }}
                  >
                    {selected ? <CheckIcon size={12} className="text-black/70" /> : null}
                  </button>
                </Tooltip>
              );
            })}
          </div>
        </div>
      </section>

      <section className="panel p-3">
        <div className="flex items-baseline justify-between gap-2">
          <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-faint">Data</p>
          <span className="font-mono text-[9.5px] text-faint">portable · no lock-in</span>
        </div>
        <div className="mt-2 grid gap-2 sm:grid-cols-2">
          <button
            type="button"
            onClick={() => void download()}
            className="group flex items-center gap-3 rounded-[var(--radius)] bg-raised/60 p-3 text-left transition hover:bg-raised"
          >
            <span className="grid size-8 shrink-0 place-items-center rounded-[6px] bg-panel text-accent">
              <StreamIcon size={15} />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block text-[12.5px] text-text">Export JSON</span>
              <span className="block font-mono text-[9.5px] text-faint">
                JSON · items, tags, sources
              </span>
            </span>
            <ArrowUpRightIcon size={13} className="text-faint group-hover:text-accent" />
          </button>
          <button
            type="button"
            onClick={async () => {
              await api.logout();
              onSignedOut();
            }}
            className="group flex items-center gap-3 rounded-[var(--radius)] bg-raised/60 p-3 text-left transition hover:bg-raised"
          >
            <span className="grid size-8 shrink-0 place-items-center rounded-[6px] bg-panel text-muted">
              <LockIcon size={15} />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block text-[12.5px] text-text">Sign out</span>
              <span className="block font-mono text-[9.5px] text-faint">this device only</span>
            </span>
            <span className="font-mono text-[9.5px] text-faint group-hover:text-accent">→</span>
          </button>
        </div>
        <p className="mt-2 text-[10.5px] leading-relaxed text-faint">
          Export is a single JSON file with your items, tags and source metadata. Your data never
          leaves this workspace for any other tenant.
        </p>
      </section>

      <section className="rounded-[var(--radius)] bg-panel p-4">
        <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-coral">Danger zone</p>
        <p className="mt-1 text-[11.5px] leading-relaxed text-muted">
          Deleting the account removes owned workspaces, items, connections, sessions and vectors.
          This cannot be undone. Type <span className="font-mono text-coral">delete</span> to
          confirm — export first.
        </p>
        <div className="mt-3 flex flex-wrap gap-2">
          <Input
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            placeholder="delete"
            aria-label="Type delete to confirm"
            className="flex-1"
          />
          <Button
            type="button"
            variant="ghost"
            size="md"
            disabled={confirm !== "delete" || busy}
            className="text-coral hover:bg-coral/10 hover:text-coral"
            onClick={async () => {
              setBusy(true);
              try {
                await api.deleteAccount();
                onSignedOut();
              } catch (err) {
                toast(err instanceof ApiError ? err.message : "Delete failed", "error");
              } finally {
                setBusy(false);
              }
            }}
          >
            <TrashIcon size={13} />
            Delete account
          </Button>
        </div>
      </section>

      <p className="pb-6 text-center font-mono text-[10px] text-faint">
        OmniBrain 0.1 · Alchemy + Cloudflare Workers · Bun everywhere in development
      </p>
    </div>
  );
}
