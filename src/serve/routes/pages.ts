import {
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { dirname, isAbsolute, join, relative, sep } from "node:path";
import {
  bytesMatchType,
  contentTypeOf,
  deniedFile,
  fileGranted,
  fileWritable,
  MAX_PAGE_FILE_BYTES,
  normalizeFilePath,
  writableType,
} from "../../pages/access.ts";
import { hashContent } from "../../hash.ts";
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
  files: PageSpec["files"],
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

// base64 grows the bytes by a third; the rest of the JSON is small
const MAX_WRITE_BODY = Math.ceil(MAX_PAGE_FILE_BYTES / 3) * 4 + 4096;
const BASE64 = /^[A-Za-z0-9+/]*={0,2}$/;

const insideRoot = (rel: string) => rel !== "" && !rel.startsWith("..") && !isAbsolute(rel);

// the file a write or delete lands on, as the disk spells it. Folders on the way may be symlinks, but where they lead
// must still be inside the root, writable and not denied; the file itself may not be a symlink
function writeTarget(root: string, page: PageSpec, denied: string[], path: string): string {
  const realRoot = realpathSync.native(root);
  const parts = path.split("/");
  let at = realRoot;
  let i = 0;
  for (; i < parts.length - 1; i++) {
    const next = join(at, parts[i] as string);
    try {
      at = realpathSync.native(next);
    } catch {
      // a symlink leading nowhere is not a folder still to be made
      if (lstatOrNull(next)) throw new HttpError(409, `${parts.slice(0, i + 1).join("/")} is not a folder`);
      break;
    }
    if (!statSync(at).isDirectory()) throw new HttpError(409, `${parts.slice(0, i + 1).join("/")} is not a folder`);
  }
  const target = join(at, ...parts.slice(i));
  const rel = relative(realRoot, target);
  const shown = rel.split(sep).join("/");
  if (!insideRoot(rel) || !fileWritable(page.files, shown) || deniedFile(shown, denied))
    throw new HttpError(403, `${path} leads outside the files this page may write`);
  let isLink = false;
  try {
    const st = lstatSync(target);
    isLink = st.isSymbolicLink();
    if (!isLink && !st.isFile()) throw new HttpError(409, `${path} is not a file`);
  } catch (e) {
    if (e instanceof HttpError) throw e;
  }
  if (isLink) throw new HttpError(403, `${path} is a symlink; a page may not write through it`);
  return target;
}

const lstatOrNull = (path: string) => lstatSync(path, { throwIfNoEntry: false }) ?? null;

// a file over the limit cannot match a base, since the page could never read it, so it is not read either
function readIfFile(path: string): Uint8Array<ArrayBuffer> | "too-large" | null {
  const st = lstatOrNull(path);
  if (!st?.isFile()) return null;
  if (st.size > MAX_PAGE_FILE_BYTES) return "too-large";
  return readFileSync(path);
}

// base is the SHA-256 of the content the page last saw, null for "no file yet"; leaving it out skips the check
function baseOf(body: unknown): string | null | undefined {
  const base = (body as { base?: unknown } | undefined)?.base;
  if (base === undefined || base === null) return base;
  if (typeof base !== "string" || !/^[0-9a-f]{64}$/.test(base))
    throw new HttpError(400, "base must be a SHA-256 hex digest or null");
  return base;
}

// the host is asked first, and the disk is read and written with no await in between, so two requests cannot both
// pass the check
async function hostedFile(ctx: ApiContext, target: string, path: string, signal: AbortSignal) {
  if (existsSync(target)) return null;
  const hosted = await ctx.pageFiles?.(path, signal);
  return hosted === undefined || hosted === "missing" ? null : hosted;
}

function checkBase(
  target: string,
  path: string,
  base: string | null | undefined,
  hosted: Uint8Array<ArrayBuffer> | "too-large" | null,
): "disk" | "host" | null {
  const disk = readIfFile(target);
  const current = disk ?? hosted;
  const from = disk !== null ? "disk" : hosted !== null ? "host" : null;
  if (base === undefined) return from;
  if (current === "too-large") throw new HttpError(409, `${path} changed since the page read it`);
  const now = current === null ? null : hashContent(current);
  if (now !== base) throw new HttpError(409, `${path} changed since the page read it`, { current: now });
  return from;
}

function writableRequest(ctx: ApiContext, params: Record<string, string>, query: URLSearchParams) {
  const page = pageSpec(ctx, params.page as string);
  const asked = query.get("path");
  if (!asked) throw new HttpError(400, "path is required");
  const path = normalizeFilePath(asked);
  if (path === null || path.endsWith("/") || !fileWritable(page.files, path))
    throw new HttpError(403, `${asked} is not in the files this page may write`);
  if (deniedFile(path, ctx.deniedFiles)) throw new HttpError(403, `${asked} is YAMLite's own and no page may write it`);
  return { page, path };
}

// written beside the target and renamed over it, so a reader never sees half a file
function replaceFile(target: string, bytes: Uint8Array): void {
  mkdirSync(dirname(target), { recursive: true });
  const tmp = join(dirname(target), `.yamlite-${crypto.randomUUID()}.tmp`);
  try {
    writeFileSync(tmp, bytes);
    renameSync(tmp, target);
  } catch (e) {
    rmSync(tmp, { force: true });
    throw e;
  }
}

export const pageRoutes: Routes = (router, ctx) => {
  router.add("GET", "/api/pages/:page/html", ({ params }) => {
    const page = pageSpec(ctx, params.page as string);
    return { html: readPageHtml(page.path, displayPath(ctx.root, page.path)) };
  });

  // normalize, grant, deny, then the working tree, then the host's own source for files it keeps out of the tree
  router.add("GET", "/api/pages/:page/file", async ({ params, query, signal }) => {
    const page = pageSpec(ctx, params.page as string);
    const asked = query.get("path");
    if (!asked) throw new HttpError(400, "path is required");
    const path = normalizeFilePath(asked);
    if (path === null || !fileGranted(page.files, path))
      throw new HttpError(403, `${asked} is not in this page's files`);
    if (deniedFile(path, ctx.deniedFiles))
      throw new HttpError(403, `${asked} is YAMLite's own and no page may read it`);
    let bytes: Uint8Array<ArrayBuffer> | undefined;
    try {
      bytes = readFileSync(grantedFile(ctx.root, page.files, ctx.deniedFiles, path).real);
    } catch (e) {
      if (!(e instanceof HttpError) || e.status !== 404) throw e;
      const hosted = await ctx.pageFiles?.(path, signal);
      if (hosted === undefined || hosted === "missing") throw missing(path);
      if (hosted === "too-large" || hosted.length > MAX_PAGE_FILE_BYTES) throw tooLarge(path);
      bytes = hosted;
    }
    return new Response(bytes, { headers: { ...FILE_HEADERS, "content-type": contentTypeOf(path) } });
  });

  router.add(
    "PUT",
    "/api/pages/:page/file",
    async ({ params, query, body, signal }) => {
      const { page, path } = writableRequest(ctx, params, query);
      if (!writableType(path))
        throw new HttpError(415, `${path}: a page may write only PNG, JPEG, GIF, WebP or PDF files`);
      const data = (body as { data?: unknown } | undefined)?.data;
      if (typeof data !== "string" || !BASE64.test(data)) throw new HttpError(400, "data must be base64");
      const bytes = Buffer.from(data, "base64");
      if (bytes.length > MAX_PAGE_FILE_BYTES) throw tooLarge(path);
      if (!bytesMatchType(path, bytes)) throw new HttpError(415, `${path}: the content is not ${contentTypeOf(path)}`);
      const base = baseOf(body);
      const hosted = await hostedFile(ctx, writeTarget(ctx.root, page, ctx.deniedFiles, path), path, signal);
      // again, as the folders may have changed while the host answered
      const target = writeTarget(ctx.root, page, ctx.deniedFiles, path);
      checkBase(target, path, base, hosted);
      replaceFile(target, bytes);
      return { sha256: hashContent(bytes) };
    },
    { maxBody: MAX_WRITE_BODY },
  );

  router.add("DELETE", "/api/pages/:page/file", async ({ params, query, body, signal }) => {
    const { page, path } = writableRequest(ctx, params, query);
    const base = baseOf(body);
    const hosted = await hostedFile(ctx, writeTarget(ctx.root, page, ctx.deniedFiles, path), path, signal);
    // again, as the folders may have changed while the host answered
    const target = writeTarget(ctx.root, page, ctx.deniedFiles, path);
    const from = checkBase(target, path, base, hosted);
    if (from === null) throw missing(path);
    if (from === "host") throw new HttpError(409, `${path} is kept by the host and cannot be deleted here`);
    unlinkSync(target);
    return { ok: true };
  });
};
