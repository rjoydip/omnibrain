import { z } from "zod";
import { PLANS } from "./entitlements";

export const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export const EmailSchema = z.string().trim().toLowerCase().email().max(254);
export const RequestOtpSchema = z.object({ email: EmailSchema });
export const VerifyOtpSchema = z.object({
  email: EmailSchema,
  code: z.string().regex(/^\d{6}$/, "6-digit code required"),
});

export const SOURCES = [
  "web",
  "browser",
  "notion",
  "keep",
  "x",
  "raindrop",
  "readwise",
  "obsidian",
  "mcp",
  "file",
] as const;
export type SourceId = (typeof SOURCES)[number];

export const KINDS = ["bookmark", "note", "highlight", "file"] as const;
export type Kind = (typeof KINDS)[number];

export const ItemCreateSchema = z
  .object({
    kind: z.enum(KINDS).default("bookmark"),
    source: z.enum(SOURCES).default("web"),
    url: z.string().trim().min(1).max(4096).optional(),
    title: z.string().trim().max(500).optional(),
    note: z.string().max(100_000).optional(),
    summary: z.string().max(2_000).optional(),
    tags: z.array(z.string().trim().min(1).max(40)).max(20).default([]),
    captured_at: z.number().int().positive().optional(),
    enrich: z.boolean().default(true),
  })
  .refine((v) => Boolean(v.url || v.note || v.title), {
    message: "Provide a URL, title, or note",
  });

export const ItemPatchSchema = z.object({
  title: z.string().trim().min(1).max(500).optional(),
  summary: z.string().max(2_000).optional(),
  note: z.string().max(100_000).optional(),
  tags: z.array(z.string().trim().min(1).max(40)).max(20).optional(),
});

export const ItemQuerySchema = z.object({
  source: z.enum(SOURCES).optional(),
  kind: z.enum(KINDS).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  cursor: z.string().optional(),
  q: z.string().trim().max(200).optional(),
});

export const SearchSchema = z.object({
  query: z.string().trim().max(500).default(""),
  limit: z.coerce.number().int().min(1).max(50).default(20),
  source: z.enum(SOURCES).optional(),
  kind: z.enum(KINDS).optional(),
  since: z.number().int().positive().optional(),
  answer: z.boolean().default(false),
});

export const ImportItemSchema = z.object({
  url: z.string().trim().max(4096).optional(),
  title: z.string().trim().max(500).optional(),
  note: z.string().max(100_000).optional(),
  tags: z.array(z.string().trim().max(40)).max(20).default([]),
  source: z.enum(SOURCES).default("browser"),
  kind: z.enum(KINDS).default("bookmark"),
  captured_at: z.number().int().positive().optional(),
});

export const ImportBatchSchema = z.object({
  items: z.array(ImportItemSchema).min(1).max(500),
});

export const ImportCreateSchema = z.object({
  kind: z.enum(["browser_html", "keep_takeout", "obsidian_zip"]),
  total: z.number().int().min(0).max(1_000_000).default(0),
});

export const ConnectionCreateSchema = z.object({ app_id: z.string().min(1).max(40) });
export const ApiKeyCreateSchema = z.object({ name: z.string().trim().min(1).max(60) });
export const NoteSaveSchema = z.object({
  text: z.string().trim().min(1).max(100_000),
  url: z.string().trim().max(4096).optional(),
  tags: z.array(z.string().trim().max(40)).max(20).default([]),
});

export const PlanIdSchema = z.enum(
  Object.keys(PLANS) as [keyof typeof PLANS, ...(keyof typeof PLANS)[]],
);
