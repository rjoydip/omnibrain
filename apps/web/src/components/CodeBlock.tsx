import { useMemo } from "react";
import { highlight } from "kirari";
import { json } from "kirari/languages";

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** Kirari-highlighted JSON block. Input is escaped by Kirari before rendering. */
export function JsonBlock({ code, className }: { code: string; className?: string }) {
  const html = useMemo(() => {
    try {
      return highlight(code, { language: json });
    } catch {
      return escapeHtml(code);
    }
  }, [code]);

  return (
    <pre
      className={`kirari overflow-auto rounded-[var(--radius)] bg-canvas/50 p-3 font-mono text-[10.5px] leading-relaxed ${className ?? ""}`}
    >
      <code dangerouslySetInnerHTML={{ __html: html }} />
    </pre>
  );
}
