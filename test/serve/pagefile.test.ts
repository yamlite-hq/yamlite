import { mkdirSync, symlinkSync, writeFileSync } from "node:fs";
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

async function served(files = "[.evidence/]", opts: Parameters<typeof startServe>[2] = {}) {
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
  t = await startServe({}, config("[data/]"), { root, db: join(root, "data/.yamlite/db.sqlite") });
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
  t = await startServe({}, config("[data/]"), { root, db: join(link, "data/.yamlite/db.sqlite") });
  expect(await status(t, "board", "data/note.txt")).toBe(200);
  expect(await status(t, "board", "data/.yamlite/db.sqlite")).toBe(403);
});

test.skipIf(browserFs)("a symlinked database is refused under its real name, with its sidecars", async () => {
  const root = dataRoot();
  write(join(root, ".pages/board.html"), "<p>hi</p>");
  write(join(root, "data/note.txt"), "note");
  write(join(root, "data/real.db"), "");
  symlinkSync("real.db", join(root, "data/link.db"));
  t = await startServe({}, config("[data/]"), { root, db: join(root, "data/link.db") });
  expect(await status(t, "board", "data/note.txt")).toBe(200);
  for (const name of ["link.db", "real.db", "real.db-wal", "real.db-shm"])
    expect(await status(t, "board", `data/${name}`)).toBe(403);
});

test("a file over the size limit is 413", async () => {
  const s = await served();
  bytes(join(s.root, ".evidence/big.png"), new Uint8Array(MAX_PAGE_FILE_BYTES + 1));
  expect(await status(s, "board", ".evidence/big.png")).toBe(413);
});

test("a host's pageFiles answers before the disk, and only for granted paths", async () => {
  const hook = vi.fn(async (path: string): Promise<PageFileResult> => {
    if (path === ".evidence/lazy.png") return new Uint8Array([1, 2, 3]);
    if (path === ".evidence/big.png") return "too-large";
    if (path === ".evidence/gone.png") return "missing";
    return undefined;
  });
  const { w } = await tasksWorkspace({ pageFiles: hook }, (root) => {
    write(join(root, "yamlite.yaml"), config("[.evidence/]"));
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
  expect(hook.mock.calls.map((c) => c[0])).toEqual([
    ".evidence/lazy.png",
    ".evidence/big.png",
    ".evidence/gone.png",
    ".evidence/disk.txt",
  ]);
  hook.mockClear();
  expect((await ask("secret.txt")).status).toBe(403);
  expect((await ask("yamlite.yaml")).status).toBe(403);
  expect((await ask(".evidence/../secret.txt")).status).toBe(403);
  expect(hook).not.toHaveBeenCalled();
});
