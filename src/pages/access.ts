import type { PageAccess } from "../types.ts";

export interface PageRules {
  name: string;
  access: Record<string, PageAccess>;
  sql: boolean;
  network: string[];
  // root-relative folders (ending in /) and files the page may read
  files: string[];
  ai: { maxOutputTokens: number } | null;
}

export const DENIED_FILES = [".yamlite/", "yamlite.yaml", "yamlite.yml"];
export const MAX_PAGE_FILE_BYTES = 10_485_760;

export const PAGE_AI_DEFAULT_TOKENS = 1024;
export const PAGE_AI_MAX_TOKENS = 8192;

export const canRead = (page: PageRules, name: string): boolean => Object.hasOwn(page.access, name);

export const canWrite = (page: PageRules, name: string): boolean =>
  Object.hasOwn(page.access, name) && page.access[name] === "write";

export const writesAnything = (page: PageRules): boolean => Object.values(page.access).includes("write");

export const notInAccess = (name: string): string => `${name} is not in this page's access`;

// SQLite reports a read inside a view under the innermost view's name, so the views a granted view is built on are trusted too
export function trustedViews(page: PageRules, views: ReadonlyArray<{ name: string; parent: string }>): Set<string> {
  const parentOf = new Map(views.map((v) => [v.name, v.parent]));
  const trusted = new Set<string>();
  for (const name of Object.keys(page.access)) {
    for (let v: string | undefined = name; v !== undefined && parentOf.has(v) && !trusted.has(v); v = parentOf.get(v)) {
      trusted.add(v);
    }
  }
  return trusted;
}

// "a//./b" becomes "a/b"; null for absolute, empty or ..-containing paths. String ops only: the UI imports this module
export function normalizeFilePath(path: string): string | null {
  if (path.startsWith("/") || path.startsWith("\\") || /^[a-z]:/i.test(path)) return null;
  const parts = path.split(/[\\/]/);
  if (parts.includes("..")) return null;
  const kept = parts.filter((p) => p !== "" && p !== ".");
  if (kept.length === 0) return null;
  return kept.join("/") + (path.endsWith("/") ? "/" : "");
}

// `path` is already normalized; a folder entry ends in /, anything else is one exact file
export const fileGranted = (files: string[], path: string): boolean =>
  files.some((entry) => (entry.endsWith("/") ? path.startsWith(entry) : path === entry));

// case-insensitive: on macOS and Windows "Yamlite.yaml" is the same file as "yamlite.yaml"
export const deniedFile = (path: string, denied: string[]): boolean =>
  fileGranted(
    denied.map((d) => d.toLowerCase()),
    path.toLowerCase(),
  );

// only types that are safe to serve back as-is; anything else, html included, is a download
const CONTENT_TYPES: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  webp: "image/webp",
  gif: "image/gif",
  svg: "image/svg+xml",
  pdf: "application/pdf",
  txt: "text/plain",
};

export function contentTypeOf(path: string): string {
  const ext = path.slice(path.lastIndexOf(".") + 1).toLowerCase();
  return path.includes(".") && Object.hasOwn(CONTENT_TYPES, ext) ? CONTENT_TYPES[ext]! : "application/octet-stream";
}

export function pageCsp(network: string[]): string {
  const extra = network.map((o) => ` ${o}`).join("");
  return [
    "default-src 'none'",
    `script-src 'unsafe-inline'${extra}`,
    `style-src 'unsafe-inline'${extra}`,
    `img-src data: blob:${extra}`,
    `font-src data:${extra}`,
    `connect-src${network.length > 0 ? extra : " 'none'"}`,
    "form-action 'none'",
    "base-uri 'none'",
  ].join("; ");
}

export function accessSummary(page: PageRules): string {
  const parts = Object.entries(page.access).map(([name, level]) => `${name}: ${level}`);
  if (page.sql) parts.push("sql");
  for (const origin of page.network) parts.push(new URL(origin).host);
  if (page.files.length > 0) parts.push(`files: ${page.files.join(", ")}`);
  if (page.ai) parts.push("AI");
  return parts.length > 0 ? parts.join(" · ") : "no access";
}

// the header shows counts; the full list stays in its tooltip
export function accessBrief(page: PageRules): string {
  const levels = Object.values(page.access);
  const writes = levels.filter((l) => l === "write").length;
  const reads = levels.length - writes;
  const parts: string[] = [];
  if (writes > 0) parts.push(`write ${writes}`);
  if (reads > 0) parts.push(`read ${reads}`);
  if (page.sql) parts.push("SQL");
  const n = page.network.length;
  if (n > 0) parts.push(`${n} ${n === 1 ? "origin" : "origins"}`);
  const f = page.files.length;
  if (f > 0) parts.push(`${f} ${f === 1 ? "file entry" : "file entries"}`);
  if (page.ai) parts.push("AI");
  return parts.length > 0 ? parts.join(" · ") : "no access";
}
