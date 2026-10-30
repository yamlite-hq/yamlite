import { join } from "node:path";
import { afterEach, expect, test } from "vitest";
import { FileWatch } from "../../src/serve/filewatch.ts";
import type { PageSpec } from "../../src/types.ts";
import { tmpRoot, waitFor, write } from "../helpers.ts";

let watch: FileWatch | undefined;
afterEach(async () => {
  await watch?.close();
  watch = undefined;
});

const page = (files: PageSpec["files"]): PageSpec => ({
  name: "board",
  path: "b.html",
  title: "Board",
  access: {},
  sql: false,
  network: [],
  files,
  ai: null,
});

test("changes under a page's files are reported, even in a folder made after the watch began", async () => {
  const root = tmpRoot();
  const seen: string[] = [];
  watch = new FileWatch(root, ["data/db.sqlite"], (paths) => seen.push(...paths), 20);
  await watch.update([page({ ".images/": "read", "logo.png": "write", "data/": "read" })]);
  write(join(root, ".images/new/a.png"), "a");
  write(join(root, "logo.png"), "l");
  write(join(root, "other.png"), "o");
  write(join(root, "data/db.sqlite"), "d");
  write(join(root, ".images/.yamlite-1.tmp"), "t");
  await waitFor(() => seen.includes(".images/new/a.png") && seen.includes("logo.png"), 3000);
  await new Promise((r) => setTimeout(r, 200));
  expect(seen).not.toContain("other.png");
  expect(seen).not.toContain("data/db.sqlite");
  expect(seen).not.toContain(".images/.yamlite-1.tmp");
});

test("an entry added by a config reload is watched from then on", async () => {
  const root = tmpRoot();
  const seen: string[] = [];
  watch = new FileWatch(root, [], (paths) => seen.push(...paths), 20);
  await watch.update([page({})]);
  await watch.update([page({ "shots/": "write" })]);
  write(join(root, "shots/a.png"), "a");
  await waitFor(() => seen.includes("shots/a.png"), 3000);
});
