export type View = "knowledge" | "apps" | "import" | "mcp" | "settings";
export type Theme = "ink" | "paper" | "contrast";
export type Accent = "cobalt" | "amber" | "mint" | "rose" | "violet" | "cyan";
export type ItemStatus = "active" | "archived" | "trash";
export type ItemLayout = "list" | "grid" | "graph";

export const ACCENTS: Array<{ id: Accent; label: string }> = [
  { id: "cobalt", label: "Cobalt" },
  { id: "amber", label: "Amber" },
  { id: "mint", label: "Mint" },
  { id: "rose", label: "Rose" },
  { id: "violet", label: "Violet" },
  { id: "cyan", label: "Cyan" },
];

export const VIEW_LABEL: Record<View, string> = {
  knowledge: "Knowledge",
  apps: "App Store",
  import: "Import",
  mcp: "MCP Server",
  settings: "Settings",
};

export const THEMES: Array<{ id: Theme; label: string; hint: string }> = [
  { id: "ink", label: "Ink", hint: "Dark, default" },
  { id: "paper", label: "Paper", hint: "Light, editorial" },
  { id: "contrast", label: "Contrast", hint: "High contrast" },
];
