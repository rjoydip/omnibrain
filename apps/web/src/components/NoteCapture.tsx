import { isMarkdown } from "@omnibrain/core/markdown";
import { Button, Input, Modal } from "@omnibrain/ui";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { ApiError, api, type Item } from "../lib/api";
import { Markdown } from "./Markdown";

type Tab = "write" | "preview";

function ListIcon({ ordered = false }: { ordered?: boolean }) {
  return (
    <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true">
      {ordered ? (
        <text fill="currentColor" fontFamily="monospace" fontSize="3.4">
          <tspan x="0" y="4">
            1
          </tspan>
          <tspan x="0" y="7.8">
            2
          </tspan>
          <tspan x="0" y="11.6">
            3
          </tspan>
        </text>
      ) : (
        <>
          <circle cx="1.4" cy="3" r="0.9" fill="currentColor" />
          <circle cx="1.4" cy="6" r="0.9" fill="currentColor" />
          <circle cx="1.4" cy="9" r="0.9" fill="currentColor" />
        </>
      )}
      <path d="M4 3h7M4 6h7M4 9h7" stroke="currentColor" strokeWidth="1.1" strokeLinecap="round" />
    </svg>
  );
}

export function NoteCapture({
  open,
  onClose,
  onSaved,
}: {
  open: boolean;
  onClose: () => void;
  onSaved: (item: Item) => void;
}) {
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [tab, setTab] = useState<Tab>("write");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (!open) return;
    setTitle("");
    setBody("");
    setTab("write");
    setError(null);
    const timer = setTimeout(() => textareaRef.current?.focus(), 40);
    return () => clearTimeout(timer);
  }, [open]);

  const markdown = isMarkdown(body);
  const canSave = body.trim().length > 0 && !saving;

  const restoreSelection = (start: number, end: number) => {
    requestAnimationFrame(() => {
      const el = textareaRef.current;
      if (!el) return;
      el.focus();
      el.setSelectionRange(start, end);
    });
  };

  function applyInline(
    el: HTMLTextAreaElement,
    before: string,
    after: string,
    placeholder: string,
  ) {
    const start = el.selectionStart;
    const end = el.selectionEnd;
    const selected = body.slice(start, end) || placeholder;
    setBody(`${body.slice(0, start)}${before}${selected}${after}${body.slice(end)}`);
    restoreSelection(start + before.length, start + before.length + selected.length);
  }

  function applyLine(el: HTMLTextAreaElement, prefix: string) {
    const start = el.selectionStart;
    const lineStart = start === 0 ? 0 : body.lastIndexOf("\n", start - 1) + 1;
    const next = `${body.slice(0, lineStart)}${prefix}${body.slice(lineStart)}`;
    setBody(next);
    restoreSelection(start + prefix.length, el.selectionEnd + prefix.length);
  }

  function applySnippet(el: HTMLTextAreaElement, snippet: string) {
    const start = el.selectionStart;
    const end = el.selectionEnd;
    setBody(`${body.slice(0, start)}${snippet}${body.slice(end)}`);
    restoreSelection(start + snippet.length, start + snippet.length);
  }

  async function save() {
    const note = body.trim();
    if (!note || saving) return;
    setSaving(true);
    setError(null);
    try {
      const derived = note
        .split("\n")
        .find((line) => line.trim())
        ?.replace(/^#{1,6}\s+/, "")
        .slice(0, 120);
      const res = await api.createItem({
        note,
        title: title.trim() || derived || "Note",
        kind: "note",
        source: "web",
        enrich: false,
      });
      onSaved(res.item);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not save note");
    } finally {
      setSaving(false);
    }
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
      e.preventDefault();
      void save();
      return;
    }
    if (e.key !== "Enter" || e.shiftKey) return;

    const el = textareaRef.current;
    if (!el) return;
    const start = el.selectionStart;
    const end = el.selectionEnd;
    if (start !== end) return;

    const lineStart = start === 0 ? 0 : body.lastIndexOf("\n", start - 1) + 1;
    const line = body.slice(lineStart, start);
    if (start - lineStart !== line.length) return;

    const ordered = /^(\d+)([.)]) /.exec(line);
    const isTask =
      line.startsWith("- [ ] ") || line.startsWith("- [x] ") || line.startsWith("- [X] ");
    const marker = isTask
      ? "- [ ] "
      : line.startsWith("- ")
        ? "- "
        : ordered
          ? `${Number(ordered[1]) + 1}${ordered[2]} `
          : null;
    if (!marker || line === marker) return;

    e.preventDefault();
    const caret = start + 1 + marker.length;
    setBody(`${body.slice(0, start)}\n${marker}${body.slice(end)}`);
    restoreSelection(caret, caret);
  }

  const tools: Array<
    | { id: string; label: ReactNode; hint: string; line: string }
    | {
        id: string;
        label: ReactNode;
        hint: string;
        before: string;
        after: string;
        placeholder: string;
      }
    | { id: string; label: ReactNode; hint: string; snippet: string }
  > = [
    { id: "bold", label: "B", hint: "Bold", before: "**", after: "**", placeholder: "bold text" },
    {
      id: "italic",
      label: "I",
      hint: "Italic",
      before: "*",
      after: "*",
      placeholder: "italic text",
    },
    { id: "h1", label: "H1", hint: "Heading 1", line: "# " },
    { id: "h2", label: "H2", hint: "Heading 2", line: "## " },
    { id: "bullet", label: <ListIcon />, hint: "Bullet list", line: "- " },
    { id: "number", label: <ListIcon ordered />, hint: "Numbered list", line: "1. " },
    { id: "task", label: "☑", hint: "Task list", line: "- [ ] " },
    { id: "quote", label: ">", hint: "Quote", line: "> " },
    {
      id: "code-block",
      label: "</>",
      hint: "Code block",
      before: "```\n",
      after: "\n```",
      placeholder: "code",
    },
    {
      id: "table",
      label: "▦",
      hint: "Table",
      snippet: "\n| Column | Column |\n| --- | --- |\n| Cell | Cell |\n",
    },
    { id: "divider", label: "—", hint: "Divider", snippet: "\n\n---\n\n" },
    {
      id: "link",
      label: "link",
      hint: "Link",
      before: "[",
      after: "](https://)",
      placeholder: "label",
    },
  ];

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="New note"
      description="Write in plain text or markdown. Markdown notes get a live preview."
      width="max-w-2xl"
      footer={
        <div className="flex items-center justify-between gap-3">
          <span className="font-mono text-[10px] text-faint">⌘↵ save · esc close</span>
          <div className="flex items-center gap-2">
            <Button type="button" variant="ghost" size="sm" onClick={onClose}>
              Cancel
            </Button>
            <Button type="button" variant="primary" size="sm" disabled={!canSave} onClick={save}>
              {saving ? "Saving…" : "Save note"}
            </Button>
          </div>
        </div>
      }
    >
      <div className="space-y-3 pb-2">
        <Input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Title (optional — defaults to the first line)"
          aria-label="Note title"
        />

        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex flex-wrap items-center gap-1">
            {tools.map((tool) => (
              <button
                key={tool.id}
                type="button"
                onClick={() => {
                  const el = textareaRef.current;
                  if (!el) return;
                  if ("line" in tool) applyLine(el, tool.line);
                  else if ("snippet" in tool) applySnippet(el, tool.snippet);
                  else applyInline(el, tool.before, tool.after, tool.placeholder);
                }}
                aria-label={tool.hint}
                className="grid h-6 min-w-6 place-items-center rounded-[var(--radius)] px-1.5 font-mono text-[10.5px] text-muted transition hover:bg-raised hover:text-text"
              >
                {tool.label}
              </button>
            ))}
          </div>
          <div className="flex rounded-[var(--radius)] bg-raised p-0.5">
            {(["write", "preview"] as const).map((value) => (
              <button
                key={value}
                type="button"
                onClick={() => setTab(value)}
                aria-pressed={tab === value}
                className={`rounded-[5px] px-2 py-1 font-mono text-[10px] uppercase tracking-wider transition ${
                  tab === value ? "bg-panel text-accent" : "text-muted hover:text-text"
                }`}
              >
                {value}
              </button>
            ))}
          </div>
        </div>

        {error ? (
          <p role="alert" className="text-xs text-coral">
            {error}
          </p>
        ) : null}

        {tab === "write" ? (
          <textarea
            ref={textareaRef}
            value={body}
            onChange={(e) => setBody(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder={
              "Start writing…\n\n## Markdown works too\n- lists, **bold**, `code`, [links](https://example.com)"
            }
            aria-label="Note body"
            spellCheck
            className="min-h-[240px] w-full resize-y rounded-[var(--radius)] bg-raised px-3 py-2.5 font-sans text-[12.5px] leading-relaxed text-text outline-none placeholder:text-faint focus-visible:ring-2 focus-visible:ring-accent/50"
          />
        ) : (
          <div className="min-h-[240px] max-h-[45vh] overflow-y-auto">
            {body.trim() ? (
              markdown ? (
                <Markdown text={body} />
              ) : (
                <pre className="rounded-[var(--radius)] bg-canvas/50 p-3 font-sans text-[12.5px] leading-relaxed whitespace-pre-wrap text-text">
                  {body}
                </pre>
              )
            ) : (
              <p className="p-3 text-xs text-faint">Nothing to preview yet.</p>
            )}
          </div>
        )}
      </div>
    </Modal>
  );
}
