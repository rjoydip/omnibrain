import { Button, Menu, MenuContent, MenuItem, MenuTrigger, Tooltip } from "@omnibrain/ui";
import {
  AppsIcon,
  ArchiveIcon,
  AtlasIcon,
  BrandMark,
  ChevronDownIcon,
  ContrastIcon,
  ImportIcon,
  McpIcon,
  MoonIcon,
  PlusIcon,
  SearchIcon,
  SettingsIcon,
  SparkIcon,
  StreamIcon,
  SunIcon,
  TrashIcon,
} from "./icons";
import { Fragment, type ReactNode } from "react";
import type { Me } from "../lib/api";
import { initials, sourceMeta } from "../lib/format";
import { type ItemStatus, type Theme, VIEW_LABEL, type View } from "../lib/nav";
import { SourceGlyph } from "./SourceGlyph";

const NAV: Array<{
  view: View;
  label: string;
  icon: (p: { size?: number; className?: string }) => ReactNode;
}> = [
  { view: "knowledge", label: "Knowledge", icon: AtlasIcon },
  { view: "apps", label: "App Store", icon: AppsIcon },
  { view: "import", label: "Import", icon: ImportIcon },
  { view: "mcp", label: "MCP", icon: McpIcon },
  { view: "settings", label: "Settings", icon: SettingsIcon },
];

export function Rail({
  me,
  view,
  status,
  sources,
  source,
  onNavigate,
  onStatus,
  onSelectSource,
}: {
  me: Me;
  view: View;
  status: ItemStatus;
  sources: Array<[string, number]>;
  source: string;
  onNavigate: (view: View) => void;
  onStatus: (status: ItemStatus) => void;
  onSelectSource: (source: string) => void;
}) {
  return (
    <aside className="relative z-20 hidden shrink-0 flex-col bg-panel md:flex md:w-[60px] lg:w-[196px]">
      <div className="flex h-12 items-center gap-2.5 px-3 lg:px-4">
        <div className="grid size-7 shrink-0 place-items-center rounded-[var(--radius)] border border-line bg-panel">
          <BrandMark size={16} className="text-signal" />
        </div>
        <div className="hidden min-w-0 lg:block">
          <p className="truncate text-[13px] font-semibold tracking-tight">OmniBrain</p>
          <p className="font-mono text-[9px] uppercase tracking-[0.18em] text-faint">
            recall layer
          </p>
        </div>
      </div>

      <nav className="flex-1 space-y-0.5 overflow-y-auto p-2" aria-label="Primary">
        {NAV.map((item) => {
          const Icon = item.icon;
          const knowledge = item.view === "knowledge";
          return (
            <Fragment key={item.view}>
              <button
                type="button"
                onClick={() => {
                  onNavigate(item.view);
                  if (knowledge) onStatus("active");
                }}
                data-active={view === item.view && (!knowledge || status === "active")}
                className="rail-item"
              >
                <Icon size={16} className="rail-glyph" />
                <span className="hidden lg:inline">{item.label}</span>
              </button>
              {item.view === "mcp" ? (
                <>
                  <button
                    type="button"
                    onClick={() => {
                      onNavigate("knowledge");
                      onStatus("archived");
                    }}
                    data-active={view === "knowledge" && status === "archived"}
                    className="rail-item"
                  >
                    <ArchiveIcon size={16} className="rail-glyph" />
                    <span className="hidden lg:inline">Archived</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      onNavigate("knowledge");
                      onStatus("trash");
                    }}
                    data-active={view === "knowledge" && status === "trash"}
                    className="rail-item"
                  >
                    <TrashIcon size={16} className="rail-glyph" />
                    <span className="hidden lg:inline">Trash</span>
                  </button>
                </>
              ) : null}
            </Fragment>
          );
        })}

        <div className="my-3 hidden pt-3 lg:block">
          <div className="flex items-center justify-between px-2 pb-1">
            <p className="font-mono text-[9px] uppercase tracking-[0.16em] text-faint">Sources</p>
            <button
              type="button"
              onClick={() => onNavigate("apps")}
              className="font-mono text-[9px] text-faint transition hover:text-text"
            >
              Manage
            </button>
          </div>
          <div className="max-h-56 space-y-0.5 overflow-y-auto pr-0.5">
            {sources.map(([item, count]) => {
              const meta = sourceMeta(item);
              const active = source === item;
              return (
                <button
                  key={item}
                  type="button"
                  onClick={() => onSelectSource(active ? "all" : item)}
                  aria-pressed={active}
                  className={`flex w-full items-center gap-2 rounded px-2 py-1 text-left text-[11px] transition ${
                    active
                      ? "bg-signal/15 font-medium text-text"
                      : "text-muted hover:bg-raised hover:text-text"
                  }`}
                >
                  <span
                    className={`grid size-4 shrink-0 place-items-center rounded-[4px] transition-colors ${
                      active ? "bg-signal text-signal-ink" : "text-accent"
                    }`}
                  >
                    <SourceGlyph id={item} size={11} />
                  </span>
                  <span className="min-w-0 flex-1 truncate">{meta.label}</span>
                  <span className={`font-mono text-[10px] ${active ? "text-text" : "text-faint"}`}>
                    {count}
                  </span>
                </button>
              );
            })}
          </div>
          {sources.length === 0 ? (
            <p className="px-2 py-1 text-[10.5px] text-faint">No captures yet</p>
          ) : null}
        </div>
      </nav>

      <div className="p-2">
        <button
          type="button"
          onClick={() => onNavigate("settings")}
          className="mt-0.5 flex w-full items-center gap-2 rounded-[8px] p-2 text-left transition hover:bg-raised"
          aria-label="Open account settings"
        >
          <span className="grid size-7 shrink-0 place-items-center rounded-full border border-line bg-raised font-mono text-[10px] text-signal">
            {initials(me.user.email)}
          </span>
          <span className="hidden min-w-0 lg:block">
            <span className="block truncate text-[11px] text-text">{me.user.email}</span>
            <span className="font-mono text-[9px] uppercase tracking-wider text-faint">
              {me.workspace.plan} plan
            </span>
          </span>
        </button>
      </div>
    </aside>
  );
}

export function TopBar({
  me,
  view,
  theme,
  onCycleTheme,
  onRecall,
  onCapture,
  onNote,
  onImport,
  onSettings,
}: {
  me: Me;
  view: View;
  theme: Theme;
  onCycleTheme: () => void;
  onRecall: () => void;
  onCapture: () => void;
  onNote: () => void;
  onImport: () => void;
  onSettings: () => void;
}) {
  return (
    <header className="sticky top-0 z-30 flex h-12 shrink-0 items-center justify-between gap-3 bg-canvas px-3 md:px-5">
      <div className="flex min-w-0 items-center gap-2.5">
        <div className="grid size-7 place-items-center rounded-[8px] border border-line bg-panel md:hidden">
          <AtlasIcon size={14} className="text-signal" />
        </div>
        <div className="min-w-0">
          <div className="flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-wider text-faint">
            <span className="max-w-[120px] truncate">{me.workspace.name}</span>
            <span>/</span>
            <span className="text-muted">{VIEW_LABEL[view]}</span>
          </div>
          <p className="hidden text-[11.5px] font-medium text-text sm:block">
            {view === "knowledge"
              ? "Everything you meant to remember"
              : view === "apps"
                ? "Sources with a real lifecycle"
                : view === "import"
                  ? "Parse locally, store deliberately"
                  : view === "mcp"
                    ? "Let your agents read your own corpus"
                    : "Account, usage and data"}
          </p>
        </div>
      </div>

      <div className="flex items-center gap-2">
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={onRecall}
          className="gap-2 bg-panel text-muted sm:w-56 sm:justify-start"
          aria-label="Open recall search"
        >
          <SearchIcon size={13} />
          <span className="hidden sm:inline">Recall</span>
          <span className="kbd ml-0.5 hidden sm:ml-auto sm:inline">⌘K</span>
        </Button>

        <div className="flex items-stretch rounded-[var(--radius)] bg-signal text-signal-ink">
          <button
            type="button"
            onClick={onCapture}
            className="capture-btn group flex items-center gap-1.5 rounded-l-[var(--radius)] py-1.5 pr-2 pl-2.5 text-[11.5px] font-semibold transition hover:brightness-105"
          >
            <span className="relative grid size-4 place-items-center">
              <span className="absolute inset-0 rounded-full border border-current opacity-45 transition-[transform,opacity] duration-300 group-hover:scale-150 group-hover:opacity-0" />
              <PlusIcon
                size={12}
                className="transition-transform duration-300 group-hover:rotate-90"
              />
            </span>
            <span className="hidden sm:inline">Capture</span>
          </button>
          <span className="my-1 w-px bg-signal-ink/25" aria-hidden="true" />
          <Menu>
            <MenuTrigger asChild>
              <button
                type="button"
                aria-label="More capture options"
                className="grid w-6 place-items-center rounded-r-[var(--radius)] transition hover:bg-signal-ink/10"
              >
                <ChevronDownIcon size={12} />
              </button>
            </MenuTrigger>
            <MenuContent>
              <MenuItem onSelect={onNote}>
                <SparkIcon size={13} className="text-accent" />
                Write a note
              </MenuItem>
              <MenuItem onSelect={onCapture}>
                <PlusIcon size={13} className="text-accent" />
                Capture a link
              </MenuItem>
              <MenuItem onSelect={onImport}>
                <ImportIcon size={13} className="text-accent" />
                Import bookmarks
              </MenuItem>
            </MenuContent>
          </Menu>
        </div>
        <button
          type="button"
          onClick={onSettings}
          className="grid size-7 place-items-center rounded-full border border-line bg-raised font-mono text-[10px] text-signal md:hidden"
          aria-label="Account"
        >
          {initials(me.user.email)}
        </button>
        <Tooltip label={`Theme: ${theme} — click to change`}>
          <button
            type="button"
            onClick={onCycleTheme}
            aria-label={`Change theme, current ${theme}`}
            className="grid size-7 place-items-center rounded-[var(--radius)] bg-panel text-accent transition hover:bg-raised"
          >
            {theme === "ink" ? (
              <MoonIcon size={14} />
            ) : theme === "paper" ? (
              <SunIcon size={14} />
            ) : (
              <ContrastIcon size={14} />
            )}
          </button>
        </Tooltip>
      </div>
    </header>
  );
}

export function MobileNav({ view, onNavigate }: { view: View; onNavigate: (view: View) => void }) {
  return (
    <nav
      className="fixed inset-x-0 bottom-0 z-30 flex bg-panel pb-[env(safe-area-inset-bottom)] md:hidden"
      aria-label="Primary"
    >
      {NAV.map((item) => {
        const Icon = item.icon;
        return (
          <button
            key={item.view}
            type="button"
            onClick={() => onNavigate(item.view)}
            className={`flex flex-1 flex-col items-center gap-1 py-1.5 text-[9px] ${
              view === item.view ? "text-signal" : "text-faint"
            }`}
            aria-current={view === item.view ? "page" : undefined}
          >
            <Icon size={16} />
            {item.label}
          </button>
        );
      })}
    </nav>
  );
}

export function BootSplash({ error, onRetry }: { error: string | null; onRetry: () => void }) {
  return (
    <div className="relative z-10 grid min-h-full place-items-center p-6">
      <div className="text-center">
        <div className="relative mx-auto mb-5 size-20">
          <div className="absolute inset-0 rounded-full border border-line" />
          <div className="absolute inset-3 rounded-full border border-line" />
          <div className="absolute inset-6 rounded-full border border-line" />
          <div
            className={`absolute inset-[44%] rounded-full ${
              error ? "bg-coral" : "animate-pulse bg-signal"
            }`}
          />
        </div>
        <p className="text-sm font-medium text-text">OmniBrain</p>
        <p className="mt-1 font-mono text-[10px] uppercase tracking-[0.18em] text-faint">
          {error ? "api unreachable" : "opening your library"}
        </p>
        {error ? (
          <div className="mt-4 max-w-sm">
            <p className="text-xs leading-relaxed text-coral">{error}</p>
            <button
              type="button"
              onClick={onRetry}
              className="mt-3 rounded-[var(--radius)] px-3 py-1.5 text-xs text-text hover:bg-raised"
            >
              Retry
            </button>
            <p className="mt-3 font-mono text-[10px] text-faint">
              Start the API with <span className="text-muted">bun run dev</span>
            </p>
          </div>
        ) : null}
      </div>
    </div>
  );
}

export { StreamIcon };
