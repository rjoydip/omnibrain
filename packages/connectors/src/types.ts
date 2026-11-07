export interface ConnectorItem {
  externalId: string;
  kind: "bookmark" | "note" | "highlight" | "file";
  url?: string;
  title: string;
  note?: string;
  summary?: string;
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
  scopes: string[];
  capabilities: Array<"import" | "incremental" | "revoke">;
  schedule?: string;
  glyph: string;
  tone: "amber" | "cobalt" | "mint" | "coral" | "muted";
}
