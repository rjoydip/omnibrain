import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { flushSync } from "react-dom";
import { toast as notch } from "notch-toast";
import type { AtlasFilter } from "./components/Atlas";
import { Recall } from "./components/Recall";
import { BootSplash, MobileNav, Rail, SectionLoading, TopBar } from "./components/Shell";
import { type Account, ApiError, api, type Item, type Me } from "./lib/api";
import type { Accent, ItemLayout, ItemStatus, Theme, View } from "./lib/nav";
import { AuthScreen } from "./views/Auth";
import { Inspector } from "./views/Inspector";
import { Knowledge } from "./views/Knowledge";
import { SettingsView } from "./views/Settings";

const AppsView = lazy(() => import("./views/Apps").then((m) => ({ default: m.AppsView })));
const ImportView = lazy(() => import("./views/Import").then((m) => ({ default: m.ImportView })));
const McpView = lazy(() => import("./views/Mcp").then((m) => ({ default: m.McpView })));
const NoteCapture = lazy(() =>
  import("./components/NoteCapture").then((m) => ({ default: m.NoteCapture })),
);

const THEME_ORDER: Theme[] = ["ink", "paper", "contrast"];
const ACCENT_IDS = new Set<Accent>(["cobalt", "amber", "mint", "rose", "violet", "cyan"]);
const VIEWS = new Set<View>(["knowledge", "apps", "import", "mcp", "settings"]);
const STATUSES = new Set<ItemStatus>(["active", "archived", "trash"]);
const LAYOUTS = new Set<ItemLayout>(["list", "grid", "graph"]);

function urlParams(): URLSearchParams {
  return new URLSearchParams(window.location.search);
}

function isAbort(err: unknown): boolean {
  return err instanceof Error && err.name === "AbortError";
}

/** Atlas selection encoded as fstart/fend/flabel/fsrc so a filtered view is shareable. */
function readFilter(params: URLSearchParams): AtlasFilter | null {
  if (!params.has("fstart") || !params.has("fend")) return null;
  const start = Number(params.get("fstart"));
  const end = Number(params.get("fend"));
  if (!Number.isFinite(start) || !Number.isFinite(end)) return null;
  const sources = params.get("fsrc")?.split(",").filter(Boolean);
  return {
    start,
    end,
    label: params.get("flabel") ?? "Custom range",
    ...(sources?.length ? { sources } : {}),
  };
}

function initialView(): View {
  const fromUrl = urlParams().get("view");
  if (VIEWS.has(fromUrl as View)) return fromUrl as View;
  const stored = localStorage.getItem("omnibrain.view.v2");
  return VIEWS.has(stored as View) ? (stored as View) : "knowledge";
}

function initialStatus(): ItemStatus {
  const fromUrl = urlParams().get("status");
  return STATUSES.has(fromUrl as ItemStatus) ? (fromUrl as ItemStatus) : "active";
}

function initialSource(): string {
  return urlParams().get("source") ?? "all";
}

function initialTheme(): Theme {
  const stored = localStorage.getItem("omnibrain.theme.v2");
  return stored === "paper" || stored === "contrast" || stored === "ink" ? stored : "ink";
}

function initialAccent(): Accent {
  const stored = localStorage.getItem("omnibrain.accent.v2");
  return ACCENT_IDS.has(stored as Accent) ? (stored as Accent) : "cobalt";
}

export default function App() {
  const [me, setMe] = useState<Me | null>(null);
  const [boot, setBoot] = useState<"loading" | "ready" | "error">("loading");
  const [bootError, setBootError] = useState<string | null>(null);

  const [items, setItems] = useState<Item[]>([]);
  const [itemsLoading, setItemsLoading] = useState(true);
  const [total, setTotal] = useState(0);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [account, setAccount] = useState<Account | null>(null);

  const [view, setView] = useState<View>(initialView);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [atlasFilter, setAtlasFilter] = useState<AtlasFilter | null>(() => readFilter(urlParams()));
  const [sourceFilter, setSourceFilter] = useState(initialSource);
  const [itemStatus, setItemStatus] = useState<ItemStatus>(initialStatus);
  const [itemLayout, setItemLayout] = useState<ItemLayout>(() => {
    const fromUrl = urlParams().get("layout");
    if (LAYOUTS.has(fromUrl as ItemLayout)) return fromUrl as ItemLayout;
    const stored = localStorage.getItem("omnibrain.itemLayout.v3");
    return LAYOUTS.has(stored as ItemLayout) ? (stored as ItemLayout) : "grid";
  });
  const [knownSources, setKnownSources] = useState<string[]>([]);

  const [theme, setTheme] = useState<Theme>(initialTheme);
  const [accent, setAccent] = useState<Accent>(initialAccent);
  const [panelWidth, setPanelWidth] = useState(() => {
    const stored = Number(localStorage.getItem("omnibrain.panelWidth.v2"));
    return stored >= 300 && stored <= 720 ? stored : 320;
  });
  const [recallOpen, setRecallOpen] = useState(false);
  const [recallSeed, setRecallSeed] = useState("");
  const [noteOpen, setNoteOpen] = useState(false);
  const [importPreferred, setImportPreferred] = useState<string | null>(null);
  const refreshAbort = useRef<AbortController | null>(null);
  const lastStatus = useRef<ItemStatus>(itemStatus);
  const urlSynced = useRef(false);

  const toast = useCallback((message: string, tone: "ok" | "error" = "ok") => {
    if (tone === "error") {
      notch.error(message, { duration: 6000, dismissible: true });
      return;
    }
    notch.success(message);
  }, []);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    localStorage.setItem("omnibrain.theme.v2", theme);
  }, [theme]);

  useEffect(() => {
    document.documentElement.dataset.accent = accent;
    localStorage.setItem("omnibrain.accent.v2", accent);
  }, [accent]);

  useEffect(() => {
    localStorage.setItem("omnibrain.view.v2", view);
  }, [view]);

  useEffect(() => {
    localStorage.setItem("omnibrain.panelWidth.v2", String(panelWidth));
  }, [panelWidth]);

  useEffect(() => {
    localStorage.setItem("omnibrain.itemLayout.v3", itemLayout);
  }, [itemLayout]);

  // The URL is the shareable source of truth for view/filters; history keeps back/forward working.
  useEffect(() => {
    const params = new URLSearchParams();
    if (view !== "knowledge") params.set("view", view);
    if (itemStatus !== "active") params.set("status", itemStatus);
    if (sourceFilter !== "all") params.set("source", sourceFilter);
    if (itemLayout !== "grid") params.set("layout", itemLayout);
    if (atlasFilter) {
      params.set("fstart", String(atlasFilter.start));
      params.set("fend", String(atlasFilter.end));
      params.set("flabel", atlasFilter.label);
      if (atlasFilter.sources?.length) params.set("fsrc", atlasFilter.sources.join(","));
    }
    const qs = params.toString();
    const next = `${window.location.pathname}${qs ? `?${qs}` : ""}${window.location.hash}`;
    const current = `${window.location.pathname}${window.location.search}${window.location.hash}`;
    if (next !== current) {
      // Normalize the incoming URL without adding a history entry; later changes are navigations.
      if (urlSynced.current) window.history.pushState(null, "", next);
      else window.history.replaceState(null, "", next);
    }
    urlSynced.current = true;
  }, [view, itemStatus, sourceFilter, itemLayout, atlasFilter]);

  useEffect(() => {
    const onPop = () => {
      const params = urlParams();
      const nextView = params.get("view");
      setView(VIEWS.has(nextView as View) ? (nextView as View) : "knowledge");
      const nextStatus = params.get("status");
      setItemStatus(STATUSES.has(nextStatus as ItemStatus) ? (nextStatus as ItemStatus) : "active");
      setSourceFilter(params.get("source") ?? "all");
      const nextLayout = params.get("layout");
      setItemLayout(LAYOUTS.has(nextLayout as ItemLayout) ? (nextLayout as ItemLayout) : "grid");
      setAtlasFilter(readFilter(params));
      setSelectedId(null);
    };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  const navigate = useCallback(
    (next: View) => {
      if (next === view) return;
      const doc = document as Document & {
        startViewTransition?: (callback: () => void) => unknown;
      };
      if (
        !doc.startViewTransition ||
        window.matchMedia("(prefers-reduced-motion: reduce)").matches
      ) {
        setView(next);
        return;
      }
      doc.startViewTransition(() => flushSync(() => setView(next)));
    },
    [view],
  );

  const bootMe = useCallback(async () => {
    setBoot("loading");
    setBootError(null);
    try {
      const res = await api.me();
      setMe(res);
      setBoot("ready");
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        setMe(null);
        setBoot("ready");
      } else {
        setBootError(err instanceof Error ? err.message : "Could not reach the API");
        setBoot("error");
      }
    }
  }, []);

  useEffect(() => {
    void bootMe();
  }, [bootMe]);

  const refresh = useCallback(async () => {
    refreshAbort.current?.abort();
    const controller = new AbortController();
    refreshAbort.current = controller;
    setItemsLoading(true);
    // A status switch must not show the previous bucket while the new one loads.
    if (lastStatus.current !== itemStatus) {
      lastStatus.current = itemStatus;
      setItems([]);
      setTotal(0);
      setNextCursor(null);
    }
    try {
      const [list, acct] = await Promise.all([
        api.items({ limit: 100, status: itemStatus }, controller.signal),
        api.account(controller.signal),
      ]);
      if (controller.signal.aborted) return;
      setItems(list.items);
      setTotal(list.total);
      setNextCursor(list.nextCursor);
      setKnownSources((prev) => {
        const next = new Set(prev);
        for (const item of list.items) next.add(item.source);
        return next.size === prev.length ? prev : [...next];
      });
      setAccount(acct);
      setMe((prev) =>
        prev && prev.workspace.plan !== acct.workspace.plan
          ? { ...prev, workspace: { ...prev.workspace, plan: acct.workspace.plan } }
          : prev,
      );
    } catch (err) {
      if (isAbort(err)) return;
      throw err;
    } finally {
      if (refreshAbort.current === controller) {
        refreshAbort.current = null;
        setItemsLoading(false);
      }
    }
  }, [itemStatus]);

  useEffect(() => {
    if (!me) return;
    void refresh().catch((err) => {
      if (isAbort(err)) return;
      if (err instanceof ApiError && err.status === 401) {
        setMe(null);
      } else {
        toast(err instanceof Error ? err.message : "Could not load your library", "error");
      }
    });
  }, [me, refresh, toast]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setRecallSeed("");
        setRecallOpen((open) => !open);
      }
      if (e.key === "Escape") setRecallOpen(false);
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);

  const sources = useMemo(() => {
    const counts = new Map<string, number>();
    for (const item of items) counts.set(item.source, (counts.get(item.source) ?? 0) + 1);
    return [...counts.entries()].toSorted((a, b) => b[1] - a[1]);
  }, [items]);

  const selected = items.find((item) => item.id === selectedId) ?? null;

  const openRecall = (seed = "") => {
    setRecallSeed(seed);
    setRecallOpen(true);
  };

  const openItem = useCallback(
    async (id: string) => {
      setSelectedId(id);
      navigate("knowledge");
      if (!items.some((item) => item.id === id)) {
        try {
          const res = await api.item(id);
          setItems((prev) => [res.item, ...prev]);
        } catch {
          // The inspector shows an empty state if the item vanishes.
        }
      }
    },
    [items, navigate],
  );

  /** Stable row selection callback keeps memoized items from re-rendering. */
  const selectItem = useCallback(
    (id: string) => {
      void openItem(id);
    },
    [openItem],
  );

  /** Remove a row from the current status list before the network settles. */
  const dropItem = useCallback((id: string) => {
    setItems((prev) => prev.filter((item) => item.id !== id));
    setTotal((prev) => Math.max(0, prev - 1));
  }, []);

  const deleteItem = useCallback(
    async (id: string) => {
      dropItem(id);
      setSelectedId(null);
      try {
        await api.deleteItem(id);
        toast("Moved to trash. Purged after 30 days.");
      } catch (err) {
        void refresh().catch(() => undefined);
        toast(err instanceof ApiError ? err.message : "Delete failed", "error");
      }
    },
    [dropItem, refresh, toast],
  );

  const setArchived = useCallback(
    async (id: string, archived: boolean) => {
      dropItem(id);
      setSelectedId(null);
      try {
        await (archived ? api.archiveItem(id) : api.unarchiveItem(id));
        toast(archived ? "Archived. Find it under Archived." : "Back in the active stream.");
      } catch (err) {
        void refresh().catch(() => undefined);
        toast(err instanceof ApiError ? err.message : "Archive failed", "error");
      }
    },
    [dropItem, refresh, toast],
  );

  const restoreItem = useCallback(
    async (id: string) => {
      dropItem(id);
      setSelectedId(null);
      try {
        await api.restoreItem(id);
        toast("Restored to your library.");
      } catch (err) {
        void refresh().catch(() => undefined);
        toast(err instanceof ApiError ? err.message : "Restore failed", "error");
      }
    },
    [dropItem, refresh, toast],
  );

  const purgeItem = useCallback(
    async (id: string) => {
      if (!window.confirm("Delete this item permanently? This cannot be undone.")) return;
      dropItem(id);
      setSelectedId(null);
      try {
        await api.purgeItem(id);
        toast("Deleted permanently.");
      } catch (err) {
        void refresh().catch(() => undefined);
        toast(err instanceof ApiError ? err.message : "Delete failed", "error");
      }
    },
    [dropItem, refresh, toast],
  );

  const retryItem = useCallback(
    async (id: string) => {
      setItems((prev) =>
        prev.map((item) => (item.id === id ? { ...item, embedding_state: "pending" } : item)),
      );
      try {
        await api.retryItem(id);
        toast("Re-enrichment queued.");
      } catch (err) {
        void refresh().catch(() => undefined);
        toast(err instanceof ApiError ? err.message : "Retry failed", "error");
      }
    },
    [refresh, toast],
  );

  const archiveItem = useCallback((id: string) => void setArchived(id, true), [setArchived]);
  const unarchiveItem = useCallback((id: string) => void setArchived(id, false), [setArchived]);
  const trashItem = useCallback((id: string) => void deleteItem(id), [deleteItem]);
  const restoreOnly = useCallback((id: string) => void restoreItem(id), [restoreItem]);
  const purgeOnly = useCallback((id: string) => void purgeItem(id), [purgeItem]);

  const loadMore = useCallback(async () => {
    if (!nextCursor || loadingMore) return;
    setLoadingMore(true);
    try {
      const res = await api.items({ limit: 100, cursor: nextCursor, status: itemStatus });
      setItems((prev) => [...prev, ...res.items]);
      setNextCursor(res.nextCursor);
    } catch (err) {
      toast(err instanceof ApiError ? err.message : "Could not load more", "error");
    } finally {
      setLoadingMore(false);
    }
  }, [nextCursor, loadingMore, toast, itemStatus]);

  const signOut = useCallback(() => {
    setMe(null);
    setItems([]);
    setTotal(0);
    setNextCursor(null);
    setAccount(null);
    setSelectedId(null);
    setView("knowledge");
    setAtlasFilter(null);
    setSourceFilter("all");
    setItemStatus("active");
    setRecallOpen(false);
    setNoteOpen(false);
  }, []);

  if (boot !== "ready") {
    return <BootSplash error={boot === "error" ? bootError : null} onRetry={() => void bootMe()} />;
  }

  if (!me) {
    return (
      <AuthScreen
        onAuthed={(next) => {
          setMe(next);
          setBoot("ready");
          setView("knowledge");
        }}
      />
    );
  }

  const selectSource = (source: string) => {
    setSourceFilter(source);
    navigate("knowledge");
    setAtlasFilter(null);
  };

  const applyAtlasFilter = (filter: AtlasFilter | null) => {
    setAtlasFilter(filter);
    setSourceFilter("all");
  };

  return (
    <div className="relative z-10 flex h-full min-h-0">
      <Rail
        me={me}
        view={view}
        status={itemStatus}
        sources={sources}
        source={sourceFilter}
        onNavigate={navigate}
        onStatus={(next) => {
          setSelectedId(null);
          setItemStatus(next);
        }}
        onSelectSource={selectSource}
      />

      <div className="flex min-w-0 flex-1 flex-col">
        <TopBar
          me={me}
          view={view}
          theme={theme}
          onCycleTheme={() =>
            setTheme(
              (current) =>
                THEME_ORDER[(THEME_ORDER.indexOf(current) + 1) % THEME_ORDER.length] ?? "ink",
            )
          }
          onRecall={() => openRecall("")}
          onCapture={() => openRecall("")}
          onNote={() => setNoteOpen(true)}
          onImport={() => {
            setImportPreferred(null);
            navigate("import");
          }}
          onSettings={() => navigate("settings")}
        />

        <div className="relative flex min-h-0 flex-1">
          <main className="min-w-0 flex-1 overflow-y-auto pb-16 md:pb-0">
            <Suspense fallback={<SectionLoading label="Loading section" />}>
              {view === "knowledge" ? (
                itemsLoading && items.length === 0 ? (
                  <SectionLoading label="Loading your library" />
                ) : (
                  <Knowledge
                    items={items}
                    total={total}
                    selectedId={selectedId}
                    onSelect={selectItem}
                    onCloseInspector={() => setSelectedId(null)}
                    filter={atlasFilter}
                    onFilter={applyAtlasFilter}
                    source={sourceFilter}
                    onSource={selectSource}
                    onArchive={archiveItem}
                    onUnarchive={unarchiveItem}
                    onTrash={trashItem}
                    onRestore={restoreOnly}
                    onPurge={purgeOnly}
                    status={itemStatus}
                    layout={itemLayout}
                    onLayout={setItemLayout}
                    allSources={knownSources}
                    onOpenRecall={() => openRecall("")}
                    onNavigateImport={() => {
                      setImportPreferred(null);
                      navigate("import");
                    }}
                    theme={theme}
                    hasMore={Boolean(nextCursor)}
                    loadingMore={loadingMore}
                    onLoadMore={loadMore}
                  />
                )
              ) : null}

              {view === "apps" ? (
                <AppsView
                  toast={toast}
                  onNavigateImport={(appId) => {
                    setImportPreferred(appId);
                    navigate("import");
                  }}
                  onChanged={() => void refresh()}
                  preferred={null}
                />
              ) : null}

              {view === "import" ? (
                <ImportView
                  toast={toast}
                  onChanged={() => void refresh()}
                  preferred={importPreferred}
                />
              ) : null}

              {view === "mcp" ? (
                <Suspense
                  fallback={
                    <div className="mx-auto w-full max-w-3xl p-4 font-mono text-[10px] text-faint">
                      Loading MCP…
                    </div>
                  }
                >
                  <McpView toast={toast} account={account} />
                </Suspense>
              ) : null}

              {view === "settings" ? (
                itemsLoading && !account ? (
                  <SectionLoading label="Loading settings" />
                ) : (
                  <SettingsView
                    account={account}
                    theme={theme}
                    onTheme={setTheme}
                    accent={accent}
                    onAccent={setAccent}
                    onSignedOut={signOut}
                    onPlanChanged={() => void refresh()}
                    toast={toast}
                  />
                )
              ) : null}
            </Suspense>
          </main>

          {view === "knowledge" && selected ? (
            <Inspector
              item={selected}
              width={panelWidth}
              onWidthChange={setPanelWidth}
              onDelete={deleteItem}
              onRetry={retryItem}
              onRestore={restoreItem}
              onOpenItem={selectItem}
              onClose={() => setSelectedId(null)}
            />
          ) : null}
        </div>
      </div>

      <MobileNav view={view} onNavigate={navigate} />

      <Recall
        open={recallOpen}
        seed={recallSeed}
        recent={items.filter((item) => !item.deleted_at && !item.archived_at).slice(0, 5)}
        onClose={() => setRecallOpen(false)}
        onOpenItem={selectItem}
        onNavigate={navigate}
        onCaptured={() => void refresh()}
        onTheme={setTheme}
        theme={theme}
        toast={toast}
      />

      {noteOpen ? (
        <Suspense fallback={null}>
          <NoteCapture
            open
            onClose={() => setNoteOpen(false)}
            onSaved={() => {
              setNoteOpen(false);
              navigate("knowledge");
              void refresh();
              toast("Note saved to your library.");
            }}
          />
        </Suspense>
      ) : null}
    </div>
  );
}
