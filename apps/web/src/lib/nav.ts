export type View = "knowledge" | "apps" | "import" | "mcp" | "settings";
export type Theme = "ink" | "paper" | "contrast";
export type Accent = "cobalt" | "amber" | "mint" | "coral" | "violet" | "slate";

export const ACCENTS: Array<{ id: Accent; label: string }> = [
  { id: "cobalt", label: "Cobalt" },
  { id: "amber", label: "Amber" },
  { id: "mint", label: "Mint" },
  { id: "coral", label: "Coral" },
  { id: "violet", label: "Violet" },
  { id: "slate", label: "Slate" },
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
