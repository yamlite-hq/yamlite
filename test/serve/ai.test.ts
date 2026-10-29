import { join } from "node:path";
import { afterEach, expect, test } from "vitest";
import { read, write } from "../helpers.ts";
import { type Served, startServe } from "./helpers.ts";

let t: Served | undefined;
afterEach(async () => {
  await t?.s.close();
  t = undefined;
});

const CONFIG = "# my data\ntables:\n  tasks: # todo\n    columns:\n      title: TEXT\n";

test("instructions are saved to yamlite.yaml, keeping the rest, and read back", async () => {
  t = await startServe({ "tasks/a.yaml": "title: A\n" }, CONFIG);
  const first = await t.api("/api/ai/instructions");
  expect(first.body).toMatchObject({ instructions: null, pullRequests: null });
  const put = await t.api("/api/ai/instructions", {
    method: "PUT",
    body: { instructions: " Write in English.\nBe brief. ", pullRequests: "", base: first.body.base },
  });
  expect(put.status).toBe(200);
  const file = read(join(t.root, "yamlite.yaml"));
  expect(file).toContain("# my data\n");
  expect(file).toContain("# todo\n");
  expect(file).toContain("ai:\n  instructions: |-\n    Write in English.\n    Be brief.\n");
  expect(file).not.toContain("pullRequests");
  const again = await t.api("/api/ai/instructions");
  expect(again.body).toEqual({
    instructions: "Write in English.\nBe brief.",
    pullRequests: null,
    base: put.body.base,
  });
});

test("a save made from an old read is refused with 409", async () => {
  t = await startServe({ "tasks/a.yaml": "title: A\n" }, CONFIG);
  const { base } = (await t.api("/api/ai/instructions")).body;
  write(join(t.root, "yamlite.yaml"), `${CONFIG}# edited elsewhere\n`);
  const put = await t.api("/api/ai/instructions", {
    method: "PUT",
    body: { instructions: "X", pullRequests: null, base },
  });
  expect(put.status).toBe(409);
  expect(read(join(t.root, "yamlite.yaml"))).not.toContain("instructions");
});

test("instructions too long for yamlite.yaml are refused and not written", async () => {
  t = await startServe({ "tasks/a.yaml": "title: A\n" }, CONFIG);
  const { base } = (await t.api("/api/ai/instructions")).body;
  const put = await t.api("/api/ai/instructions", {
    method: "PUT",
    body: { instructions: "x".repeat(4_001), pullRequests: null, base },
  });
  expect([put.status, put.body.error]).toEqual([400, "ai.instructions is longer than 4000 characters"]);
  expect(read(join(t.root, "yamlite.yaml"))).toBe(CONFIG);
});

test("GET reads the instructions from the file it hashes, even before the config reloads", async () => {
  t = await startServe({ "tasks/a.yaml": "title: A\n" }, CONFIG, { watch: { pollMs: 60_000, debounceMs: 60_000 } });
  write(join(t.root, "yamlite.yaml"), `${read(join(t.root, "yamlite.yaml"))}ai:\n  instructions: From the editor.\n`);
  expect((await t.api("/api/ai/instructions")).body.instructions).toBe("From the editor.");
});
