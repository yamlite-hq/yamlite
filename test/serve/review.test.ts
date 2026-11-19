import { join } from "node:path";
import { afterEach, beforeEach, expect, test } from "vitest";
import { commit, git, useGitEnv, withRemote } from "../gitrepo.ts";
import { dataRoot, read, waitFor, write } from "../helpers.ts";
import { type Served, startServe } from "./helpers.ts";
import { edit, gitOf, repoServe } from "./repo.ts";

let t: Served | undefined;
beforeEach(() => useGitEnv());
afterEach(async () => {
  await t?.s.close();
  t = undefined;
});

test("GET /api/git is null outside a repository, and the other git routes answer 404", async () => {
  t = await startServe({ "tasks/a.yaml": "title: A\n" }, undefined, { gh: null });
  expect(await gitOf(t)).toBeNull();
  const noRepo = { error: "the data folder is not in a git repository" };
  const diff = await t.api("/api/git/diff?path=tasks/a.yaml");
  expect([diff.status, diff.body]).toEqual([404, noRepo]);
  const back = await t.api("/api/git/revert", { method: "POST", body: { records: [{ table: "tasks", key: "a" }] } });
  expect([back.status, back.body]).toEqual([404, noRepo]);
  const review = await t.api("/api/git/review", { method: "POST", body: { title: "T", paths: ["tasks/a.yaml"] } });
  expect(review.status).toBe(404);
});

test("GET /api/git is null without an origin remote", async () => {
  const root = dataRoot();
  write(join(root, "tasks/a.yaml"), "title: A\n");
  git(root, "init", "-q", "-b", "main");
  commit(root, "init");
  t = await startServe({}, undefined, { root, gh: null });
  expect(await gitOf(t)).toBeNull();
});

test("GET /api/git lists changed files with their table and key", async () => {
  ({ t } = await repoServe());
  write(join(t.root, "tasks/c.yaml"), "title: C\n");
  git(t.root, "rm", "-q", "tasks/b.yaml");
  write(join(t.root, "people.yaml"), "- id: 1\n  name: Alicia\n");
  await edit(t, "a", "A", "A2");
  await waitFor(() => read(join(t!.root, "tasks/a.yaml")) === "title: A2\n");
  const body = await gitOf(t);
  expect(body).toMatchObject({ branch: "main", defaultBranch: "main" });
  expect(body.changes).toEqual([
    {
      path: "people.yaml",
      status: "modified",
      table: "people",
      records: [{ key: "1", kind: "modified", fields: ["name"] }],
    },
    {
      path: "tasks/a.yaml",
      status: "modified",
      table: "tasks",
      records: [{ key: "a", kind: "modified", fields: ["title"] }],
    },
    { path: "tasks/b.yaml", status: "deleted", table: "tasks", records: [{ key: "b", kind: "deleted", fields: [] }] },
    { path: "tasks/c.yaml", status: "added", table: "tasks", records: [{ key: "c", kind: "added", fields: [] }] },
  ]);
});

test("review from the default branch creates a branch, commits the chosen files, pushes and links a PR", async () => {
  let bare: string;
  ({ t, bare } = await repoServe());
  git(t.root, "remote", "set-url", "origin", "https://github.com/acme/notes.git");
  git(t.root, "remote", "set-url", "--push", "origin", bare);
  await edit(t, "a", "A", "A2");
  await edit(t, "b", "B", "B2");
  const r = await t.api("/api/git/review", {
    method: "POST",
    body: { title: "Update a", body: "why", paths: ["tasks/a.yaml"] },
  });
  expect(r.status).toBe(200);
  const branch = r.body.branch as string;
  expect(branch).toMatch(/^yamlite\/review-\d{8}-\d{6}$/);
  expect(r.body.results.map((s: { status: string }) => s.status)).toEqual(["done", "done", "done", "done"]);
  expect(r.body.url).toMatch(/^https:\/\/github\.com\/acme\/notes\/compare\/main\.\.\.yamlite%2Freview-/);
  expect(git(bare, "show", `${branch}:tasks/a.yaml`)).toBe("title: A2\n");
  expect(git(bare, "show", `${branch}:tasks/b.yaml`)).toBe("title: B\n");
  expect(git(bare, "log", "-1", "--format=%s", branch).trim()).toBe("Update a");
  const after = await gitOf(t);
  expect(after.branch).toBe(branch);
  expect(after.changes).toEqual([
    {
      path: "tasks/b.yaml",
      status: "modified",
      table: "tasks",
      records: [{ key: "b", kind: "modified", fields: ["title"] }],
    },
  ]);
});

test("review on a pushed branch adds a commit without a new branch", async () => {
  let bare: string;
  ({ t, bare } = await repoServe());
  git(t.root, "switch", "-q", "-c", "work");
  git(t.root, "push", "-q", "-u", "origin", "work");
  await edit(t, "a", "A", "A2");
  const r = await t.api("/api/git/review", {
    method: "POST",
    body: { title: "More", body: "", paths: ["tasks/a.yaml"] },
  });
  expect(r.status).toBe(200);
  expect(r.body.branch).toBe("work");
  expect(r.body.steps).toEqual(["commit", "push", "open_pr"]);
  // a remote that is not on GitHub: pushed, but no PR link
  expect(r.body.results.map((s: { status: string }) => s.status)).toEqual(["done", "done", "failed"]);
  expect(r.body.error).toMatch(/not a GitHub repository/);
  expect(git(bare, "show", "work:tasks/a.yaml")).toBe("title: A2\n");
});

test("review from the default branch uses the given branch name", async () => {
  let bare: string;
  ({ t, bare } = await repoServe());
  await edit(t, "a", "A", "A2");
  const r = await t.api("/api/git/review", {
    method: "POST",
    body: { title: "Update a", paths: ["tasks/a.yaml"], branch: " fix/tasks " },
  });
  expect(r.status).toBe(200);
  expect(r.body.branch).toBe("fix/tasks");
  expect(git(bare, "show", "fix/tasks:tasks/a.yaml")).toBe("title: A2\n");
});

test("review refuses a branch name that exists, is invalid, or is given off the default branch", async () => {
  ({ t } = await repoServe());
  await edit(t, "a", "A", "A2");
  const send = (branch: string) =>
    t!.api("/api/git/review", { method: "POST", body: { title: "x", paths: ["tasks/a.yaml"], branch } });
  git(t.root, "branch", "taken");
  expect(await send("taken")).toMatchObject({ status: 400, body: { error: "branch taken already exists" } });
  expect((await send("bad..name")).status).toBe(400);
  git(t.root, "switch", "-q", "taken");
  expect(await send("other")).toMatchObject({
    status: 400,
    body: { error: "already on taken; a branch name is only for a new branch" },
  });
});

test("review refuses paths outside the data root and empty selections", async () => {
  ({ t } = await repoServe());
  const outside = await t.api("/api/git/review", { method: "POST", body: { title: "x", paths: ["../x.yaml"] } });
  expect(outside.status).toBe(400);
  const none = await t.api("/api/git/review", { method: "POST", body: { title: "x", paths: [] } });
  expect(none.status).toBe(400);
  const untitled = await t.api("/api/git/review", { method: "POST", body: { title: " ", paths: ["tasks/a.yaml"] } });
  expect(untitled.status).toBe(400);
});

test("a review is refused with 409 while other git steps run", async () => {
  ({ t } = await repoServe());
  await edit(t, "a", "A", "A2");
  let release!: () => void;
  const held = t.s.context.proposals.exclusive(() => new Promise<void>((r) => (release = r)));
  const r = await t.api("/api/git/review", { method: "POST", body: { title: "one", paths: ["tasks/a.yaml"] } });
  expect(r.status).toBe(409);
  release();
  await held;
  expect(
    (await t.api("/api/git/review", { method: "POST", body: { title: "one", paths: ["tasks/a.yaml"] } })).status,
  ).toBe(200);
});

test("while a review runs, form writes get 409", async () => {
  ({ t } = await repoServe());
  let release!: () => void;
  const held = t.s.context.proposals.exclusive(() => new Promise<void>((r) => (release = r)));
  expect((await edit(t, "b", "B", "B2")).status).toBe(409);
  release();
  await held;
  expect((await edit(t, "b", "B", "B2")).status).toBe(200);
});

test("a table's files outside the data folder are listed, compared and sent for review; other files out there are not", async () => {
  const top = dataRoot();
  const root = join(top, "data");
  write(
    join(root, "yamlite.yaml"),
    'tables:\n  events:\n    files: "../spec/events/*.yaml"\n    columns:\n      title: TEXT\n',
  );
  write(join(top, "spec/events/a.yaml"), "title: A\n");
  write(join(top, "src/app.ts"), "x\n");
  const bare = withRemote(top);
  t = await startServe({}, undefined, { root, gh: null });
  git(top, "remote", "set-url", "origin", "https://github.com/acme/notes.git");
  git(top, "remote", "set-url", "--push", "origin", bare);
  write(join(top, "src/app.ts"), "y\n");
  await t.api("/api/tables/events/rows/a", { method: "PATCH", body: { values: { title: "B" }, base: { title: "A" } } });
  await waitFor(() => read(join(top, "spec/events/a.yaml")) === "title: B\n");
  expect((await gitOf(t)).changes).toEqual([
    {
      path: "../spec/events/a.yaml",
      status: "modified",
      table: "events",
      records: [{ key: "a", kind: "modified", fields: ["title"] }],
    },
  ]);
  const diff = await t.api(`/api/git/diff?path=${encodeURIComponent("../spec/events/a.yaml")}`);
  expect(diff.body.records).toEqual([{ key: "a", kind: "modified", fields: [{ field: "title", from: "A", to: "B" }] }]);
  const refused = await t.api("/api/git/review", { method: "POST", body: { title: "T", paths: ["../src/app.ts"] } });
  expect(refused.status).toBe(400);
  const r = await t.api("/api/git/review", { method: "POST", body: { title: "T", paths: ["../spec/events/a.yaml"] } });
  expect(r.status).toBe(200);
  expect(git(bare, "show", `${r.body.branch}:spec/events/a.yaml`)).toBe("title: B\n");
  expect(read(join(top, "src/app.ts"))).toBe("y\n");
});
