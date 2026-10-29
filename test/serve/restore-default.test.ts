import { existsSync, rmSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, expect, test } from "vitest";
import { commit, git, useGitEnv } from "../gitrepo.ts";
import { read, sql, waitFor, write } from "../helpers.ts";
import { type Served, waitForAsync } from "./helpers.ts";
import { gitOf, repoServe } from "./repo.ts";

let t: Served | undefined;
beforeEach(() => useGitEnv());
afterEach(async () => {
  await t?.s.close();
  t = undefined;
});

const restore = (t: Served, files: unknown) => t.api("/api/git/restore-default", { method: "POST", body: { files } });

// a pushed review branch that changes a, removes b and adds c and notes.txt
async function reviewServe(): Promise<Served> {
  const { t } = await repoServe();
  git(t.root, "switch", "-q", "-c", "work");
  write(join(t.root, "tasks/a.yaml"), "title: A2\n");
  rmSync(join(t.root, "tasks/b.yaml"));
  write(join(t.root, "tasks/c.yaml"), "title: C\n");
  write(join(t.root, "notes.txt"), "x\n");
  commit(t.root, "review");
  git(t.root, "push", "-q", "-u", "origin", "work");
  await waitFor(
    () =>
      sql(t.db, "SELECT id FROM tasks ORDER BY id")
        .map((r) => r.id)
        .join() === "a,c",
  );
  return t;
}

test("the restore is offered only on a review branch", async () => {
  t = await reviewServe();
  expect((await gitOf(t)).restoresDefault).toBe(true);
  git(t.root, "switch", "-q", "main");
  await waitForAsync(async () => (await gitOf(t!)).branch === "main");
  expect((await gitOf(t)).restoresDefault).toBe(false);
  expect((await t.api("/api/git/default")).body.files).toEqual([]);
});

test("GET /api/git/default lists what the review changes, marking files with unsent edits", async () => {
  t = await reviewServe();
  // a change the default branch made after the review left it is not part of the review
  git(t.root, "switch", "-q", "main");
  write(join(t.root, "people.yaml"), "- id: 1\n  name: Alicia\n");
  commit(t.root, "elsewhere");
  git(t.root, "push", "-q");
  git(t.root, "switch", "-q", "work");
  write(join(t.root, "tasks/a.yaml"), "title: A3\n");
  const r = await t.api("/api/git/default");
  expect(r.status).toBe(200);
  expect(r.body.files).toEqual([
    { path: "notes.txt", status: "added", table: null, unsent: false },
    { path: "tasks/a.yaml", status: "modified", table: "tasks", unsent: true },
    { path: "tasks/b.yaml", status: "deleted", table: "tasks", unsent: false },
    { path: "tasks/c.yaml", status: "added", table: "tasks", unsent: false },
  ]);
});

test("restore writes the default branch's files, removes the ones it has not, and leaves them to send", async () => {
  t = await reviewServe();
  git(t.root, "switch", "-q", "main");
  write(join(t.root, "tasks/a.yaml"), "# newer\ntitle: A1\n");
  commit(t.root, "newer a");
  git(t.root, "push", "-q");
  git(t.root, "switch", "-q", "work");
  await waitFor(() => read(join(t!.root, "tasks/a.yaml")) === "title: A2\n");
  const r = await restore(t, ["tasks/a.yaml", "tasks/b.yaml", "tasks/c.yaml"]);
  expect(r.status).toBe(200);
  expect(r.body).toEqual({ files: ["tasks/a.yaml", "tasks/b.yaml", "tasks/c.yaml"] });
  // the default branch's tip, not where the review left it
  expect(read(join(t.root, "tasks/a.yaml"))).toBe("# newer\ntitle: A1\n");
  expect(read(join(t.root, "tasks/b.yaml"))).toBe("title: B\n");
  expect(existsSync(join(t.root, "tasks/c.yaml"))).toBe(false);
  expect(read(join(t.root, "notes.txt"))).toBe("x\n");
  expect(sql(t.db, "SELECT id, title FROM tasks ORDER BY id")).toEqual([
    { id: "a", title: "A1" },
    { id: "b", title: "B" },
  ]);
  const after = await gitOf(t);
  expect(after.branch).toBe("work");
  expect(after.changes.map((c: { path: string; status: string }) => [c.path, c.status])).toEqual([
    ["tasks/a.yaml", "modified"],
    ["tasks/b.yaml", "added"],
    ["tasks/c.yaml", "deleted"],
  ]);
});

test("restore overwrites unsent edits", async () => {
  t = await reviewServe();
  await t.api("/api/tables/tasks/rows/a", {
    method: "PATCH",
    body: { values: { title: "A3" }, base: { title: "A2" } },
  });
  expect((await restore(t, ["tasks/a.yaml"])).status).toBe(200);
  expect(read(join(t.root, "tasks/a.yaml"))).toBe("title: A\n");
  expect(sql(t.db, "SELECT title FROM tasks WHERE id = 'a'")).toEqual([{ title: "A" }]);
});

test("restore refuses files the review does not change, outside the data folder, or none, and writes nothing then", async () => {
  t = await reviewServe();
  for (const files of [["people.yaml"], ["../x.txt"], ["tasks/c.yaml", "people.yaml"], [3], [], "tasks/a.yaml"]) {
    expect((await restore(t, files)).status).toBe(400);
  }
  expect(read(join(t.root, "tasks/c.yaml"))).toBe("title: C\n");
});

test("restore is refused with 409 while git steps run", async () => {
  t = await reviewServe();
  let release!: () => void;
  const held = t.s.context.proposals.exclusive(() => new Promise<void>((r) => (release = r)));
  expect((await restore(t, ["tasks/a.yaml"])).status).toBe(409);
  expect(read(join(t.root, "tasks/a.yaml"))).toBe("title: A2\n");
  release();
  await held;
});
