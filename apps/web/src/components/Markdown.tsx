import { parseMarkdown, type MarkdownBlock, type MarkdownInline } from "@omnibrain/core/markdown";
import { Fragment, useMemo } from "react";

function Inlines({ nodes }: { nodes: MarkdownInline[] }) {
  return (
    <>
      {nodes.map((node, index) => {
        switch (node.type) {
          case "strong":
            return (
              <strong key={index} className="font-semibold text-text">
                <Inlines nodes={node.children} />
              </strong>
            );
          case "em":
            return (
              <em key={index}>
                <Inlines nodes={node.children} />
              </em>
            );
          case "del":
            return (
              <del key={index} className="text-muted">
                <Inlines nodes={node.children} />
              </del>
            );
          case "code":
            return (
              <code
                key={index}
                className="rounded bg-raised px-1 py-0.5 font-mono text-[11px] text-accent"
              >
                {node.value}
              </code>
            );
          case "link":
            return (
              <a
                key={index}
                href={node.href}
                target="_blank"
                rel="noreferrer"
                className="text-accent underline underline-offset-2 hover:brightness-110"
              >
                <Inlines nodes={node.children} />
              </a>
            );
          case "break":
            return <br key={index} />;
          default:
            return <Fragment key={index}>{node.value}</Fragment>;
        }
      })}
    </>
  );
}

const HEADING_CLASS: Record<number, string> = {
  1: "text-[17px] font-semibold",
  2: "text-[15px] font-semibold",
  3: "text-[13.5px] font-semibold",
  4: "text-[12.5px] font-semibold",
  5: "text-[12px] font-semibold",
  6: "text-[12px] font-semibold text-muted",
};

function Block({ block }: { block: MarkdownBlock }) {
  switch (block.type) {
    case "heading":
      return (
        <p className={`mt-3 first:mt-0 ${HEADING_CLASS[block.level] ?? HEADING_CLASS[6]}`}>
          <Inlines nodes={block.children} />
        </p>
      );
    case "list":
      return block.ordered ? (
        <ol className="list-decimal space-y-0.5 pl-5 marker:text-accent" start={block.start}>
          {block.items.map((item, index) => (
            <li key={index}>
              <Inlines nodes={item} />
            </li>
          ))}
        </ol>
      ) : (
        <ul className="list-disc space-y-0.5 pl-5 marker:text-accent">
          {block.items.map((item, index) => (
            <li key={index}>
              <Inlines nodes={item} />
            </li>
          ))}
        </ul>
      );
    case "tasks":
      return (
        <ul className="space-y-1">
          {block.items.map((item, index) => (
            <li key={index} className="flex items-start gap-2">
              <input
                type="checkbox"
                checked={item.checked}
                readOnly
                tabIndex={-1}
                aria-hidden="true"
                className="mt-1 size-3 shrink-0 accent-[var(--accent)]"
              />
              <span className={item.checked ? "text-muted line-through" : undefined}>
                <Inlines nodes={item.children} />
              </span>
            </li>
          ))}
        </ul>
      );
    case "table":
      return (
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-left text-[12px]">
            <thead>
              <tr>
                {block.header.map((cell, index) => (
                  <th
                    key={index}
                    className="border-b border-line-strong px-2 py-1 font-semibold text-text"
                    align={block.align[index] ?? undefined}
                  >
                    <Inlines nodes={cell} />
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {block.rows.map((row, rowIndex) => (
                <tr key={rowIndex}>
                  {row.map((cell, index) => (
                    <td
                      key={index}
                      className="border-b border-line px-2 py-1 text-muted"
                      align={block.align[index] ?? undefined}
                    >
                      <Inlines nodes={cell} />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
    case "code":
      return (
        <pre className="overflow-x-auto rounded-[var(--radius)] bg-canvas/60 p-3 font-mono text-[11.5px] leading-relaxed">
          <code>{block.value}</code>
        </pre>
      );
    case "quote":
      return (
        <blockquote className="border-l-2 border-line-strong pl-3 text-muted">
          {block.children.map((child, index) => (
            <Block key={index} block={child} />
          ))}
        </blockquote>
      );
    case "rule":
      return <hr className="border-line-strong" />;
    default:
      return (
        <p>
          <Inlines nodes={block.children} />
        </p>
      );
  }
}

/** Renders the shared markdown subset with app tokens. */
export function Markdown({ text, className }: { text: string; className?: string }) {
  const blocks = useMemo(() => parseMarkdown(text), [text]);
  return (
    <div
      className={`space-y-1.5 rounded-[var(--radius)] bg-canvas/50 p-3 text-[12.5px] leading-relaxed text-text ${className ?? ""}`}
    >
      {blocks.map((block, index) => (
        <Block key={index} block={block} />
      ))}
    </div>
  );
}
