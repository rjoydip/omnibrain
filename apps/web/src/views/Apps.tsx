import {
  Badge,
  Button,
  Card,
  CardContent,
  CardFooter,
  CardHeader,
  EmptyState,
  Input,
  Modal,
  Spinner,
  Tooltip,
} from "@omnibrain/ui";
import { useCallback, useEffect, useState } from "react";
import { BrandLogo } from "../components/BrandLogo";
import {
  LockIcon,
  PauseIcon,
  PlayIcon,
  PlusIcon,
  RefreshIcon,
  SignInIcon,
  TrashIcon,
} from "../components/icons";
import { ApiError, type AppInfo, api } from "../lib/api";
import { relativeTime } from "../lib/format";

/** Social-login style provider name: Google Keep signs in with Google. */
function signInName(app: AppInfo): string {
  return app.id === "keep" ? "Google" : app.name;
}

/** Deployment env vars that enable one-click sign-in for an app. */
function envHint(app: AppInfo): string {
  if (app.id === "keep") return "GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET";
  if (app.id === "notion") return "NOTION_CLIENT_ID / NOTION_CLIENT_SECRET";
  return "GH_CLIENT_ID / GH_CLIENT_SECRET";
}

/** "every 15m" from a cron like "*\/15 * * * *"; manual when there is no schedule. */
function cadence(schedule?: string): string {
  const match = schedule?.match(/^\*\/(\d+) \* \* \* \*$/);
  if (match?.[1]) return `auto every ${match[1]}m`;
  return schedule ? "scheduled" : "manual sync";
}

export function AppsView({
  toast,
  onChanged,
}: {
  toast: (message: string, tone?: "ok" | "error") => void;
  onChanged: () => void;
}) {
  const [apps, setApps] = useState<AppInfo[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [disconnect, setDisconnect] = useState<AppInfo | null>(null);
  const [deleteItems, setDeleteItems] = useState(false);
  const [syncDupes, setSyncDupes] = useState<{
    app: string;
    count: number;
    items: Array<{ title: string; url: string | null }>;
  } | null>(null);
  const [tokenApp, setTokenApp] = useState<AppInfo | null>(null);
  const [token, setToken] = useState("");
  const [tokenBusy, setTokenBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await api.apps();
      setApps(res.apps);
      setError(null);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not load the App Store");
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const runSync = useCallback(
    async (connectionId: string, appName: string) => {
      const res = await api.syncConnection(connectionId);
      toast(
        `Synced ${res.fetched} items · ${res.created} new${
          res.duplicateCount ? ` · ${res.duplicateCount} already known` : ""
        }.`,
        "ok",
      );
      if (res.duplicates.length > 0) {
        setSyncDupes({ app: appName, count: res.duplicateCount, items: res.duplicates });
      }
      return res;
    },
    [toast],
  );

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const installed = params.get("installed");
    const failed = params.get("error");
    if (installed) {
      window.history.replaceState({}, "", window.location.pathname);
      toast(`${installed} connected. Syncing…`);
      void (async () => {
        try {
          const res = await api.apps();
          setApps(res.apps);
          const app = res.apps.find((item) => item.id === installed);
          if (!app?.connection) return;
          await runSync(app.connection.id, app.name);
          await load();
          onChanged();
        } catch (err) {
          toast(err instanceof ApiError ? err.message : "Sync failed", "error");
          await load();
        }
      })();
    } else if (failed) {
      toast(decodeURIComponent(failed), "error");
      window.history.replaceState({}, "", window.location.pathname);
    }
  }, [toast, onChanged, load, runSync]);

  function openToken(app: AppInfo) {
    setTokenApp(app);
    setToken("");
  }

  async function connectWithToken() {
    if (!tokenApp || !token.trim()) return;
    const target = tokenApp;
    setTokenBusy(true);
    try {
      const res = await api.connect(target.id, token.trim());
      setTokenApp(null);
      toast(`${target.name} connected. Syncing…`, "ok");
      if (res.connection_id) await runSync(res.connection_id, target.name);
      await load();
      onChanged();
    } catch (err) {
      toast(err instanceof ApiError ? err.message : "Could not connect with that token", "error");
    } finally {
      setTokenBusy(false);
    }
  }

  async function install(app: AppInfo) {
    if (!app.configured) {
      if (app.token_auth) {
        openToken(app);
        return;
      }
      toast(
        `${app.name} sign-in is not configured on this server. Set ${envHint(app)} and restart.`,
        "error",
      );
      return;
    }
    setBusy(app.id);
    try {
      const res = await api.connect(app.id);
      if (res.authorize_url) {
        window.location.assign(res.authorize_url);
        return;
      }
      toast(`${app.name} connected.`, "ok");
      await load();
      onChanged();
    } catch (err) {
      toast(err instanceof ApiError ? err.message : "Install failed", "error");
    } finally {
      setBusy(null);
    }
  }

  async function sync(app: AppInfo) {
    if (!app.connection) return;
    setBusy(app.id);
    try {
      await runSync(app.connection.id, app.name);
      await load();
      onChanged();
    } catch (err) {
      toast(err instanceof ApiError ? err.message : "Sync failed", "error");
      await load();
    } finally {
      setBusy(null);
    }
  }

  // File imports live in the Import view; the store only lists installable apps.
  const sources = apps?.filter((app) => app.auth !== "file-import") ?? [];

  async function togglePause(app: AppInfo) {
    if (!app.connection) return;
    setBusy(app.id);
    try {
      if (app.connection.status === "paused") await api.resumeConnection(app.connection.id);
      else await api.pauseConnection(app.connection.id);
      await load();
    } catch (err) {
      toast(err instanceof ApiError ? err.message : "Could not update connection", "error");
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="mx-auto w-full max-w-3xl space-y-5 p-3 pb-20 md:p-4">
      <header>
        <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-faint">Live sources</p>
        <h1 className="mt-1 text-xl font-semibold tracking-[-0.02em]">App Store</h1>
        <p className="mt-1 max-w-lg text-xs leading-relaxed text-muted">
          Connect an account once and OmniBrain keeps it in sync with read-only scopes. One-way file
          exports live in the Import view instead.
        </p>
      </header>

      {error ? (
        <div className="rounded-[var(--radius)] border border-coral/30 bg-coral/5 px-3 py-2 text-xs text-coral">
          {error}
        </div>
      ) : null}

      {!apps ? (
        <div className="grid gap-2 sm:grid-cols-2">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="panel space-y-3 p-4">
              <div className="skeleton h-8 w-8" />
              <div className="skeleton h-3 w-1/2" />
              <div className="skeleton h-2.5 w-full" />
              <div className="skeleton h-2.5 w-3/4" />
            </div>
          ))}
        </div>
      ) : sources.length === 0 ? (
        <EmptyState title="No apps" body="The catalog is empty in this deployment." />
      ) : (
        <div className="grid gap-2 sm:grid-cols-2">
          {sources.map((app) => {
            const connected = app.connection?.status === "connected";
            const degraded = app.connection?.status === "degraded";
            const paused = app.connection?.status === "paused";
            const installLabel = app.configured
              ? `Continue with ${signInName(app)}`
              : app.token_auth
                ? `Connect ${app.name} with a token`
                : `Set up ${app.name} sign-in`;
            const statusBadge = connected
              ? { label: "Connected", className: "bg-mint/10 text-mint", dot: "bg-mint" }
              : paused
                ? { label: "Paused", className: "bg-amber/10 text-amber", dot: "bg-amber" }
                : degraded
                  ? {
                      label: "Needs attention",
                      className: "bg-coral/10 text-coral",
                      dot: "bg-coral",
                    }
                  : app.installed
                    ? { label: "Installed", className: "bg-raised text-muted", dot: "bg-faint" }
                    : null;
            return (
              <Card key={app.id} className="flex flex-col">
                <CardHeader className="flex-row items-start gap-3 p-3.5 pb-2">
                  <div className="source-tile size-9">
                    <BrandLogo id={app.id} size={18} fallback={app.glyph} />
                  </div>
                  <div className="min-w-0 flex-1">
                    <h2 className="truncate text-[13.5px] font-semibold text-text">{app.name}</h2>
                    <p className="mt-0.5 font-mono text-[9px] uppercase tracking-[0.14em] text-faint">
                      {app.category}
                    </p>
                  </div>
                  {statusBadge ? (
                    <Badge tone="muted" className={statusBadge.className}>
                      <span className={`size-1.5 rounded-full ${statusBadge.dot}`} />
                      {statusBadge.label}
                    </Badge>
                  ) : null}
                </CardHeader>

                <CardContent className="px-3.5 pb-3">
                  <p className="line-clamp-2 text-[11.5px] leading-relaxed text-muted">
                    {app.description}
                  </p>
                  <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-0.5 border-t border-line/60 pt-2 font-mono text-[9.5px] text-faint">
                    <span className="truncate">
                      {app.scopes.length ? app.scopes.join(", ") : "on-device · no token"}
                    </span>
                    {app.installed ? (
                      <>
                        <span aria-hidden="true">·</span>
                        <span>{cadence(app.schedule)}</span>
                      </>
                    ) : null}
                  </div>
                  {degraded ? (
                    <p className="mt-1 truncate font-mono text-[9.5px] text-coral">
                      {app.connection?.last_error ?? "Needs reconnect"}
                    </p>
                  ) : null}
                </CardContent>

                <CardFooter className="mt-auto items-center gap-1.5 px-3 pb-3 pt-0">
                  {app.installed ? (
                    <>
                      <Tooltip label={paused ? "Resume auto-sync first" : "Sync now"}>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon-sm"
                          className="text-accent"
                          onClick={() => void sync(app)}
                          disabled={busy === app.id || paused}
                          aria-label={`Sync ${app.name} now`}
                        >
                          <RefreshIcon
                            size={13}
                            className={busy === app.id ? "animate-spin text-accent" : "text-accent"}
                          />
                        </Button>
                      </Tooltip>
                      <span
                        className={`min-w-0 truncate font-mono text-[9px] ${
                          degraded ? "text-coral" : "text-faint"
                        }`}
                      >
                        {paused
                          ? "paused"
                          : `synced ${relativeTime(app.connection?.last_synced_at ?? null)}`}
                      </span>
                      <span className="ml-auto flex items-center gap-0.5">
                        <Tooltip label={paused ? "Resume auto-sync" : "Pause auto-sync"}>
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon-sm"
                            className="text-amber"
                            onClick={() => void togglePause(app)}
                            disabled={busy === app.id}
                            aria-label={paused ? "Resume auto-sync" : "Pause auto-sync"}
                          >
                            {paused ? <PlayIcon size={13} /> : <PauseIcon size={13} />}
                          </Button>
                        </Tooltip>
                        <Tooltip label="Delete source">
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon-sm"
                            className="text-coral"
                            onClick={() => {
                              setDisconnect(app);
                              setDeleteItems(false);
                            }}
                            aria-label={`Delete ${app.name}`}
                          >
                            <TrashIcon size={13} />
                          </Button>
                        </Tooltip>
                      </span>
                    </>
                  ) : (
                    <>
                      <Tooltip label={installLabel}>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon-sm"
                          className="text-accent"
                          onClick={() => void install(app)}
                          disabled={busy === app.id}
                          aria-label={installLabel}
                        >
                          {busy === app.id ? (
                            <Spinner className="size-3" />
                          ) : app.configured ? (
                            <SignInIcon size={13} />
                          ) : app.token_auth ? (
                            <PlusIcon size={13} />
                          ) : (
                            <LockIcon size={12} />
                          )}
                        </Button>
                      </Tooltip>
                    </>
                  )}
                </CardFooter>
              </Card>
            );
          })}
        </div>
      )}

      <Modal
        open={Boolean(tokenApp)}
        onClose={() => setTokenApp(null)}
        title={`${tokenApp?.name ?? ""} access token`}
      >
        <p className="text-xs leading-relaxed text-muted">
          Paste a personal access token. It is verified with the provider, then stored encrypted
          with AES-GCM.
        </p>
        <Input
          value={token}
          onChange={(e) => setToken(e.target.value)}
          placeholder="Personal access token"
          aria-label="Personal access token"
          type="password"
          autoComplete="off"
          className="mt-3"
        />
        <div className="mt-4 flex flex-wrap justify-end gap-2">
          <Button type="button" variant="ghost" size="md" onClick={() => setTokenApp(null)}>
            Cancel
          </Button>
          <Button
            type="button"
            variant="primary"
            size="md"
            disabled={tokenBusy || !token.trim()}
            onClick={() => void connectWithToken()}
          >
            {tokenBusy ? "Connecting…" : "Connect"}
          </Button>
        </div>
      </Modal>

      <Modal
        open={Boolean(disconnect)}
        onClose={() => setDisconnect(null)}
        title={`Delete ${disconnect?.name ?? ""} source`}
      >
        <p className="text-xs leading-relaxed text-muted">
          Sync stops immediately and the access token is discarded. Nothing is deleted until you
          confirm; choose what happens to items already imported.
        </p>

        <div className="mt-3 space-y-1.5">
          <label className="flex cursor-pointer items-start gap-2 rounded-[var(--radius)] bg-canvas/40 p-3 text-xs text-muted">
            <input
              type="radio"
              name="delete-mode"
              checked={!deleteItems}
              onChange={() => setDeleteItems(false)}
              aria-label="Keep imported items"
              className="mt-0.5 accent-[var(--mint)]"
            />
            <span>
              <span className="block text-text">Keep imported items</span>
              <span className="block text-faint">They stay searchable in your knowledge base.</span>
            </span>
          </label>
          <label className="flex cursor-pointer items-start gap-2 rounded-[var(--radius)] bg-coral/5 p-3 text-xs text-muted">
            <input
              type="radio"
              name="delete-mode"
              checked={deleteItems}
              onChange={() => setDeleteItems(true)}
              aria-label="Delete imported items"
              className="mt-0.5 accent-[var(--coral)]"
            />
            <span>
              <span className="block text-coral">Delete imported items</span>
              <span className="block text-faint">
                Also removes their vectors. Cannot be undone.
              </span>
            </span>
          </label>
        </div>

        <div className="mt-4 flex justify-end gap-2">
          <Button type="button" variant="ghost" size="md" onClick={() => setDisconnect(null)}>
            Cancel
          </Button>
          <Button
            type="button"
            variant="danger"
            size="md"
            onClick={async () => {
              if (!disconnect?.connection) return;
              try {
                await api.disconnect(disconnect.connection.id, deleteItems);
                toast(
                  deleteItems
                    ? `${disconnect.name} deleted with its imported items.`
                    : `${disconnect.name} removed. Items kept.`,
                  "ok",
                );
                setDisconnect(null);
                await load();
                onChanged();
              } catch (err) {
                toast(err instanceof ApiError ? err.message : "Delete failed", "error");
              }
            }}
          >
            <TrashIcon size={13} />
            Delete source
          </Button>
        </div>
      </Modal>

      <Modal
        open={Boolean(syncDupes)}
        onClose={() => setSyncDupes(null)}
        title={`${syncDupes?.count ?? 0} already in your library`}
      >
        <p className="text-xs leading-relaxed text-muted">
          The last {syncDupes?.app ?? "source"} sync found items you already had. They were skipped
          — nothing was overwritten.
        </p>
        <div className="mt-3 max-h-56 overflow-y-auto rounded-[var(--radius)] bg-canvas/40">
          <table className="w-full table-fixed text-left">
            <thead className="sticky top-0 bg-canvas/90 font-mono text-[9px] uppercase tracking-wider text-faint">
              <tr>
                <th className="px-3 py-1.5 font-normal">Item</th>
                <th className="px-3 py-1.5 font-normal">Link</th>
                <th className="px-3 py-1.5 text-right font-normal">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {syncDupes?.items.map((item) => (
                <tr key={`${item.url ?? ""}-${item.title}`}>
                  <td className="max-w-0 px-3 py-2">
                    <p className="truncate text-[12px] text-text">{item.title}</p>
                  </td>
                  <td className="max-w-0 px-3 py-2">
                    <p className="truncate font-mono text-[10px] text-accent">
                      {item.url ?? "note"}
                    </p>
                  </td>
                  <td className="px-3 py-2 text-right">
                    <Badge tone="muted" className="bg-amber/10 text-amber">
                      duplicate
                    </Badge>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {(syncDupes?.count ?? 0) > (syncDupes?.items.length ?? 0) ? (
          <p className="mt-1 font-mono text-[10px] text-faint">
            + {(syncDupes?.count ?? 0) - (syncDupes?.items.length ?? 0)} more
          </p>
        ) : null}
        <div className="mt-4 flex justify-end">
          <Button type="button" variant="primary" size="md" onClick={() => setSyncDupes(null)}>
            Got it
          </Button>
        </div>
      </Modal>
    </div>
  );
}
