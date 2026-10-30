import { existsSync, mkdirSync, readFileSync, readdirSync, symlinkSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { dirname, join } from "node:path";
import { afterEach, expect, test, vi } from "vitest";
import { MAX_PAGE_FILE_BYTES } from "../../src/pages/access.ts";
import type { PageFileResult } from "../../src/serve/workspace.ts";
import { browserFs, dataRoot, tmpRoot, write } from "../helpers.ts";
import { type Served, startServe, tasksWorkspace } from "./helpers.ts";

let t: Served | undefined;
afterEach(async () => {
  await t?.s.close();
  t = undefined;
});

const PNG = [0x89, 0x50, 0x4e, 0x47, 0xff, 0xfe];

const config = (files: string) =>
  "tables: {}\npages:\n  board:\n    path: .pages/board.html\n    access: {}\n" +
  `    files: ${files}\n  plain:\n    path: .pages/board.html\n    access: {}\n`;

function bytes(path: string, data: Uint8Array): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, data);
}

async function served(files = "{ .evidence/: read }", opts: Parameters<typeof startServe>[2] = {}) {
  t = await startServe(
    { ".pages/board.html": "<p>hi</p>", ".evidence-private/s.png": "secret", "secret.txt": "secret" },
    config(files),
    opts,
  );
  bytes(join(t.root, ".evidence/a.png"), new Uint8Array(PNG));
  return t;
}

async function get(s: Served, page: string, path?: string) {
  const qs = path === undefined ? "" : `?path=${path}`;
  return fetch(`${s.base}/api/pages/${page}/file${qs}`, { headers: { cookie: s.cookie } });
}

const status = async (s: Served, page: string, path?: string) => (await get(s, page, path)).status;

test("a granted file comes back as its bytes with a type from its extension", async () => {
  const s = await served();
  const res = await get(s, "board", ".evidence/a.png");
  expect(res.status).toBe(200);
  expect(res.headers.get("content-type")).toBe("image/png");
  expect(res.headers.get("cache-control")).toBe("no-store");
  expect(res.headers.get("x-content-type-options")).toBe("nosniff");
  expect(res.headers.get("content-security-policy")).toContain("sandbox");
  expect([...new Uint8Array(await res.arrayBuffer())]).toEqual(PNG);
});

test("an ungranted path, YAMLite's own files and a page without files are refused", async () => {
  const s = await served();
  expect(await status(s, "board", ".evidence-private/s.png")).toBe(403);
  expect(await status(s, "board", "yamlite.yaml")).toBe(403);
  expect(await status(s, "plain", ".evidence/a.png")).toBe(403);
  expect(await (await get(s, "board", "secret.txt")).json()).toEqual({
    error: "secret.txt is not in this page's files",
  });
});

test("a missing file, a missing path and an unknown page", async () => {
  const s = await served();
  expect(await status(s, "board", ".evidence/missing.png")).toBe(404);
  expect(await (await get(s, "board")).json()).toEqual({ error: "path is required" });
  expect(await status(s, "board")).toBe(400);
  expect(await status(s, "nope", ".evidence/a.png")).toBe(404);
});

test("traversal, encoded or not, is refused before it reaches the disk", async () => {
  const s = await served();
  expect(await status(s, "board", ".evidence/%2e%2e/secret.txt")).toBe(403);
  expect(await status(s, "board", ".evidence//../secret.txt")).toBe(403);
  expect(await status(s, "board", "%2Fetc%2Fpasswd")).toBe(403);
});

test.skipIf(browserFs)("a symlink that leaves the granted folder is refused", async () => {
  const s = await served();
  symlinkSync("../secret.txt", join(s.root, ".evidence/link.png"));
  expect(await status(s, "board", ".evidence/link.png")).toBe(403);
});

test.skipIf(browserFs)("a symlink that stays inside the granted folder is followed", async () => {
  const s = await served();
  symlinkSync("a.png", join(s.root, ".evidence/same.png"));
  const res = await get(s, "board", ".evidence/same.png");
  expect(res.status).toBe(200);
  expect([...new Uint8Array(await res.arrayBuffer())]).toEqual(PNG);
});

test("a database inside a granted folder is refused, whatever the case", async () => {
  const root = dataRoot();
  write(join(root, ".pages/board.html"), "<p>hi</p>");
  write(join(root, "data/note.txt"), "note");
  t = await startServe({}, config("{ data/: read }"), { root, db: join(root, "data/.yamlite/db.sqlite") });
  expect(await status(t, "board", "data/note.txt")).toBe(200);
  expect(await status(t, "board", "data/.yamlite/db.sqlite")).toBe(403);
  expect(await status(t, "board", "data/.YAMLITE/db.sqlite")).toBe(403);
});

test.skipIf(browserFs)("a database given through a symlinked spelling of the root is refused", async () => {
  const root = dataRoot();
  write(join(root, ".pages/board.html"), "<p>hi</p>");
  write(join(root, "data/note.txt"), "note");
  const link = join(tmpRoot(), "link");
  symlinkSync(root, link);
  t = await startServe({}, config("{ data/: read }"), { root, db: join(link, "data/.yamlite/db.sqlite") });
  expect(await status(t, "board", "data/note.txt")).toBe(200);
  expect(await status(t, "board", "data/.yamlite/db.sqlite")).toBe(403);
});

test.skipIf(browserFs)("a symlinked database is refused under its real name, with its sidecars", async () => {
  const root = dataRoot();
  write(join(root, ".pages/board.html"), "<p>hi</p>");
  write(join(root, "data/note.txt"), "note");
  write(join(root, "data/real.db"), "");
  symlinkSync("real.db", join(root, "data/link.db"));
  t = await startServe({}, config("{ data/: read }"), { root, db: join(root, "data/link.db") });
  expect(await status(t, "board", "data/note.txt")).toBe(200);
  for (const name of ["link.db", "real.db", "real.db-wal", "real.db-shm"])
    expect(await status(t, "board", `data/${name}`)).toBe(403);
});

test("a file over the size limit is 413", async () => {
  const s = await served();
  bytes(join(s.root, ".evidence/big.png"), new Uint8Array(MAX_PAGE_FILE_BYTES + 1));
  expect(await status(s, "board", ".evidence/big.png")).toBe(413);
});

test("the disk answers first, then a host's pageFiles, and only for granted paths", async () => {
  const hook = vi.fn(async (path: string): Promise<PageFileResult> => {
    if (path === ".evidence/lazy.png") return new Uint8Array([1, 2, 3]);
    if (path === ".evidence/big.png") return "too-large";
    if (path === ".evidence/gone.png") return "missing";
    return undefined;
  });
  const { w } = await tasksWorkspace({ pageFiles: hook }, (root) => {
    write(join(root, "yamlite.yaml"), config("{ .evidence/: read }"));
    write(join(root, ".pages/board.html"), "<p>hi</p>");
    write(join(root, ".evidence/disk.txt"), "on disk");
    write(join(root, "secret.txt"), "secret");
  });
  const ask = (path: string) => w.router.dispatch(new Request(`http://x/api/pages/board/file?path=${path}`));
  const lazy = await ask(".evidence/lazy.png");
  expect(lazy.status).toBe(200);
  expect(lazy.headers.get("content-type")).toBe("image/png");
  expect([...new Uint8Array(await lazy.arrayBuffer())]).toEqual([1, 2, 3]);
  expect((await ask(".evidence/big.png")).status).toBe(413);
  expect((await ask(".evidence/gone.png")).status).toBe(404);
  expect(await (await ask(".evidence/disk.txt")).text()).toBe("on disk");
  expect(hook.mock.calls.map((c) => c[0])).toEqual([".evidence/lazy.png", ".evidence/big.png", ".evidence/gone.png"]);
  hook.mockClear();
  expect((await ask("secret.txt")).status).toBe(403);
  expect((await ask("yamlite.yaml")).status).toBe(403);
  expect((await ask(".evidence/../secret.txt")).status).toBe(403);
  expect(hook).not.toHaveBeenCalled();
});

const PNG_FILE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3];
const b64 = (data: number[] | string) =>
  Buffer.from(typeof data === "string" ? data : new Uint8Array(data)).toString("base64");
const hex = (data: number[]) => createHash("sha256").update(new Uint8Array(data)).digest("hex");

async function send(s: Served, method: "PUT" | "DELETE", page: string, path: string, body: Record<string, unknown>) {
  return fetch(`${s.base}/api/pages/${page}/file?path=${encodeURIComponent(path)}`, {
    method,
    headers: { cookie: s.cookie, "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

const writable = () => served("{ .evidence/: write, docs/: read }");

test("a page writes a new file under a write entry, creating its folders", async () => {
  const s = await writable();
  const res = await send(s, "PUT", "board", ".evidence/new/b.png", { data: b64(PNG_FILE), base: null });
  expect(res.status).toBe(200);
  expect(await res.json()).toEqual({ sha256: hex(PNG_FILE) });
  expect([...readFileSync(join(s.root, ".evidence/new/b.png"))]).toEqual(PNG_FILE);
  expect(readdirSync(join(s.root, ".evidence/new"))).toEqual(["b.png"]);
  expect([...new Uint8Array(await (await get(s, "board", ".evidence/new/b.png")).arrayBuffer())]).toEqual(PNG_FILE);
});

test("base guards against overwriting a change the page has not seen", async () => {
  const s = await writable();
  const created = await send(s, "PUT", "board", ".evidence/a.png", { data: b64(PNG_FILE), base: null });
  expect(created.status).toBe(409);
  const stale = await send(s, "PUT", "board", ".evidence/a.png", { data: b64(PNG_FILE), base: hex([1]) });
  expect(stale.status).toBe(409);
  expect(await stale.json()).toMatchObject({ current: hex(PNG) });
  expect((await send(s, "PUT", "board", ".evidence/a.png", { data: b64(PNG_FILE), base: hex(PNG) })).status).toBe(200);
  expect([...readFileSync(join(s.root, ".evidence/a.png"))]).toEqual(PNG_FILE);
  expect((await send(s, "PUT", "board", ".evidence/a.png", { data: b64(PNG_FILE) })).status).toBe(200);
});

test("only write entries, writable types and matching bytes are written", async () => {
  const s = await writable();
  const status = async (path: string, data: string) => (await send(s, "PUT", "board", path, { data })).status;
  expect(await status("docs/a.png", b64(PNG_FILE))).toBe(403);
  expect(await status("secret.png", b64(PNG_FILE))).toBe(403);
  expect(await status(".evidence/../secret.png", b64(PNG_FILE))).toBe(403);
  expect(await status(".evidence/", b64(PNG_FILE))).toBe(403);
  expect(await status(".evidence/x.svg", b64("<svg/>"))).toBe(415);
  expect(await status(".evidence/x.html", b64("<p>"))).toBe(415);
  expect(await status(".evidence/x.png", b64("<svg onload=alert(1)>"))).toBe(415);
  expect(await status(".evidence/x.png", "not base64!")).toBe(400);
  expect((await send(s, "PUT", "plain", ".evidence/x.png", { data: b64(PNG_FILE) })).status).toBe(403);
  expect(existsSync(join(s.root, "docs/a.png"))).toBe(false);
});

test("a write may not land on YAMLite's own files", async () => {
  const root = dataRoot();
  write(join(root, ".pages/board.html"), "<p>hi</p>");
  t = await startServe({}, config("{ data/: write }"), { root, db: join(root, "data/.yamlite/db.sqlite") });
  for (const path of ["data/.yamlite/db.sqlite", "data/.YAMLITE/db.sqlite-wal"]) {
    const res = await send(t, "PUT", "board", path, { data: b64(PNG_FILE) });
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: `${path} is YAMLite's own and no page may write it` });
  }
});

test("a body over the write limit is 413", async () => {
  const s = await writable();
  const big = new Uint8Array(MAX_PAGE_FILE_BYTES + 1);
  big.set(PNG_FILE);
  const data = Buffer.from(big).toString("base64");
  expect((await send(s, "PUT", "board", ".evidence/big.png", { data })).status).toBe(413);
});

test.skipIf(browserFs)("a write through a symlink, to the file or out of the folder, is refused", async () => {
  const s = await writable();
  mkdirSync(join(s.root, "outside"));
  symlinkSync("../outside", join(s.root, ".evidence/out"));
  symlinkSync("a.png", join(s.root, ".evidence/link.png"));
  expect((await send(s, "PUT", "board", ".evidence/out/x.png", { data: b64(PNG_FILE) })).status).toBe(403);
  expect((await send(s, "PUT", "board", ".evidence/link.png", { data: b64(PNG_FILE) })).status).toBe(403);
  expect(existsSync(join(s.root, "outside/x.png"))).toBe(false);
  expect([...readFileSync(join(s.root, ".evidence/a.png"))]).toEqual(PNG);
});

test.skipIf(browserFs)("a folder that is a symlink leading nowhere is 409, not a server error", async () => {
  const s = await writable();
  symlinkSync("gone", join(s.root, ".evidence/old"));
  expect((await send(s, "PUT", "board", ".evidence/old/x.png", { data: b64(PNG_FILE) })).status).toBe(409);
});

test("a file over the size limit is not read, and no base matches it", async () => {
  const s = await writable();
  bytes(join(s.root, ".evidence/big.png"), new Uint8Array(MAX_PAGE_FILE_BYTES + 1));
  const res = await send(s, "PUT", "board", ".evidence/big.png", { data: b64(PNG_FILE), base: hex(PNG) });
  expect(res.status).toBe(409);
  expect(await res.json()).not.toHaveProperty("current");
});

test("of two creates racing for one new file, only one is written", async () => {
  let release!: () => void;
  const gate = new Promise<void>((r) => (release = r));
  const hook = vi.fn(async (): Promise<PageFileResult> => {
    await gate;
    return "missing";
  });
  const { w } = await tasksWorkspace({ pageFiles: hook }, (root) => {
    write(join(root, "yamlite.yaml"), config("{ .evidence/: write }"));
    write(join(root, ".pages/board.html"), "<p>hi</p>");
  });
  const create = () =>
    w.router.dispatch(
      new Request("http://x/api/pages/board/file?path=.evidence/new.png", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ data: b64(PNG_FILE), base: null }),
      }),
    );
  const both = Promise.all([create(), create()]);
  await vi.waitFor(() => expect(hook).toHaveBeenCalledTimes(2));
  release();
  expect((await both).map((r) => r.status).sort()).toEqual([200, 409]);
});

test("a page deletes a file it may write, checked against base", async () => {
  const s = await writable();
  expect((await send(s, "DELETE", "board", ".evidence/a.png", { base: hex([1]) })).status).toBe(409);
  expect((await send(s, "DELETE", "board", ".evidence/a.png", { base: hex(PNG) })).status).toBe(200);
  expect(existsSync(join(s.root, ".evidence/a.png"))).toBe(false);
  expect((await send(s, "DELETE", "board", ".evidence/a.png", {})).status).toBe(404);
  write(join(s.root, "docs/d.png"), "x");
  expect((await send(s, "DELETE", "board", "docs/d.png", {})).status).toBe(403);
});

test("a written file shadows the host's copy, and base sees a file only the host holds", async () => {
  const hook = vi.fn(async (path: string): Promise<PageFileResult> =>
    path === ".evidence/lazy.png" ? new Uint8Array(PNG) : "missing",
  );
  const { w } = await tasksWorkspace({ pageFiles: hook }, (root) => {
    write(join(root, "yamlite.yaml"), config("{ .evidence/: write }"));
    write(join(root, ".pages/board.html"), "<p>hi</p>");
  });
  const call = (method: string, body?: unknown) =>
    w.router.dispatch(
      new Request("http://x/api/pages/board/file?path=.evidence/lazy.png", {
        method,
        headers: body === undefined ? {} : { "content-type": "application/json" },
        body: body === undefined ? undefined : JSON.stringify(body),
      }),
    );
  expect((await call("PUT", { data: b64(PNG_FILE), base: null })).status).toBe(409);
  expect((await call("DELETE", {})).status).toBe(409);
  expect((await call("PUT", { data: b64(PNG_FILE), base: hex(PNG) })).status).toBe(200);
  expect([...new Uint8Array(await (await call("GET")).arrayBuffer())]).toEqual(PNG_FILE);
});
