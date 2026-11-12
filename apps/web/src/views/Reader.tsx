import { useEffect, useState } from "react";
import { Markdown } from "../components/Markdown";
import { SectionLoading } from "../components/Shell";
import { SourceGlyph } from "../components/SourceGlyph";
import { SparkIcon } from "../components/icons";
import { ApiError, api, type SharedItem } from "../lib/api";
import { dayLabel, sourceMeta, timeLabel } from "../lib/format";

export type ReaderItem = Pick<
  SharedItem,
  "title" | "url" | "source" | "excerpt" | "summary" | "captured_at"
>;

/** Shared by the private reader tab and the public share page. */
export function ReaderLayout({ item }: { item: ReaderItem }) {
  const note = item.excerpt ?? "";
  const summary = item.summary ?? "";

  return (
    <div className="min-h-screen bg-canvas">
      <div className="mx-auto w-full max-w-3xl px-4 py-8 md:px-6">
        <header className="mb-6 border-b border-line pb-4">
          <div className="flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.14em] text-faint">
            <SourceGlyph id={item.source} size={12} />
            <span>{sourceMeta(item.source).label}</span>
            <span className="ml-auto normal-case tracking-normal">
              {dayLabel(item.captured_at)} · {timeLabel(item.captured_at)}
            </span>
          </div>
          <h1 className="mt-2 text-balance text-[21px] font-semibold leading-snug tracking-[-0.02em] text-text">
            {item.title}
          </h1>
          {item.url ? (
            <a
              href={item.url}
              target="_blank"
              rel="noreferrer"
              className="mt-1.5 block truncate font-mono text-[10.5px] text-accent hover:underline"
            >
              {item.url}
            </a>
          ) : null}
        </header>

        {summary ? (
          <section className="mb-7">
            <h2 className="mb-2 flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-[0.14em] text-accent">
              <SparkIcon size={12} />
              AI summary · generated
            </h2>
            <Markdown text={summary} />
          </section>
        ) : null}

        {note ? (
          <section>
            <h2 className="mb-2 font-mono text-[10px] uppercase tracking-[0.14em] text-faint">
              Original note
            </h2>
            <Markdown text={note} />
          </section>
        ) : null}

        {!note && !summary ? (
          <p className="text-[12px] text-faint">No text captured for this item yet.</p>
        ) : null}
      </div>
    </div>
  );
}

/** Private tab: requires the session cookie. */
export function Reader({ itemId }: { itemId: string }) {
  const [item, setItem] = useState<ReaderItem | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    api
      .item(itemId)
      .then((res) => {
        if (alive) setItem(res.item);
      })
      .catch((err) => {
        if (alive) setError(err instanceof ApiError ? err.message : "Could not open this item");
      });
    return () => {
      alive = false;
    };
  }, [itemId]);

  if (!item) {
    return error ? (
      <div className="mx-auto max-w-3xl p-6">
        <p className="text-sm text-coral">{error}</p>
      </div>
    ) : (
      <SectionLoading label="Opening reader" />
    );
  }
  return <ReaderLayout item={item} />;
}

/** Public share page: the token is the credential, no session needed. */
export function SharedReader({ token }: { token: string }) {
  const [item, setItem] = useState<ReaderItem | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    api
      .sharedItem(token)
      .then((res) => {
        if (alive) setItem(res.item);
      })
      .catch((err) => {
        if (alive) setError(err instanceof ApiError ? err.message : "This link is not available");
      });
    return () => {
      alive = false;
    };
  }, [token]);

  if (!item) {
    return error ? (
      <div className="mx-auto grid min-h-screen max-w-3xl place-items-center p-6">
        <p className="text-sm text-coral">{error}</p>
      </div>
    ) : (
      <SectionLoading label="Opening shared note" />
    );
  }
  return <ReaderLayout item={item} />;
}
