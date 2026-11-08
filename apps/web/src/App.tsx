import { lazy, Suspense, useCallback, useEffect, useMemo, useState } from "react";
import { toast as notch } from "notch-toast";
import type { AtlasFilter } from "./components/Atlas";
import { Recall } from "./components/Recall";
import { BootSplash, MobileNav, Rail, TopBar } from "./components/Shell";
import { type Account, ApiError, api, type Item, type Me } from "./lib/api";
import { sourceMeta } from "./lib/format";
import type { Accent, ItemLayout, ItemStatus, Theme, View } from "./lib/nav";
import { AppsView } from "./views/Apps";
import { AuthScreen } from "./views/Auth";
import { ImportView } from "./views/Import";
import { Inspector } from "./views/Inspector";
import { Knowledge } from "./views/Knowledge";
import { SettingsView } from "./views/Settings";

const McpView = lazy(() => import("./views/Mcp").then((m) => ({ default: m.McpView })));
const NoteCapture = lazy(() =>
  import("./components/NoteCapture").then((m) => ({ default: m.NoteCapture })),
);

const THEME_ORDER: Theme[] = ["ink", "paper", "contrast"];
const ACCENT_IDS = new Set<Accent>(["cobalt", "amber", "mint", "coral", "violet", "slate"]);
const VIEWS = new Set<View>(["knowledge", "apps", "import", "mcp", "settings"]);

function initialView(): View {
  const stored = localStorage.getItem("omnibrain.view.v2");
  return VIEWS.has(stored as View) ? (stored as View) : "knowledge";
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
  const [total, setTotal] = useState(0);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [account, setAccount] = useState<Account | null>(null);

  const [view, setView] = useState<View>(initialView);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [atlasFilter, setAtlasFilter] = useState<AtlasFilter | null>(null);
  const [sourceFilter, setSourceFilter] = useState("all");
  const [itemStatus, setItemStatus] = useState<ItemStatus>("active");
  const [itemLayout, setItemLayout] = useState<ItemLayout>(() => {
    const stored = localStorage.getItem("omnibrain.itemLayout.v3");
    return stored === "list" || stored === "graph" ? stored : "grid";
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
    const [list, acct] = await Promise.all([
      api.items({ limit: 100, status: itemStatus }),
      api.account(),
    ]);
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
  }, [itemStatus]);

  useEffect(() => {
    if (!me) return;
    void refresh().catch((err) => {
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
      setView("knowledge");
      if (!items.some((item) => item.id === id)) {
        try {
          const res = await api.item(id);
          setItems((prev) => [res.item, ...prev]);
        } catch {
          // The inspector shows an empty state if the item vanishes.
        }
      }
    },
    [items],
  );

  const deleteItem = useCallback(
    async (id: string) => {
      try {
        await api.deleteItem(id);
        setSelectedId(null);
        await refresh();
        toast("Moved to trash. Purged after 30 days.");
      } catch (err) {
        toast(err instanceof ApiError ? err.message : "Delete failed", "error");
      }
    },
    [refresh, toast],
  );

  const setArchived = useCallback(
    async (id: string, archived: boolean) => {
      try {
        await (archived ? api.archiveItem(id) : api.unarchiveItem(id));
        setSelectedId(null);
        await refresh();
        toast(archived ? "Archived. Find it under Archived." : "Back in the active stream.");
      } catch (err) {
        toast(err instanceof ApiError ? err.message : "Archive failed", "error");
      }
    },
    [refresh, toast],
  );

  const restoreItem = useCallback(
    async (id: string) => {
      try {
        await api.restoreItem(id);
        setSelectedId(null);
        await refresh();
        toast("Restored to your library.");
      } catch (err) {
        toast(err instanceof ApiError ? err.message : "Restore failed", "error");
      }
    },
    [refresh, toast],
  );

  const purgeItem = useCallback(
    async (id: string) => {
      if (!window.confirm("Delete this item permanently? This cannot be undone.")) return;
      try {
        await api.purgeItem(id);
        setSelectedId(null);
        await refresh();
        toast("Deleted permanently.");
      } catch (err) {
        toast(err instanceof ApiError ? err.message : "Delete failed", "error");
      }
    },
    [refresh, toast],
  );

  const retryItem = useCallback(
    async (id: string) => {
      try {
        await api.retryItem(id);
        toast("Re-enrichment queued.");
        setTimeout(() => void refresh(), 1500);
      } catch (err) {
        toast(err instanceof ApiError ? err.message : "Retry failed", "error");
      }
    },
    [refresh, toast],
  );

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
    setView("knowledge");
    if (source === "all") {
      setAtlasFilter(null);
      return;
    }
    setAtlasFilter({
      start: 0,
      end: Date.now() + 3650 * 86_400_000,
      sources: [source],
      label: `${sourceMeta(source).label} · all time`,
    });
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
        onNavigate={setView}
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
            setView("import");
          }}
          onSettings={() => setView("settings")}
        />

        <div className="relative flex min-h-0 flex-1">
          <main className="min-w-0 flex-1 overflow-y-auto pb-16 md:pb-0">
            {view === "knowledge" ? (
              <Knowledge
                items={items}
                total={total}
                selectedId={selectedId}
                onSelect={(id) => void openItem(id)}
                onCloseInspector={() => setSelectedId(null)}
                filter={atlasFilter}
                onFilter={applyAtlasFilter}
                source={sourceFilter}
                onSource={selectSource}
                onArchive={(id) => void setArchived(id, true)}
                onUnarchive={(id) => void setArchived(id, false)}
                onTrash={(id) => void deleteItem(id)}
                onRestore={(id) => void restoreItem(id)}
                onPurge={(id) => void purgeItem(id)}
                status={itemStatus}
                layout={itemLayout}
                onLayout={setItemLayout}
                allSources={knownSources}
                onOpenRecall={() => openRecall("")}
                onNavigateImport={() => {
                  setImportPreferred(null);
                  setView("import");
                }}
                theme={theme}
                hasMore={Boolean(nextCursor)}
                loadingMore={loadingMore}
                onLoadMore={loadMore}
              />
            ) : null}

            {view === "apps" ? (
              <AppsView
                toast={toast}
                onNavigateImport={(appId) => {
                  setImportPreferred(appId);
                  setView("import");
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
            ) : null}
          </main>

          {view === "knowledge" && selected ? (
            <Inspector
              item={selected}
              width={panelWidth}
              onWidthChange={setPanelWidth}
              onDelete={deleteItem}
              onRetry={retryItem}
              onOpenItem={(id) => void openItem(id)}
              onClose={() => setSelectedId(null)}
            />
          ) : null}
        </div>
      </div>

      <MobileNav view={view} onNavigate={setView} />

      <Recall
        open={recallOpen}
        seed={recallSeed}
        recent={items.filter((item) => !item.deleted_at && !item.archived_at).slice(0, 5)}
        onClose={() => setRecallOpen(false)}
        onOpenItem={(id) => void openItem(id)}
        onNavigate={setView}
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
              setView("knowledge");
              void refresh();
              toast("Note saved to your library.");
            }}
          />
        </Suspense>
      ) : null}
    </div>
  );
}
