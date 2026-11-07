import {
  Badge,
  Button,
  Input,
  Modal,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Tooltip,
} from "@omnibrain/ui";
import { useCallback, useEffect, useMemo, useState } from "react";
import { JsonBlock } from "../components/CodeBlock";
import {
  ActivityIcon,
  CheckIcon,
  ChevronDownIcon,
  CopyIcon,
  EyeIcon,
  EyeOffIcon,
  LinkIcon,
  LockIcon,
  McpIcon,
  PlusIcon,
  SearchIcon,
  SparkIcon,
  TrashIcon,
} from "../components/icons";
import {
  ApiError,
  type Account,
  type ApiKey,
  type McpEvent,
  api,
  callMcp,
  mcpEndpoint,
} from "../lib/api";
import { relativeTime } from "../lib/format";

const TOOLS = [
  {
    name: "omnibrain_search",
    body: "Ranked items with URLs and excerpts, filtered by source or date.",
    args: ["query", "limit", "source", "since"],
    write: false,
    icon: SearchIcon,
  },
  {
    name: "omnibrain_fetch",
    body: "Full extracted text for one saved item id.",
    args: ["id"],
    write: false,
    icon: LinkIcon,
  },
  {
    name: "omnibrain_recent",
    body: "The latest captures, newest first.",
    args: ["limit"],
    write: false,
    icon: ActivityIcon,
  },
  {
    name: "omnibrain_save_note",
    body: "Write a note or link back into the workspace.",
    args: ["text", "url", "tags"],
    write: true,
    icon: PlusIcon,
  },
] as const;

function eventLabel(event: McpEvent): string {
  if (event.event === "connect") return "client connected";
  if (event.event === "tools_list") return "tools listed";
  if (event.event === "tool_call") return event.tool ?? "tool call";
  if (event.event === "error") return "request failed";
  return event.event;
}

const RAW_KEYS_KEY = "omnibrain.mcpRawKeys.v1";
const ACTIVE_KEY = "omnibrain.mcpActiveKey.v1";

/** Raw secrets only ever exist client-side; keep them for this tab (refresh-safe). */
function loadRawKeys(): Record<string, string> {
  try {
    const raw = sessionStorage.getItem(RAW_KEYS_KEY);
    return raw ? (JSON.parse(raw) as Record<string, string>) : {};
  } catch {
    return {};
  }
}

function fullTime(ts: number): string {
  return new Date(ts).toLocaleString(undefined, {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

function prettyDetail(detail: string): string {
  try {
    return JSON.stringify(JSON.parse(detail), null, 2);
  } catch {
    return detail;
  }
}

export function McpView({
  toast,
  account,
}: {
  toast: (message: string, tone?: "ok" | "error") => void;
  account: Account | null;
}) {
  const [keys, setKeys] = useState<ApiKey[]>([]);
  const [name, setName] = useState("");
  const [activeKeyId, setActiveKeyId] = useState<string | null>(() => {
    try {
      return sessionStorage.getItem(ACTIVE_KEY);
    } catch {
      return null;
    }
  });
  const [rawKeys, setRawKeys] = useState<Record<string, string>>(loadRawKeys);
  const [revealed, setRevealed] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [query, setQuery] = useState("what did I save about vector search?");
  const [testResult, setTestResult] = useState<string | null>(null);
  const [testing, setTesting] = useState(false);

  const [logsOpen, setLogsOpen] = useState(false);
  const [logsLoading, setLogsLoading] = useState(false);
  const [logsEvents, setLogsEvents] = useState<McpEvent[]>([]);
  const [logKey, setLogKey] = useState("all");
  const [logSearch, setLogSearch] = useState("");
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const load = useCallback(async () => {
    try {
      const res = await api.keys();
      setKeys(res.keys.filter((key) => !key.revoked_at));
    } catch (err) {
      toast(err instanceof ApiError ? err.message : "Could not load keys", "error");
    }
  }, [toast]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    try {
      sessionStorage.setItem(RAW_KEYS_KEY, JSON.stringify(rawKeys));
      if (activeKeyId) sessionStorage.setItem(ACTIVE_KEY, activeKeyId);
      else sessionStorage.removeItem(ACTIVE_KEY);
    } catch {
      // Storage may be blocked; keys then live only in memory.
    }
  }, [rawKeys, activeKeyId]);

  const names = useMemo(() => {
    const map = new Map<string, string>();
    for (const key of keys) map.set(key.id, key.name);
    return map;
  }, [keys]);

  const activeKey = keys.find((key) => key.id === activeKeyId) ?? null;
  const activeValue = activeKeyId ? (rawKeys[activeKeyId] ?? "") : "";
  const keyLimit = account?.entitlements.apiKeys?.limit ?? 10;
  const keyLimitLabel = keyLimit === Number.POSITIVE_INFINITY ? "∞" : keyLimit.toLocaleString();
  const atKeyLimit = keys.length >= keyLimit;

  async function openLogs(keyId?: string) {
    setLogsOpen(true);
    setLogKey(keyId ?? "all");
    setLogSearch("");
    setLogsLoading(true);
    setLogsEvents([]);
    setExpanded(new Set());
    try {
      const result = await Promise.all(
        keys.map(async (key) => (await api.keyEvents(key.id)).events),
      );
      setLogsEvents(result.flat());
    } catch (err) {
      toast(err instanceof ApiError ? err.message : "Could not load logs", "error");
    } finally {
      setLogsLoading(false);
    }
  }

  const visibleLogs = useMemo(() => {
    const needle = logSearch.trim().toLowerCase();
    return logsEvents
      .filter((event) => logKey === "all" || event.api_key_id === logKey)
      .filter((event) => {
        if (!needle) return true;
        const haystack = [
          event.event,
          eventLabel(event),
          event.tool,
          event.client_name,
          event.client_version,
          event.status,
          event.detail,
          event.api_key_id ? names.get(event.api_key_id) : null,
        ]
          .filter(Boolean)
          .join(" ")
          .toLowerCase();
        return haystack.includes(needle);
      })
      .toSorted((a, b) => b.created_at - a.created_at);
  }, [logsEvents, logKey, logSearch, names]);

  async function createKey() {
    if (!name.trim()) return;
    setBusy(true);
    try {
      const res = await api.createKey(name.trim());
      setActiveKeyId(res.apiKey.id);
      setRawKeys((prev) => ({ ...prev, [res.apiKey.id]: res.key }));
      setKeys((prev) => [res.apiKey, ...prev]);
      setName("");
      toast("API key created. Reveal or copy it from the key list.", "ok");
    } catch (err) {
      toast(
        err instanceof ApiError
          ? err.message
          : "Could not create key. Check that the API is running.",
        "error",
      );
    } finally {
      setBusy(false);
    }
  }

  async function test() {
    const key = activeValue;
    if (!key) {
      toast("Select an active key from the list above first.", "error");
      return;
    }
    setTesting(true);
    setTestResult(null);
    try {
      const res = await callMcp<{
        result: { content: Array<{ text: string }> };
      }>(mcpEndpoint, key, "tools/call", {
        name: "omnibrain_search",
        arguments: { query, limit: 5 },
      });
      setTestResult(res.result?.content?.[0]?.text ?? JSON.stringify(res, null, 2));
    } catch (err) {
      setTestResult(err instanceof Error ? err.message : "Call failed");
    } finally {
      setTesting(false);
    }
  }

  const config = JSON.stringify(
    {
      mcpServers: {
        omnibrain: {
          type: "http",
          url: mcpEndpoint,
          headers: { Authorization: `Bearer ${activeValue || "<your-key>"}` },
        },
      },
    },
    null,
    2,
  );

  async function copy(value: string, label: string) {
    try {
      await navigator.clipboard.writeText(value);
      toast(`${label} copied.`, "ok");
    } catch {
      toast("Clipboard blocked by the browser.", "error");
    }
  }

  return (
    <div className="mx-auto w-full max-w-3xl space-y-5 p-3 pb-20 md:p-4">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-faint">Agents</p>
          <h1 className="mt-1 text-xl font-semibold tracking-[-0.02em]">MCP Server</h1>
          <p className="mt-1 max-w-xl text-xs leading-relaxed text-muted">
            Streamable HTTP. Your agent searches this workspace only, with the same tenant scoping
            as the web app. Every call is rate-limited and audited.
          </p>
        </div>
        <Badge tone="mint">tool calls metered</Badge>
      </header>

      <div className="panel p-3">
        <div className="flex items-center justify-between gap-2">
          <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-faint">
            Endpoint
          </span>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => void copy(mcpEndpoint, "Endpoint")}
            className="font-mono text-[10px]"
          >
            <CopyIcon size={11} />
            copy
          </Button>
        </div>
        <code className="mt-2 block overflow-x-auto rounded-[var(--radius)] bg-raised px-3 py-2 font-mono text-[12px] text-accent">
          {mcpEndpoint}
        </code>
        <p className="mt-2 font-mono text-[10px] text-faint">
          POST JSON-RPC · Authorization: Bearer ob_… · initialize → tools/list → tools/call
        </p>
      </div>

      <div className="panel p-3">
        <div className="flex items-center justify-between gap-2">
          <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-faint">
            API keys
          </span>
          <div className="flex items-center gap-2">
            <span className="font-mono text-[10px] text-faint">
              {keys.length} / {keyLimitLabel}
            </span>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => void openLogs()}
              className="font-mono text-[10px]"
              disabled={keys.length === 0}
            >
              <ActivityIcon size={12} />
              all logs
            </Button>
          </div>
        </div>

        <div className="mt-3 flex flex-wrap gap-2">
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Key name (e.g. Claude Desktop)"
            className="flex-1"
            aria-label="Key name"
          />
          <Button
            type="button"
            variant="primary"
            size="md"
            onClick={() => void createKey()}
            disabled={busy || !name.trim() || atKeyLimit}
          >
            {busy ? "Creating…" : "Create key"}
          </Button>
        </div>
        {atKeyLimit ? (
          <p className="mt-2 font-mono text-[10px] text-faint">
            {keyLimitLabel} key limit reached on this plan. Remove a key or change plans in
            Settings.
          </p>
        ) : null}

        <ul className="mt-3 divide-y divide-raised">
          {keys.map((key) => {
            const raw = rawKeys[key.id];
            const visible = revealed.has(key.id);
            return (
              <li key={key.id} className="flex flex-wrap items-center gap-x-2 gap-y-1 py-2">
                <Tooltip
                  label={
                    rawKeys[key.id]
                      ? "Use in the test console"
                      : "Secret is shown once — create a new key to test"
                  }
                >
                  <span className="inline-flex shrink-0">
                    <button
                      type="button"
                      onClick={() => setActiveKeyId(key.id)}
                      disabled={!rawKeys[key.id]}
                      aria-pressed={activeKeyId === key.id}
                      aria-label={`Use ${key.name} in the test console`}
                      className={`grid size-4 shrink-0 place-items-center rounded-full border transition ${
                        activeKeyId === key.id
                          ? "border-signal bg-signal text-signal-ink"
                          : rawKeys[key.id]
                            ? "border-line-strong text-transparent hover:border-signal"
                            : "border-line text-faint opacity-70"
                      } disabled:cursor-not-allowed`}
                    >
                      {rawKeys[key.id] ? <CheckIcon size={9} /> : <LockIcon size={8} />}
                    </button>
                  </span>
                </Tooltip>
                <span className="truncate text-[12px] font-medium text-text">{key.name}</span>
                <span className="text-faint">·</span>
                <code className="max-w-[42vw] truncate font-mono text-[10px] text-muted">
                  {raw && visible ? raw : `${key.prefix}••••••••`}
                </code>
                {raw ? (
                  <>
                    <Tooltip label={visible ? "Hide key" : "Reveal key"}>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon-sm"
                        onClick={() =>
                          setRevealed((prev) => {
                            const next = new Set(prev);
                            if (next.has(key.id)) next.delete(key.id);
                            else next.add(key.id);
                            return next;
                          })
                        }
                        aria-label={visible ? "Hide API key" : "Reveal API key"}
                      >
                        {visible ? <EyeOffIcon size={12} /> : <EyeIcon size={12} />}
                      </Button>
                    </Tooltip>
                    <Tooltip label="Copy key">
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon-sm"
                        onClick={() => void copy(raw, "Key")}
                        aria-label="Copy API key"
                      >
                        <CopyIcon size={12} />
                      </Button>
                    </Tooltip>
                  </>
                ) : null}
                <span className="font-mono text-[9.5px] text-faint">
                  used {relativeTime(key.last_used_at)}
                </span>
                <span className="ml-auto flex items-center gap-1">
                  <Tooltip label="View logs">
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-sm"
                      onClick={() => void openLogs(key.id)}
                      aria-label={`View logs for ${key.name}`}
                    >
                      <ActivityIcon size={12} />
                    </Button>
                  </Tooltip>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    onClick={async () => {
                      try {
                        await api.revokeKey(key.id);
                        setKeys((prev) => prev.filter((k) => k.id !== key.id));
                        setRawKeys((prev) => {
                          const next = { ...prev };
                          delete next[key.id];
                          return next;
                        });
                        setRevealed((prev) => {
                          const next = new Set(prev);
                          next.delete(key.id);
                          return next;
                        });
                        if (activeKeyId === key.id) {
                          setActiveKeyId(null);
                        }
                        toast("Key revoked.", "ok");
                      } catch (err) {
                        toast(err instanceof ApiError ? err.message : "Revoke failed", "error");
                      }
                    }}
                    className="hover:text-coral"
                    aria-label={`Revoke ${key.name}`}
                  >
                    <TrashIcon size={12} />
                  </Button>
                </span>
              </li>
            );
          })}
          {keys.length === 0 ? <li className="py-3 text-[11px] text-faint">No keys yet.</li> : null}
        </ul>
      </div>

      <div className="grid gap-2.5 md:grid-cols-2">
        <div className="panel p-3">
          <div className="flex items-center justify-between">
            <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-faint">
              Client config
            </span>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => void copy(config, "Config")}
              className="font-mono text-[10px]"
            >
              <CopyIcon size={11} />
              copy
            </Button>
          </div>
          <JsonBlock code={config} className="mt-2 max-h-52" />
          <p className="mt-2 text-[10.5px] leading-relaxed text-faint">
            Paste into Claude Desktop / Cursor. Most clients accept an HTTP server with an
            Authorization header.
          </p>
        </div>

        <div className="panel p-3">
          <div className="flex items-center justify-between">
            <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-faint">
              Test console
            </span>
            <SparkIcon size={13} className="text-accent" />
          </div>
          <div className="mt-2 flex items-center gap-2 rounded-[var(--radius)] bg-raised/50 px-2.5 py-1.5">
            <McpIcon size={12} className={activeKey ? "text-accent" : "text-faint"} />
            <span className="min-w-0 flex-1 truncate font-mono text-[10.5px] text-muted">
              {activeKey ? `${activeKey.name} · ${activeKey.prefix}••••` : "No active key selected"}
            </span>
            {activeKey && activeValue ? <CheckIcon size={11} className="text-mint" /> : null}
          </div>
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="mt-2"
            aria-label="Test query"
          />
          <Button
            type="button"
            variant="secondary"
            size="md"
            onClick={() => void test()}
            disabled={testing || !activeValue}
            className="mt-2 w-full"
          >
            {testing ? "Calling…" : "Call omnibrain_search"}
          </Button>
          {!activeValue ? (
            <p className="mt-2 font-mono text-[10px] text-faint">
              Pick a key from the API keys list above; keys created this session can run the
              console.
            </p>
          ) : null}
          {testResult ? (
            <JsonBlock code={testResult.slice(0, 4000)} className="mt-2 max-h-40" />
          ) : null}
        </div>
      </div>

      <div className="panel p-3">
        <div className="flex items-center justify-between gap-2">
          <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-faint">
            Tools
          </span>
          <span className="font-mono text-[9.5px] text-faint">
            {TOOLS.filter((tool) => !tool.write).length} read ·{" "}
            {TOOLS.filter((tool) => tool.write).length} write · omnibrain_*
          </span>
        </div>
        <ul className="mt-1 divide-y divide-raised">
          {TOOLS.map((tool) => {
            const Icon = tool.icon;
            return (
              <li key={tool.name} className="flex items-start gap-3 py-2.5">
                <span
                  className={`mt-0.5 grid size-7 shrink-0 place-items-center rounded-[6px] bg-raised ${
                    tool.write ? "text-signal" : "text-accent"
                  }`}
                >
                  <Icon size={13} />
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="font-mono text-[11px] text-text">{tool.name}</p>
                    <Badge tone={tool.write ? "signal" : "muted"}>
                      {tool.write ? "write" : "read"}
                    </Badge>
                  </div>
                  <p className="mt-0.5 text-[11px] leading-relaxed text-muted">{tool.body}</p>
                  <div className="mt-1 flex flex-wrap gap-1">
                    {tool.args.map((arg) => (
                      <span
                        key={arg}
                        className="rounded bg-raised px-1.5 py-0.5 font-mono text-[9px] text-faint"
                      >
                        {arg}
                      </span>
                    ))}
                  </div>
                </div>
                <Tooltip label={`Copy ${tool.name}`}>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    onClick={() => void copy(tool.name, tool.name)}
                    aria-label={`Copy ${tool.name}`}
                    className="shrink-0"
                  >
                    <CopyIcon size={12} />
                  </Button>
                </Tooltip>
              </li>
            );
          })}
        </ul>
      </div>

      <Modal
        open={logsOpen}
        onClose={() => setLogsOpen(false)}
        title="MCP client logs"
        description="Connections, tool listings and calls for every key. Retention 90 days."
        width="max-w-2xl"
      >
        <div className="flex flex-wrap items-center gap-2 pb-2">
          <div className="relative min-w-0 flex-1">
            <SearchIcon
              size={12}
              className="pointer-events-none absolute top-1/2 left-2.5 -translate-y-1/2 text-faint"
            />
            <Input
              value={logSearch}
              onChange={(e) => setLogSearch(e.target.value)}
              placeholder="Search tool, client, status…"
              className="pl-7"
              aria-label="Search logs"
            />
          </div>
          <Select value={logKey} onValueChange={setLogKey}>
            <SelectTrigger className="w-44" aria-label="Filter logs by key">
              <SelectValue placeholder="All keys" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All keys</SelectItem>
              {keys.map((key) => (
                <SelectItem key={key.id} value={key.id}>
                  {key.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {logsLoading ? (
          <p className="py-6 text-center font-mono text-[10px] text-faint">Loading events…</p>
        ) : visibleLogs.length === 0 ? (
          <p className="py-6 text-center text-[11px] text-faint">
            No events match. Point an MCP client at the endpoint to generate some.
          </p>
        ) : (
          <ul className="divide-y divide-raised">
            {visibleLogs.map((event) => (
              <li
                key={event.id}
                className="grid grid-cols-[minmax(0,1fr)_auto] items-baseline gap-x-3 gap-y-0.5 py-2"
              >
                <div className="flex min-w-0 items-baseline gap-2">
                  <Badge tone={event.status === "error" ? "coral" : "mint"}>
                    {eventLabel(event)}
                  </Badge>
                  <span className="truncate font-mono text-[9.5px] text-faint">
                    {event.api_key_id ? (names.get(event.api_key_id) ?? "unknown key") : "no key"}
                    {event.client_name
                      ? ` · ${event.client_name}${event.client_version ? ` ${event.client_version}` : ""}`
                      : ""}
                    {" · "}
                    {event.duration_ms}ms
                  </span>
                  {event.detail ? (
                    <Tooltip label={expanded.has(event.id) ? "Hide detail" : "Show detail"}>
                      <button
                        type="button"
                        onClick={() =>
                          setExpanded((prev) => {
                            const next = new Set(prev);
                            if (next.has(event.id)) next.delete(event.id);
                            else next.add(event.id);
                            return next;
                          })
                        }
                        aria-label={
                          expanded.has(event.id) ? "Hide event detail" : "Show event detail"
                        }
                        aria-expanded={expanded.has(event.id)}
                        className="grid size-4 shrink-0 place-items-center rounded text-faint transition hover:bg-raised hover:text-text"
                      >
                        <ChevronDownIcon
                          size={11}
                          className={`transition-transform ${
                            expanded.has(event.id) ? "rotate-180" : ""
                          }`}
                        />
                      </button>
                    </Tooltip>
                  ) : null}
                </div>
                <time
                  dateTime={new Date(event.created_at).toISOString()}
                  className="font-mono text-[9.5px] whitespace-nowrap text-faint"
                >
                  {fullTime(event.created_at)}
                </time>
                {event.detail && expanded.has(event.id) ? (
                  <JsonBlock
                    code={prettyDetail(event.detail)}
                    className="col-span-2 mt-1 max-h-40"
                  />
                ) : null}
              </li>
            ))}
          </ul>
        )}

        <p className="py-2 font-mono text-[9.5px] text-faint">
          {visibleLogs.length} of {logsEvents.length} events
        </p>
      </Modal>
    </div>
  );
}
