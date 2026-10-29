import { mkdirSync, symlinkSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "vitest";
import { DENIED_FILES } from "../../src/pages/access.ts";
import { deniedFiles } from "../../src/serve/context.ts";
import { browserFs, tmpRoot, write } from "../helpers.ts";

test("deniedFiles adds the state folder and the database with its sidecars when they are inside the root", () => {
  const root = tmpRoot();
  mkdirSync(join(root, "data/db"), { recursive: true });
  expect(deniedFiles(root, join(root, "data/state"), join(root, "data/db/x.sqlite"))).toEqual([
    ...DENIED_FILES,
    "data/state/",
    "data/db/x.sqlite",
    "data/db/x.sqlite-wal",
    "data/db/x.sqlite-shm",
    "data/db/x.sqlite-journal",
  ]);
});

test("deniedFiles leaves out a state folder and a database outside the root", () => {
  const root = tmpRoot();
  const elsewhere = tmpRoot();
  expect(deniedFiles(root, join(elsewhere, "state"), join(elsewhere, "db.sqlite"))).toEqual(DENIED_FILES);
});

test.skipIf(browserFs)("deniedFiles sees through a symlinked spelling of the root", () => {
  const root = tmpRoot();
  mkdirSync(join(root, "data"));
  const link = join(tmpRoot(), "link");
  symlinkSync(root, link);
  expect(deniedFiles(root, join(link, "state"), join(link, "data/db.sqlite"))).toEqual([
    ...DENIED_FILES,
    "state/",
    "data/db.sqlite",
    "data/db.sqlite-wal",
    "data/db.sqlite-shm",
    "data/db.sqlite-journal",
  ]);
  expect(deniedFiles(link, join(root, "state"), join(root, "data/db.sqlite"))).toContain("data/db.sqlite");
});

test.skipIf(browserFs)("deniedFiles denies a symlinked database under both its given and its real name", () => {
  const root = tmpRoot();
  mkdirSync(join(root, "data"));
  write(join(root, "data/real.db"), "");
  symlinkSync("real.db", join(root, "data/link.db"));
  expect(deniedFiles(root, join(root, "state"), join(root, "data/link.db"))).toEqual([
    ...DENIED_FILES,
    "state/",
    "data/link.db",
    "data/link.db-wal",
    "data/link.db-shm",
    "data/link.db-journal",
    "data/real.db",
    "data/real.db-wal",
    "data/real.db-shm",
    "data/real.db-journal",
  ]);
});
