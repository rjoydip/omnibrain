export interface ConnectorFile {
  name: string;
  lang?: string;
  content: string;
}

export interface ConnectorItem {
  externalId: string;
  kind: "bookmark" | "note" | "highlight" | "file";
  url?: string;
  title: string;
  note?: string;
  /** Structured multi-file content; rendered as tabs in the Inspector. */
  files?: ConnectorFile[];
  summary?: string;
  /** Content language, e.g. `markdown`, `TypeScript`; used for rendering hints. */
  lang?: string;
  tags?: string[];
  capturedAt?: number;
  author?: string;
}

export interface ListResult {
  items: ConnectorItem[];
  nextCursor: string | null;
}

export type AuthKind = "oauth2" | "token" | "file-import" | "none";

export interface ConnectorManifest {
  id: string;
  name: string;
  category: string;
  description: string;
  status: "ga" | "beta" | "import-only";
  auth: AuthKind;
  /** Also accepts a pasted personal access token instead of the OAuth sign-in. */
  tokenAuth?: boolean;
  scopes: string[];
  capabilities: Array<"import" | "incremental" | "revoke">;
  schedule?: string;
  glyph: string;
  tone: "amber" | "cobalt" | "mint" | "coral" | "muted";
}
