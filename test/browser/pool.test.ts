import { expect, test } from "vitest";

const start = (name: string) => {
  const worker = new Worker(new URL("./pool.worker.ts", import.meta.url), { type: "module" });
  // oxlint-disable-next-line typescript/no-explicit-any
  const out = new Promise<any>((done) => {
    worker.onmessage = (e) => done(e.data);
    worker.onerror = (e) => done({ error: e.message || "worker failed to start" });
  });
  worker.postMessage(name);
  return { worker, out };
};

test("workers with pools of their own keep databases in OPFS at the same time", async () => {
  const a = start("yamlite-a");
  const b = start("yamlite-b");
  const [ra, rb] = await Promise.all([a.out, b.out]);
  a.worker.terminate();
  b.worker.terminate();
  expect(ra).toEqual({ rows: [{ name: "yamlite-a" }], files: ["/db.sqlite"] });
  expect(rb).toEqual({ rows: [{ name: "yamlite-b" }], files: ["/db.sqlite"] });
}, 60_000);
