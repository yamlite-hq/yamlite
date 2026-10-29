import { symlinkSync } from "node:fs";
import { join } from "node:path";
import type { MockLanguageModelV4 } from "ai/test";
import { afterEach, beforeEach, expect, test } from "vitest";
import { commit, git, useGitEnv } from "../gitrepo.ts";
import { read, waitFor, write } from "../helpers.ts";
import { scripted } from "../agent/model.ts";
import type { Served } from "./helpers.ts";
import { edit, repoServe } from "./repo.ts";

let t: Served | undefined;
beforeEach(() => useGitEnv());
afterEach(async () => {
  await t?.s.close();
  t = undefined;
});

async function serveWith(say: string) {
  const made: MockLanguageModelV4[] = [];
  ({ t } = await repoServe({
    ai: {
      keys: { anthropic: "k" },
      createModel: () => {
        const m = scripted([{ say }]);
        made.push(m);
        return m;
      },
    },
  }));
  return made;
}

const draft = (body: Record<string, unknown>) =>
  (t as Served).api("/api/git/review/draft", {
    method: "POST",
    body: { provider: "anthropic", locale: "en", ...body },
  });

const promptOf = (m: MockLanguageModelV4) => JSON.stringify(m.doGenerateCalls[0]?.prompt);

test("drafts a PR title and description from the chosen files' record changes, in the UI's language", async () => {
  const made = await serveWith(JSON.stringify({ title: " Rename task a ", body: "- a: A → A2" }));
  await edit(t!, "a", "A", "A2");
  await edit(t!, "b", "B", "B2");
  await waitFor(() => read(join(t!.root, "tasks/a.yaml")) === "title: A2\n");
  const r = await draft({ paths: ["tasks/a.yaml"], mode: "pr" });
  expect([r.status, r.body]).toEqual([200, { title: "Rename task a", body: "- a: A → A2" }]);
  const prompt = promptOf(made[0]!);
  expect(prompt).toContain("tasks/a.yaml (modified, table tasks)");
  expect(prompt).toContain("title: A → A2");
  expect(prompt).not.toContain("tasks/b.yaml");
  expect(prompt).toContain("language with this code: en");
});

test("drafts only a commit message when the changes go to an open PR", async () => {
  await serveWith(JSON.stringify({ title: "Add c" }));
  write(join(t!.root, "tasks/c.yaml"), "title: C\n");
  const r = await draft({ paths: ["tasks/c.yaml"], mode: "commit" });
  expect([r.status, r.body]).toEqual([200, { title: "Add c" }]);
});

test("passes the text of a changed file that holds no records", async () => {
  const made = await serveWith(JSON.stringify({ title: "Notes", body: "" }));
  write(join(t!.root, "README.md"), "old\n");
  commit(t!.root, "readme");
  write(join(t!.root, "README.md"), "new\n");
  const r = await draft({ paths: ["README.md"], mode: "pr" });
  expect(r.status).toBe(200);
  const prompt = promptOf(made[0]!);
  expect(prompt).toContain("before:\\nold");
  expect(prompt).toContain("after:\\nnew");
});

test("refuses a file without changes, an unknown mode and a provider without a key", async () => {
  await serveWith("{}");
  expect((await draft({ paths: ["tasks/a.yaml"], mode: "pr" })).body).toEqual({
    error: "tasks/a.yaml has no changes",
  });
  write(join(t!.root, "tasks/c.yaml"), "title: C\n");
  expect((await draft({ paths: ["tasks/c.yaml"], mode: "x" })).status).toBe(400);
  const noKey = await draft({ paths: ["tasks/c.yaml"], mode: "pr", provider: "openai" });
  expect([noKey.status, noKey.body.code]).toEqual([400, "no_key"]);
});

test("GET /api/git/pr is null on the default branch and without gh", async () => {
  ({ t } = await repoServe());
  expect((await t.api("/api/git/pr")).body).toEqual({ url: null });
  git(t.root, "switch", "-q", "-c", "topic");
  expect((await t.api("/api/git/pr")).body).toEqual({ url: null });
});

const systemOf = (m: MockLanguageModelV4) => (m.doGenerateCalls[0]!.prompt[0] as { content: string }).content;

test("a new PR follows the committed template, then yamlite.yaml's instructions, the PR ones last", async () => {
  const made = await serveWith(JSON.stringify({ title: "T", body: "B" }));
  write(join(t!.root, ".github/pull_request_template.md"), "## Why\n<!-- reason -->\n");
  commit(t!.root, "template");
  const saved = await t!.api("/api/ai/instructions");
  const put = await t!.api("/api/ai/instructions", {
    method: "PUT",
    body: { instructions: "Write in Japanese.", pullRequests: "Start with a verb.", base: saved.body.base },
  });
  expect(put.status).toBe(200);
  write(join(t!.root, "tasks/c.yaml"), "title: C\n");
  expect((await draft({ paths: ["tasks/c.yaml"], mode: "pr" })).status).toBe(200);
  const system = systemOf(made[0]!);
  const at = (s: string) => system.indexOf(s);
  expect(at("## Why")).toBeGreaterThan(at("language with this code: en"));
  expect(at("Write in Japanese.")).toBeGreaterThan(at("## Why"));
  expect(at("Start with a verb.")).toBeGreaterThan(at("Write in Japanese."));
});

test("a commit message leaves out the template and the PR instructions", async () => {
  const made = await serveWith(JSON.stringify({ title: "T" }));
  write(join(t!.root, "pull_request_template.md"), "## Why\n");
  commit(t!.root, "template");
  const { base } = (await t!.api("/api/ai/instructions")).body;
  await t!.api("/api/ai/instructions", {
    method: "PUT",
    body: { instructions: "Be brief.", pullRequests: "Start with a verb.", base },
  });
  write(join(t!.root, "tasks/c.yaml"), "title: C\n");
  expect((await draft({ paths: ["tasks/c.yaml"], mode: "commit" })).status).toBe(200);
  const system = systemOf(made[0]!);
  expect(system).toContain("Be brief.");
  expect(system).not.toContain("## Why");
  expect(system).not.toContain("Start with a verb.");
});

test("a symlink, a binary file and a large file are not sent as text", async () => {
  const made = await serveWith(JSON.stringify({ title: "T", body: "" }));
  write(join(t!.root, "secret.txt"), "SECRET\n");
  symlinkSync(join(t!.root, "secret.txt"), join(t!.root, "link.txt"));
  write(join(t!.root, "blob.bin"), "a\0b");
  write(join(t!.root, "big.txt"), "x".repeat(70_000));
  const r = await draft({ paths: ["link.txt", "blob.bin", "big.txt"], mode: "pr" });
  expect(r.status).toBe(200);
  const prompt = promptOf(made[0]!);
  expect(prompt).not.toContain("SECRET");
  expect(prompt).toContain("(a symbolic link)");
  expect(prompt.match(/not shown: a binary file/g)).toHaveLength(2);
});
