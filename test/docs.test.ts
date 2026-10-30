import { readdirSync, readFileSync, existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { parse } from "yaml";
import GithubSlugger from "github-slugger";
import { expect, test } from "vitest";

const root = resolve(import.meta.dirname, "..");
const docsDir = join(root, "docs");
const jaDir = join(docsDir, "ja");

const list = (dir: string) => (existsSync(dir) ? readdirSync(dir) : []).filter((f) => f.endsWith(".md")).sort();
const enPages = list(docsDir);
const jaPages = list(jaDir);
const allFiles = [...enPages.map((p) => join(docsDir, p)), ...jaPages.map((p) => join(jaDir, p))];
const read = (path: string) => readFileSync(path, "utf8");

function frontmatter(text: string): Record<string, unknown> {
  const m = /^---\n([\s\S]*?)\n---\n/.exec(text);
  return m ? (parse(m[1]!) as Record<string, unknown>) : {};
}

function headings(text: string): Set<string> {
  const slugger = new GithubSlugger();
  const out = new Set<string>();
  let fenced = false;
  for (const line of text.split("\n")) {
    if (/^\s*(```|~~~)/.test(line)) fenced = !fenced;
    const m = !fenced && /^#{1,6}\s+(.+?)\s*#*\s*$/.exec(line);
    if (m) out.add(slugger.slug(m[1]!));
  }
  return out;
}

test("there are docs pages", () => {
  expect(enPages.length).toBeGreaterThan(0);
});

test("every ja page has an en page and vice versa", () => {
  expect(jaPages).toEqual(enPages);
});

test("every docs page has title, description and a unique order per language", () => {
  for (const [dir, pages] of [
    [docsDir, enPages],
    [jaDir, jaPages],
  ] as const) {
    const orders: number[] = [];
    for (const page of pages) {
      const fm = frontmatter(read(join(dir, page)));
      expect(typeof fm.title, `${dir}/${page} title`).toBe("string");
      expect(typeof fm.description, `${dir}/${page} description`).toBe("string");
      expect(Number.isInteger(fm.order), `${dir}/${page} order`).toBe(true);
      orders.push(fm.order as number);
    }
    expect(new Set(orders).size).toBe(orders.length);
  }
});

test("a ja page has the order of its en page", () => {
  for (const page of jaPages) {
    const en = frontmatter(read(join(docsDir, page))).order;
    const ja = frontmatter(read(join(jaDir, page))).order;
    expect(ja, page).toBe(en);
  }
});

test("every relative link points to an existing page and heading", () => {
  const files = [join(root, "README.md"), ...allFiles];
  for (const file of files) {
    const isReadme = file.endsWith("README.md");
    const base = isReadme ? docsDir : dirname(file);
    const text = read(file).replace(/```[\s\S]*?```/g, "");
    const re = isReadme ? /\]\((?:docs\/)?([\w-]+\.md)(?:#([^)\s]+))?\)/g : /\]\(([\w-]+\.md)(?:#([^)\s]+))?\)/g;
    for (const m of text.matchAll(re)) {
      const target = join(base, m[1]!);
      expect(existsSync(target), `${file}: ${m[0]}`).toBe(true);
      if (m[2]) expect(headings(read(target)).has(m[2]), `${file}: ${m[0]}`).toBe(true);
    }
    if (isReadme) continue;
    for (const m of text.matchAll(/\]\((?:\.\/)?(#[^)\s]+)\)/g)) {
      expect(headings(read(file)).has(m[1]!.slice(1)), `${file}: ${m[0]}`).toBe(true);
    }
  }
});

test("every image reference resolves", () => {
  for (const file of allFiles) {
    const text = read(file);
    for (const m of text.matchAll(/(?:\]\(|src=")(\.\.\/(?:\.\.\/)?assets\/[^)"\s]+)/g)) {
      expect(existsSync(resolve(dirname(file), m[1]!)), `${file}: ${m[1]}`).toBe(true);
    }
  }
});
