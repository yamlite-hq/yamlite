import { sha256 as nobleSha256 } from "@noble/hashes/sha2.js";
import { bytesToHex } from "@noble/hashes/utils.js";
import {
  canRead,
  canWrite,
  fileGranted,
  fileWritable,
  MAX_PAGE_FILE_BYTES,
  normalizeFilePath,
  notInAccess,
  writesAnything,
} from "../../../../src/pages/access.ts";
import { type Api, ApiError, type PageAiInput } from "../api";
import type { Filter, Meta, PageMeta, Row } from "../types";
import { type PageLocation, pagePath } from "./location";

export const READ_ONLY = "this page is read-only here";

export interface HostDeps {
  api: Pick<
    Api,
    | "rows"
    | "record"
    | "create"
    | "update"
    | "remove"
    | "pageSql"
    | "pageAi"
    | "pageAiStream"
    | "pageFile"
    | "pageWriteFile"
    | "pageDeleteFile"
  >;
  readOnly: boolean;
  // the provider that answers a page's AI calls, or null when the host holds no key
  ai(): { provider: string; models: string[] } | null;
  open(table: string, key: string): void;
  blocked(url: string): void;
  escape(): void;
  click(): void;
  theme(): "light" | "dark";
  location: PageLocation;
}

interface PageRequest {
  yamlite: 1;
  id?: number;
  method: string;
  args: unknown[];
}

const isRequest = (d: unknown): d is PageRequest =>
  typeof d === "object" &&
  d !== null &&
  (d as PageRequest).yamlite === 1 &&
  typeof (d as PageRequest).method === "string" &&
  Array.isArray((d as PageRequest).args);

const fail = (status: number, message: string) => new ApiError(status, message, { error: message });

function text(value: unknown, what: string): string {
  if (typeof value !== "string" || value === "") throw fail(400, `${what} must be a non-empty string`);
  return value;
}

function record(value: unknown, what: string): Row {
  if (value === undefined) return {};
  if (value === null || typeof value !== "object" || Array.isArray(value)) throw fail(400, `${what} must be an object`);
  return value as Row;
}

function blob(value: unknown, what: string): Blob {
  if (!(value instanceof Blob)) throw fail(400, `${what} must be a Blob`);
  return value;
}

// undefined skips the conflict check; null says the page expects no file there. A Blob is what files.read gave,
// a digest what files.write returned
async function fileBase(value: unknown): Promise<string | null | undefined> {
  const base = record(value, "options").base;
  if (base === undefined || base === null) return base;
  if (typeof base === "string" && /^[0-9a-f]{64}$/.test(base)) return base;
  if (base instanceof Blob) return sha256(base);
  throw fail(400, "base must be a Blob from files.read, a sha256 from files.write, or null");
}

function recordBase(value: unknown): Row | undefined {
  const base = record(value, "options").base;
  return base === undefined ? undefined : record(base, "base");
}

// crypto.subtle exists only in secure contexts, and the UI may be opened over plain http from another device
async function sha256(data: Blob): Promise<string> {
  return bytesToHex(nobleSha256(new Uint8Array(await data.arrayBuffer())));
}

async function base64(data: Blob): Promise<string> {
  const bytes = new Uint8Array(await data.arrayBuffer());
  let out = "";
  // String.fromCharCode takes its arguments on the stack; a whole image would overflow it
  for (let i = 0; i < bytes.length; i += 0x8000) out += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(out);
}

function toWireError(e: unknown) {
  if (e instanceof ApiError) {
    const { error: _message, ...extra } = e.body;
    return { status: e.status, message: e.message, extra };
  }
  return { status: 500, message: e instanceof Error ? e.message : String(e), extra: {} };
}

// the page's only way to the data: every call is checked against the page's access before it reaches the api
export class PageHost {
  private disposed = false;
  private readonly unlisten: () => void;
  private readonly streams = new Map<number, AbortController>();
  private readonly generating = new AbortController();

  constructor(
    private readonly frame: () => Window | null,
    private readonly page: () => PageMeta,
    private readonly meta: () => Meta,
    private readonly deps: HostDeps,
  ) {
    this.unlisten = deps.location.listen((path, state) =>
      this.post({ yamlite: 1, event: "location", data: { path, state } }),
    );
  }

  readonly handle = (e: MessageEvent): void => {
    const frame = this.frame();
    if (this.disposed || frame === null || e.source !== frame || !isRequest(e.data)) return;
    const { id, method, args } = e.data;
    if (method === "blocked") {
      if (typeof args[0] === "string") this.deps.blocked(args[0]);
      return;
    }
    if (method === "escape" || method === "click") {
      this.deps[method]();
      return;
    }
    // the page has already moved; these only keep the address with it
    if (method === "navigate") {
      const path = pagePath(args[0]);
      if (path !== null) this.deps.location.navigate(path, args[1] === true, args[2] ?? null);
      return;
    }
    if (method === "go") {
      if (Number.isInteger(args[0])) this.deps.location.go(args[0] as number);
      return;
    }
    if (method === "ai-cancel") {
      if (typeof args[0] === "number") this.streams.get(args[0])?.abort();
      return;
    }
    void this.answer(method, args, id).then(
      (value) => {
        this.post({ yamlite: 1, id, ok: true, value });
        if (method === "hello") this.theme(this.deps.theme());
      },
      (err: unknown) => this.post({ yamlite: 1, id, ok: false, error: toWireError(err) }),
    );
  };

  // a table's views change with it
  notify(tables: string[]): void {
    const touched = new Set(tables);
    for (const v of this.meta().views) if (touched.has(v.table)) touched.add(v.name);
    const visible = [...touched].filter((name) => canRead(this.page(), name));
    if (visible.length > 0) this.post({ yamlite: 1, event: "change", data: { tables: visible, files: [] } });
  }

  filesChanged(paths: string[]): void {
    const page = this.page();
    const visible = paths.filter((path) => fileGranted(page.files, path));
    if (visible.length > 0) this.post({ yamlite: 1, event: "change", data: { tables: [], files: visible } });
  }

  theme(theme: "light" | "dark"): void {
    this.post({ yamlite: 1, event: "theme", data: { theme } });
  }

  dispose(): void {
    this.disposed = true;
    this.unlisten();
    for (const stream of this.streams.values()) stream.abort();
    this.streams.clear();
    this.generating.abort();
  }

  private post(message: unknown): void {
    if (!this.disposed) this.frame()?.postMessage(message, "*");
  }

  private readable(name: unknown): string {
    const table = text(name, "table");
    if (!canRead(this.page(), table)) throw fail(403, notInAccess(table));
    return table;
  }

  private table(name: unknown): string {
    const table = this.readable(name);
    if (!this.meta().tables.some((t) => t.name === table))
      throw fail(400, `${table} is a view; its rows are not records`);
    return table;
  }

  private writable(name: unknown): string {
    const table = this.table(name);
    if (!canWrite(this.page(), table)) throw fail(403, `${table} is read-only for this page`);
    if (this.deps.readOnly) throw fail(403, READ_ONLY);
    return table;
  }

  private writablePath(value: unknown): string {
    const asked = text(value, "path");
    const path = normalizeFilePath(asked);
    if (path === null || path.endsWith("/") || !fileWritable(this.page().files, path))
      throw fail(403, `${asked} is not in the files this page may write`);
    if (this.deps.readOnly) throw fail(403, READ_ONLY);
    return path;
  }

  private aiInput(args: unknown[]): PageAiInput {
    const page = this.page();
    if (!page.ai) throw fail(403, `page ${page.name} may not use AI`);
    return record(args[0], "input") as unknown as PageAiInput;
  }

  // deltas go to the page as they come; a cancelled stream that still delivers is not passed on
  private async stream(id: unknown, args: unknown[]): Promise<null> {
    const input = this.aiInput(args);
    if (typeof id !== "number") throw fail(400, "a stream needs an id");
    const stop = new AbortController();
    this.streams.get(id)?.abort();
    this.streams.set(id, stop);
    try {
      for await (const text of this.deps.api.pageAiStream(this.page().name, input, stop.signal)) {
        if (stop.signal.aborted) break;
        this.post({ yamlite: 1, event: "ai-delta", id, data: { text } });
      }
    } catch (e) {
      if (!stop.signal.aborted) throw e;
    } finally {
      if (this.streams.get(id) === stop) this.streams.delete(id);
    }
    return null;
  }

  private async answer(method: string, args: unknown[], id: unknown): Promise<unknown> {
    const { api } = this.deps;
    const page = this.page();
    switch (method) {
      case "hello": {
        const ai = page.ai ? this.deps.ai() : null;
        return {
          page: page.name,
          title: page.title,
          access: page.access,
          sql: page.sql,
          network: page.network,
          files: page.files,
          readOnly: this.deps.readOnly || !writesAnything(page),
          ai,
        };
      }
      case "rows": {
        const table = this.readable(args[0]);
        const o = record(args[1], "options");
        return api.rows(table, {
          limit: typeof o.limit === "number" ? o.limit : 100,
          offset: typeof o.offset === "number" ? o.offset : 0,
          sort: typeof o.sort === "string" ? o.sort : undefined,
          filters: Array.isArray(o.filter) ? (o.filter as Filter[]) : [],
          search: typeof o.search === "string" ? o.search : undefined,
        });
      }
      case "get": {
        const table = this.table(args[0]);
        const { row, file } = await api.record(table, text(args[1], "key"));
        return { row, file };
      }
      case "create": {
        const table = this.writable(args[0]);
        return api.create(table, text(args[1], "key"), record(args[2], "values"));
      }
      case "update": {
        const table = this.writable(args[0]);
        return api.update(table, text(args[1], "key"), record(args[2], "values"), recordBase(args[3]));
      }
      case "remove": {
        const table = this.writable(args[0]);
        return api.remove(table, text(args[1], "key"), recordBase(args[2]));
      }
      case "sql":
        if (!page.sql) throw fail(403, `page ${page.name} may not run SQL`);
        return api.pageSql(page.name, text(args[0], "sql"));
      case "readFile": {
        const asked = text(args[0], "path");
        const path = normalizeFilePath(asked);
        if (path === null || !fileGranted(page.files, path)) throw fail(403, `${asked} is not in this page's files`);
        return api.pageFile(page.name, path);
      }
      case "writeFile": {
        const path = this.writablePath(args[0]);
        const data = blob(args[1], "data");
        if (data.size > MAX_PAGE_FILE_BYTES) throw fail(413, `${path} is larger than 10 MB`);
        const base = await fileBase(args[2]);
        return api.pageWriteFile(page.name, path, await base64(data), base);
      }
      case "deleteFile": {
        const path = this.writablePath(args[0]);
        await api.pageDeleteFile(page.name, path, await fileBase(args[1]));
        return null;
      }
      case "ai":
        return api.pageAi(page.name, this.aiInput(args), this.generating.signal);
      case "ai-stream":
        return this.stream(id, args);
      case "open": {
        const table = this.table(args[0]);
        this.deps.open(table, text(args[1], "key"));
        return null;
      }
      default:
        throw fail(400, `unknown method: ${method}`);
    }
  }
}
