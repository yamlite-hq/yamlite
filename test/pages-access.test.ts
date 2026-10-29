import { expect, test } from "vitest";
import {
  accessBrief,
  accessSummary,
  canRead,
  canWrite,
  contentTypeOf,
  DENIED_FILES,
  deniedFile,
  fileGranted,
  normalizeFilePath,
  notInAccess,
  type PageRules,
  pageCsp,
  trustedViews,
  writesAnything,
} from "../src/pages/access.ts";

const page = (access: PageRules["access"], extra: Partial<PageRules> = {}): PageRules => ({
  name: "board",
  access,
  sql: false,
  network: [],
  files: [],
  ai: null,
  ...extra,
});

test("read covers both levels, write only write", () => {
  const p = page({ tasks: "write", people: "read" });
  expect([canRead(p, "tasks"), canRead(p, "people"), canRead(p, "secret")]).toEqual([true, true, false]);
  expect([canWrite(p, "tasks"), canWrite(p, "people"), canWrite(p, "secret")]).toEqual([true, false, false]);
  expect(canRead(p, "constructor")).toBe(false);
  expect(writesAnything(p)).toBe(true);
  expect(writesAnything(page({ people: "read" }))).toBe(false);
  expect(notInAccess("secret")).toBe("secret is not in this page's access");
});

test("a view is trusted with every view it is built on, but not its table", () => {
  const views = [
    { name: "projects__milestones", parent: "projects" },
    { name: "projects__milestones__tasks", parent: "projects__milestones" },
    { name: "people__tags", parent: "people" },
  ];
  expect([...trustedViews(page({ projects__milestones__tasks: "read", people: "read" }), views)].sort()).toEqual([
    "projects__milestones",
    "projects__milestones__tasks",
  ]);
  expect(trustedViews(page({ projects: "read" }), views).size).toBe(0);
});

test("the policy blocks everything but inline code without network", () => {
  expect(pageCsp([])).toBe(
    "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data: blob:; " +
      "font-src data:; connect-src 'none'; form-action 'none'; base-uri 'none'",
  );
});

test("network origins are allowed for scripts, styles, images, fonts and connections", () => {
  expect(pageCsp(["https://cdn.example.com"])).toBe(
    "default-src 'none'; script-src 'unsafe-inline' https://cdn.example.com; " +
      "style-src 'unsafe-inline' https://cdn.example.com; img-src data: blob: https://cdn.example.com; " +
      "font-src data: https://cdn.example.com; connect-src https://cdn.example.com; form-action 'none'; base-uri 'none'",
  );
});

test("an origin with a port keeps it", () => {
  const p = page({ tasks: "read" }, { network: ["http://localhost:5173"] });
  expect(pageCsp(p.network)).toContain("connect-src http://localhost:5173;");
  expect(accessSummary(p)).toBe("tasks: read · localhost:5173");
});

test("the summary lists access, sql and hosts", () => {
  expect(
    accessSummary(page({ tasks: "write", people: "read" }, { sql: true, network: ["https://cdn.jsdelivr.net"] })),
  ).toBe("tasks: write · people: read · sql · cdn.jsdelivr.net");
  expect(accessSummary(page({}))).toBe("no access");
});

test("the brief counts writes, reads, sql and origins", () => {
  expect(
    accessBrief(
      page(
        { tasks: "write", notes: "write", people: "read" },
        { sql: true, network: ["https://a.example", "https://b.example"] },
      ),
    ),
  ).toBe("write 2 · read 1 · SQL · 2 origins");
  expect(accessBrief(page({ people: "read" }, { network: ["https://a.example"] }))).toBe("read 1 · 1 origin");
  expect(accessBrief(page({}, { sql: true }))).toBe("SQL");
  expect(accessBrief(page({}))).toBe("no access");
});

test("the summary and brief mention AI when the page has it", () => {
  const ai = { maxOutputTokens: 1024 };
  expect(accessSummary(page({ tasks: "read" }, { ai }))).toBe("tasks: read · AI");
  expect(accessBrief(page({ tasks: "read" }, { ai }))).toBe("read 1 · AI");
  expect(accessBrief(page({}, { ai }))).toBe("AI");
});

test("a folder entry grants what is under it, a file entry only itself", () => {
  expect(fileGranted([".evidence/"], ".evidence/a/b.png")).toBe(true);
  expect(fileGranted([".evidence/"], ".evidence-private/a.png")).toBe(false);
  expect(fileGranted([".evidence"], ".evidence/a.png")).toBe(false);
  expect(fileGranted(["a.png"], "a.png")).toBe(true);
});

test("normalizeFilePath collapses . and empty segments and refuses escapes", () => {
  expect(normalizeFilePath(".evidence//./a.png")).toBe(".evidence/a.png");
  expect(normalizeFilePath(".evidence/../x")).toBeNull();
  expect(normalizeFilePath("/x")).toBeNull();
  expect(normalizeFilePath("")).toBeNull();
});

test("deniedFile matches nested folders and exact files", () => {
  expect(deniedFile("data/.yamlite/db.sqlite", ["data/.yamlite/"])).toBe(true);
  expect(deniedFile("yamlite.yaml", DENIED_FILES)).toBe(true);
  expect(deniedFile("docs/a.png", DENIED_FILES)).toBe(false);
});

test("contentTypeOf goes by extension, case-insensitively", () => {
  expect(contentTypeOf("A.PNG")).toBe("image/png");
  expect(contentTypeOf("x.bin")).toBe("application/octet-stream");
  expect(contentTypeOf("a.txt")).toBe("text/plain");
  for (const name of [
    "a.html",
    "a.json",
    "a.md",
    "a.yaml",
    "noext",
    "png",
    "a.constructor",
    "a.toString",
    "a.__proto__",
  ]) {
    expect(contentTypeOf(name)).toBe("application/octet-stream");
  }
});

test("files show in the summary and as a count in the brief", () => {
  expect(accessSummary(page({}, { files: [".evidence/"] }))).toContain("files: .evidence/");
  expect(accessBrief(page({}, { files: [".evidence/"] }))).toContain("1 file entry");
  expect(accessBrief(page({}, { files: [".evidence/", "a.png"] }))).toContain("2 file entries");
});
