import { readFileSync, realpathSync, statSync } from "node:fs";
import { isAbsolute, join, relative, sep } from "node:path";
import { contentTypeOf, deniedFile, fileGranted, MAX_PAGE_FILE_BYTES, normalizeFilePath } from "../../pages/access.ts";
import type { PageSpec } from "../../types.ts";
import { type ApiContext, displayPath } from "../context.ts";
import { HttpError } from "../http.ts";
import type { Routes } from "./index.ts";

const MAX_PAGE_BYTES = 1_048_576;

export function readPageHtml(path: string, shown: string): string {
  let size: number;
  try {
    const st = statSync(path);
    if (!st.isFile()) throw new HttpError(404, `page file is not a file: ${shown}`);
    size = st.size;
  } catch (e) {
    if (e instanceof HttpError) throw e;
    throw new HttpError(404, `page file not found: ${shown}`);
  }
  if (size > MAX_PAGE_BYTES) throw new HttpError(413, `${shown} is larger than 1 MB`);
  return readFileSync(path, "utf8");
}

export function pageSpec(ctx: ApiContext, name: string): PageSpec {
  const page = ctx.y.pages.find((p) => p.name === name);
  if (!page) throw new HttpError(404, `unknown page: ${name}`);
  return page;
}

// opened directly, an SVG would otherwise run its script on the UI's origin
const FILE_HEADERS = {
  "cache-control": "no-store",
  "x-content-type-options": "nosniff",
  "content-security-policy": "default-src 'none'; style-src 'unsafe-inline'; sandbox",
};

const tooLarge = (path: string) => new HttpError(413, `${path} is larger than 10 MB`);
const missing = (path: string) => new HttpError(404, `file not found: ${path}`);

// the grant and the deny list hold for the file a symlink leads to, not only for the path asked
export function grantedFile(
  root: string,
  files: string[],
  denied: string[],
  path: string,
): { real: string; size: number } {
  let real: string;
  let size: number;
  try {
    real = realpathSync.native(join(root, path));
    const st = statSync(real);
    if (!st.isFile()) throw missing(path);
    size = st.size;
  } catch (e) {
    if (e instanceof HttpError) throw e;
    throw missing(path);
  }
  const rel = relative(realpathSync.native(root), real);
  const shown = rel.split(sep).join("/");
  if (rel.startsWith("..") || isAbsolute(rel) || !fileGranted(files, shown) || deniedFile(shown, denied))
    throw new HttpError(403, `${path} leads outside this page's files`);
  if (size > MAX_PAGE_FILE_BYTES) throw tooLarge(path);
  return { real, size };
}

const readGranted = (ctx: ApiContext, page: PageSpec, path: string): Uint8Array<ArrayBuffer> =>
  readFileSync(grantedFile(ctx.root, page.files, ctx.deniedFiles, path).real);

export const pageRoutes: Routes = (router, ctx) => {
  router.add("GET", "/api/pages/:page/html", ({ params }) => {
    const page = pageSpec(ctx, params.page as string);
    return { html: readPageHtml(page.path, displayPath(ctx.root, page.path)) };
  });

  // normalize, grant, deny, then the host's own source, then the working tree
  router.add("GET", "/api/pages/:page/file", async ({ params, query, signal }) => {
    const page = pageSpec(ctx, params.page as string);
    const asked = query.get("path");
    if (!asked) throw new HttpError(400, "path is required");
    const path = normalizeFilePath(asked);
    if (path === null || !fileGranted(page.files, path))
      throw new HttpError(403, `${asked} is not in this page's files`);
    if (deniedFile(path, ctx.deniedFiles))
      throw new HttpError(403, `${asked} is YAMLite's own and no page may read it`);
    let bytes = await ctx.pageFiles?.(path, signal);
    if (bytes === "missing") throw missing(path);
    if (bytes === "too-large" || (bytes !== undefined && bytes.length > MAX_PAGE_FILE_BYTES)) throw tooLarge(path);
    bytes ??= readGranted(ctx, page, path);
    return new Response(bytes, { headers: { ...FILE_HEADERS, "content-type": contentTypeOf(path) } });
  });
};
