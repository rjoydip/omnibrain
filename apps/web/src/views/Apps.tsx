import {
  Badge,
  Button,
  Card,
  CardContent,
  CardFooter,
  CardHeader,
  EmptyState,
  Input,
  Menu,
  MenuContent,
  MenuItem,
  MenuTrigger,
  Modal,
  Spinner,
  Tooltip,
} from "@omnibrain/ui";
import { useCallback, useEffect, useState } from "react";
import { BrandLogo } from "../components/BrandLogo";
import {
  EllipsisIcon,
  ImportIcon,
  LockIcon,
  PauseIcon,
  PlayIcon,
  PlusIcon,
  RefreshIcon,
  TrashIcon,
} from "../components/icons";
import { ApiError, type AppInfo, api } from "../lib/api";
import { relativeTime } from "../lib/format";

const ACCENT_TILE = "text-accent";

/** "every 15m" from a cron like "*\/15 * * * *"; manual when there is no schedule. */
function cadence(schedule?: string): string {
  const match = schedule?.match(/^\*\/(\d+) \* \* \* \*$/);
  if (match?.[1]) return `auto every ${match[1]}m`;
  return schedule ? "scheduled" : "manual sync";
}

export function AppsView({
  toast,
  onNavigateImport,
  onChanged,
  preferred,
}: {
  toast: (message: string, tone?: "ok" | "error") => void;
  onNavigateImport: (appId: string) => void;
  onChanged: () => void;
  preferred: string | null;
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
  const [credApp, setCredApp] = useState<AppInfo | null>(null);
  const [credId, setCredId] = useState("");
  const [credSecret, setCredSecret] = useState("");
  const [credBusy, setCredBusy] = useState(false);

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

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const installed = params.get("installed");
    const failed = params.get("error");
    if (installed) {
      toast(`${installed} connected. Backfill is running.`);
      window.history.replaceState({}, "", window.location.pathname);
      onChanged();
    } else if (failed) {
      toast(decodeURIComponent(failed), "error");
      window.history.replaceState({}, "", window.location.pathname);
    }
  }, [toast, onChanged]);

  function openCredentials(app: AppInfo) {
    setCredApp(app);
    setCredId("");
    setCredSecret("");
  }

  async function saveCredentials() {
    if (!credApp) return;
    setCredBusy(true);
    try {
      await api.setCredentials(credApp.id, credId.trim(), credSecret.trim());
      await load();
      toast(`${credApp.name} credentials saved encrypted.`, "ok");
      setCredApp(null);
    } catch (err) {
      toast(err instanceof ApiError ? err.message : "Could not save credentials", "error");
    } finally {
      setCredBusy(false);
    }
  }

  async function removeCredentials() {
    if (!credApp) return;
    setCredBusy(true);
    try {
      await api.deleteCredentials(credApp.id);
      await load();
      toast(`${credApp.name} credentials removed.`, "ok");
      setCredApp(null);
    } catch (err) {
      toast(err instanceof ApiError ? err.message : "Could not remove credentials", "error");
    } finally {
      setCredBusy(false);
    }
  }

  async function install(app: AppInfo) {
    if (app.auth === "file-import") {
      onNavigateImport(app.id);
      return;
    }
    if (!app.configured) {
      openCredentials(app);
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
      const res = await api.syncConnection(app.connection.id);
      toast(
        `Synced ${res.fetched} items · ${res.created} new${
          res.duplicateCount ? ` · ${res.duplicateCount} already known` : ""
        }.`,
        "ok",
      );
      await load();
      onChanged();
      if (res.duplicates.length > 0) {
        setSyncDupes({ app: app.name, count: res.duplicateCount, items: res.duplicates });
      }
    } catch (err) {
      toast(err instanceof ApiError ? err.message : "Sync failed", "error");
      await load();
    } finally {
      setBusy(null);
    }
  }

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
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-faint">Sources</p>
          <h1 className="mt-1 text-xl font-semibold tracking-[-0.02em]">App Store</h1>
          <p className="mt-1 max-w-lg text-xs leading-relaxed text-muted">
            Install a source once. Read-only scopes, visible health, and a disconnect that tells you
            exactly what happens to imported items.
          </p>
        </div>
        <Badge tone="mint">least privilege</Badge>
      </header>

      {preferred ? (
        <div className="rounded-[var(--radius)] border border-signal/30 bg-signal/5 px-3 py-2 text-xs text-muted">
          Continuing from the App Store:{" "}
          <span className="font-medium text-text">
            {apps?.find((a) => a.id === preferred)?.name ?? preferred}
          </span>
          . Choose the import below.
        </div>
      ) : null}

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
      ) : apps.length === 0 ? (
        <EmptyState title="No apps" body="The catalog is empty in this deployment." />
      ) : (
        <div className="grid gap-2 sm:grid-cols-2">
          {apps.map((app) => {
            const connected = app.connection?.status === "connected";
            const degraded = app.connection?.status === "degraded";
            const paused = app.connection?.status === "paused";
            const installLabel =
              app.auth === "file-import"
                ? `Import from ${app.name}`
                : app.configured
                  ? `Install ${app.name}`
                  : `Add credentials for ${app.name}`;
            const hint =
              app.auth === "file-import"
                ? "local parse"
                : !app.configured
                  ? "needs credentials"
                  : "read-only";
            return (
              <Card key={app.id} className="flex flex-col">
                <CardHeader className="flex-row items-start gap-2.5 p-3 pb-2">
                  <div className={`source-tile size-8 ${ACCENT_TILE}`}>
                    <BrandLogo id={app.id} size={17} fallback={app.glyph} />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <h2 className="truncate text-[13px] font-semibold text-text">{app.name}</h2>
                      {app.status === "beta" ? <Badge tone="signal">beta</Badge> : null}
                      {app.status === "import-only" ? (
                        <Badge tone="signal">import only</Badge>
                      ) : null}
                    </div>
                    <p className="mt-0.5 font-mono text-[9px] uppercase tracking-[0.14em] text-faint">
                      {app.category}
                    </p>
                  </div>
                  {app.installed ? (
                    <Tooltip label={app.connection?.status ?? "installed"}>
                      <span
                        className={`mt-1 size-2 shrink-0 rounded-full ${
                          connected
                            ? "bg-mint"
                            : degraded
                              ? "bg-coral"
                              : paused
                                ? "bg-signal"
                                : "bg-faint"
                        }`}
                      />
                    </Tooltip>
                  ) : null}
                </CardHeader>

                <CardContent className="px-3 pb-2">
                  <p className="line-clamp-2 text-[11.5px] leading-relaxed text-muted">
                    {app.description}
                  </p>
                  <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 font-mono text-[9.5px] text-faint">
                    <span className="truncate">
                      {app.scopes.length ? app.scopes.join(", ") : "on-device · no token"}
                    </span>
                    {app.installed ? <span>{cadence(app.schedule)}</span> : null}
                  </div>
                  {degraded ? (
                    <p className="mt-1 truncate font-mono text-[9.5px] text-coral">
                      {app.connection?.last_error ?? "Needs reconnect"}
                    </p>
                  ) : null}
                </CardContent>

                <CardFooter className="mt-auto items-center gap-1 px-2 py-1.5">
                  {app.installed ? (
                    <>
                      <Tooltip label={paused ? "Resume auto-sync first" : "Sync now"}>
                        <Button
                          type="button"
                          variant="secondary"
                          size="sm"
                          onClick={() => void sync(app)}
                          disabled={busy === app.id || paused}
                          aria-label={`Sync ${app.name} now`}
                        >
                          <RefreshIcon
                            size={13}
                            className={busy === app.id ? "animate-spin" : undefined}
                          />
                          Sync
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
                      <Menu>
                        <Tooltip label="Manage source">
                          <MenuTrigger asChild>
                            <Button
                              type="button"
                              variant="ghost"
                              size="icon-sm"
                              className="ml-auto"
                              aria-label={`Manage ${app.name}`}
                            >
                              <EllipsisIcon size={13} />
                            </Button>
                          </MenuTrigger>
                        </Tooltip>
                        <MenuContent>
                          <MenuItem
                            onSelect={() => void togglePause(app)}
                            disabled={busy === app.id}
                          >
                            {paused ? <PlayIcon size={12} /> : <PauseIcon size={12} />}
                            {paused ? "Resume auto-sync" : "Pause auto-sync"}
                          </MenuItem>
                          <MenuItem onSelect={() => openCredentials(app)}>
                            <LockIcon size={12} />
                            OAuth credentials…
                          </MenuItem>
                          <div aria-hidden="true" className="my-1 h-px bg-panel" />
                          <MenuItem
                            onSelect={() => {
                              setDisconnect(app);
                              setDeleteItems(false);
                            }}
                            className="text-coral focus:text-coral"
                          >
                            <TrashIcon size={12} />
                            Delete source…
                          </MenuItem>
                        </MenuContent>
                      </Menu>
                    </>
                  ) : (
                    <>
                      <Tooltip label={installLabel}>
                        <Button
                          type="button"
                          variant="primary"
                          size="icon-sm"
                          onClick={() => void install(app)}
                          disabled={busy === app.id}
                          aria-label={installLabel}
                        >
                          {busy === app.id ? (
                            <Spinner className="size-3" />
                          ) : app.auth === "file-import" ? (
                            <ImportIcon size={13} />
                          ) : app.configured ? (
                            <PlusIcon size={13} />
                          ) : (
                            <LockIcon size={12} />
                          )}
                        </Button>
                      </Tooltip>
                      {app.auth === "oauth2" && app.configured ? (
                        <Tooltip label="OAuth credentials">
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon-sm"
                            onClick={() => openCredentials(app)}
                            aria-label={`Edit ${app.name} credentials`}
                          >
                            <LockIcon size={11} />
                          </Button>
                        </Tooltip>
                      ) : null}
                      <span className="ml-1 font-mono text-[9px] text-faint">{hint}</span>
                    </>
                  )}
                </CardFooter>
              </Card>
            );
          })}
        </div>
      )}

      <Modal
        open={Boolean(credApp)}
        onClose={() => setCredApp(null)}
        title={`${credApp?.name ?? ""} OAuth credentials`}
      >
        <p className="text-xs leading-relaxed text-muted">
          Stored encrypted with AES-GCM in the database. Only the client ID and secret are needed;
          environment variables remain a fallback for this deployment.
        </p>
        <Input
          value={credId}
          onChange={(e) => setCredId(e.target.value)}
          placeholder="Client ID"
          aria-label="OAuth client ID"
          className="mt-3"
        />
        <Input
          value={credSecret}
          onChange={(e) => setCredSecret(e.target.value)}
          placeholder="Client secret"
          aria-label="OAuth client secret"
          type="password"
          autoComplete="off"
          className="mt-2"
        />
        <div className="mt-4 flex flex-wrap justify-end gap-2">
          {credApp?.credential_source === "db" ? (
            <Button
              type="button"
              variant="danger"
              size="md"
              disabled={credBusy}
              onClick={() => void removeCredentials()}
            >
              <TrashIcon size={13} />
              Remove
            </Button>
          ) : null}
          <Button type="button" variant="ghost" size="md" onClick={() => setCredApp(null)}>
            Cancel
          </Button>
          <Button
            type="button"
            variant="primary"
            size="md"
            disabled={credBusy || !credId.trim() || !credSecret.trim()}
            onClick={() => void saveCredentials()}
          >
            {credBusy ? "Saving…" : "Save credentials"}
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
        <ul className="mt-3 max-h-56 divide-y divide-line overflow-y-auto rounded-[var(--radius)] bg-canvas/40">
          {syncDupes?.items.map((item) => (
            <li key={`${item.url ?? ""}-${item.title}`} className="px-3 py-2">
              <p className="truncate text-[12px] text-muted">{item.title}</p>
              <p className="truncate font-mono text-[10px] text-faint">{item.url ?? "note"}</p>
            </li>
          ))}
        </ul>
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
