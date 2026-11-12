import type { ConnectorFile, ConnectorItem, ListResult } from "./types";
import { mapLimited } from "./util";

interface GithubGistFile {
  filename?: string;
  language?: string | null;
  content?: string;
}

interface GithubGist {
  id: string;
  html_url: string;
  description?: string | null;
  created_at?: string;
  files?: Record<string, GithubGistFile>;
  owner?: { login?: string };
}

const PER_PAGE = 100;
const CONTENT_LIMIT = 100_000;

function isMarkdownFile(file: GithubGistFile): boolean {
  const name = file.filename ?? "";
  return (
    /^readme(\.(md|markdown))?$/i.test(name) ||
    /\.(md|markdown)$/i.test(name) ||
    file.language === "Markdown"
  );
}

/** GitHub language/extension → markdown fence language. */
const FENCE: Record<string, string> = {
  typescript: "ts",
  ts: "ts",
  tsx: "tsx",
  javascript: "js",
  js: "js",
  jsx: "jsx",
  python: "py",
  py: "py",
  shell: "bash",
  bash: "bash",
  sh: "bash",
  html: "html",
  css: "css",
  json: "json",
  yaml: "yaml",
  yml: "yaml",
  sql: "sql",
  go: "go",
  rust: "rust",
  rs: "rs",
  java: "java",
  csharp: "cs",
  "c#": "cs",
  cs: "cs",
  cpp: "cpp",
  "c++": "cpp",
  c: "c",
  h: "c",
  ruby: "rb",
  rb: "rb",
  php: "php",
  markdown: "md",
  md: "md",
};

function fenceFor(file: GithubGistFile): string {
  if (isMarkdownFile(file)) return "md";
  const language = file.language?.toLowerCase();
  if (language && FENCE[language]) return FENCE[language];
  const ext = (file.filename ?? "").split(".").pop()?.toLowerCase() ?? "";
  return FENCE[ext] ?? "";
}

function fileLang(file: GithubGistFile): string | undefined {
  if (isMarkdownFile(file)) return "markdown";
  return file.language ?? fenceFor(file) ?? undefined;
}

/**
 * Single file: raw content + its language. Multiple files: a markdown document
 * for search plus structured files for the Inspector's per-file tabs.
 */
function formatFiles(files: GithubGistFile[]): {
  text: string;
  lang?: string;
  files?: ConnectorFile[];
} {
  const withContent = files.filter((file) => file.content);
  if (withContent.length === 0) return { text: "" };
  if (withContent.length === 1) {
    const file = withContent[0]!;
    return {
      text: file.content ?? "",
      lang: fileLang(file),
      files: [{ name: file.filename ?? "file", lang: fileLang(file), content: file.content ?? "" }],
    };
  }
  const structured: ConnectorFile[] = withContent.map((file) => ({
    name: file.filename ?? "file",
    lang: fileLang(file),
    content: file.content ?? "",
  }));
  const text = structured
    .map(
      (file) =>
        `## ${file.name}\n\n\`\`\`${fenceFor({ filename: file.name, language: file.lang })}\n${file.content}\n\`\`\``,
    )
    .join("\n\n");
  return { text, lang: "markdown", files: structured };
}

/**
 * Gists saved by the user (`GET /gists`). The list endpoint omits file content,
 * so each gist is fetched once for its code/text. The cursor is the 1-based page
 * number. Private gists need the `gist` OAuth scope (or a token with it).
 */
export async function listGithubGists(input: {
  token: string;
  cursor?: string | null;
  fetchImpl?: typeof fetch;
}): Promise<ListResult> {
  const fetchImpl = input.fetchImpl ?? fetch;
  const page = Math.max(1, Number(input.cursor ?? 1) || 1);
  const headers = {
    authorization: `Bearer ${input.token}`,
    accept: "application/vnd.github+json",
    "user-agent": "omnibrain",
  };
  const url = new URL("https://api.github.com/gists");
  url.searchParams.set("per_page", String(PER_PAGE));
  url.searchParams.set("page", String(page));

  const res = await fetchImpl(url, { headers });
  if (!res.ok) throw new Error(`github ${res.status}: ${await res.text()}`);
  const body = (await res.json()) as GithubGist[];
  const gists = body.filter((gist) => gist?.html_url);

  const items = await mapLimited(gists, 5, async (gist): Promise<ConnectorItem> => {
    const listed = Object.values(gist.files ?? {});
    let content = formatFiles(listed);
    if (!content.text) {
      try {
        const detail = await fetchImpl(`https://api.github.com/gists/${gist.id}`, { headers });
        if (detail.ok) {
          const full = (await detail.json()) as GithubGist;
          content = formatFiles(Object.values(full.files ?? {}));
        }
      } catch {
        // Content is best-effort; the gist link still imports.
      }
    }
    const fileName = (listed.find(isMarkdownFile) ?? listed[0])?.filename;
    return {
      externalId: gist.id,
      kind: "note",
      url: gist.html_url,
      title: gist.description?.trim() || fileName || `Gist ${gist.id.slice(0, 8)}`,
      note: content.text ? content.text.slice(0, CONTENT_LIMIT) : undefined,
      lang: content.lang,
      files: content.files,
      tags: [],
      capturedAt: gist.created_at ? Date.parse(gist.created_at) : undefined,
      author: gist.owner?.login,
    };
  });

  return { items, nextCursor: body.length === PER_PAGE ? String(page + 1) : null };
}
