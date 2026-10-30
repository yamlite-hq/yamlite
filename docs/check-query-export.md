---
title: "Check, Query and Export"
description: "Check files against the schema, run read-only SQL, and export a static site."
order: 6
---

## Check

```bash
yamlite check notes
```

`check` syncs your YAML into a temporary database, the way `export` does, and reports every problem it finds: a table that fails, any warning (values, required, formats, min and max, references, types, indexes), and a table or column that `yamlite.yaml` does not list yet. It exits 1 if there is one. Nothing under the root is written and no lock is taken, so it runs in CI, in a pre-commit hook, and next to a running `watch` or `serve`.

- `--table` (repeatable) checks only those tables.
- `--json` prints `{ ok, tables: [{ table, ok, error?, warnings, unregistered }], unregisteredTables }`.

```yaml
# .github/workflows/check.yml
on: [pull_request]
jobs:
  check:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: 24 }
      - run: npx yamlite check .
```

```sh
#!/bin/sh
# .git/hooks/pre-commit (chmod +x)
exec npx yamlite check .
```

## Query

```bash
yamlite query "select status, count(*) from tasks group by status" notes
yamlite query "select * from people" notes --format csv > people.csv
```

`query` runs one read-only statement (`SELECT`, `WITH … SELECT`, `EXPLAIN`, `VALUES`) without needing `sqlite3`. Like `check`, it syncs your YAML into a temporary database first, so it always reads what the files say, writes nothing under the root, and runs next to `watch` or `serve`. A table that fails to sync is left out of that database, so querying it errors with `no such table`; the failure and any sync warnings go to stderr.

- `--db <path>` reads that database as it is instead, without syncing — for example `.yamlite/db.sqlite` to see what an app wrote but has not synced yet.
- `--format` is `table` (default), `json` (one object per row; a repeated column name gets `_2`, `_3`, …) or `csv` (LF line endings).
- `--limit` (default 1000) caps the rows; `0` removes the cap. The row count and any truncation go to stderr, so stdout stays clean for pipes.
- To write, use `sqlite3`, your app or the web UI: the database is opened read-only.

## Export

```bash
yamlite export notes --out ../notes-site
```

`export` writes the web UI as a static site you can put on any web server: browse tables and views, open records with their YAML, filter, sort, see the ERD, and run `SELECT` in the SQL console. Nothing can be written: there are no save, delete or new buttons, no Sync page, and the console refuses anything but `SELECT`, `EXPLAIN` and `VALUES`. The data runs in the browser with [sql.js](https://sql.js.org).

- It syncs your YAML into a temporary database, so it works in CI without `.yamlite/` and never touches the root: no `yamlite.yaml` changes, no `.yamlite/` folder, no lock.
- `--table` (repeatable) limits the export to those tables; the others are left out of the database too.
- Output: `index.html`, `assets/`, and `data/` (`snapshot.json`, `db.sqlite`, one `yaml/<table>.json` per table, holding each YAML file's text once). Every URL is relative, so it works under a subpath such as GitHub Pages' `/<repo>/`.
- Machine paths are hidden: the root is shown as its folder name, and paths outside the root as their base names.
- `--out` defaults to `.yamlite-export`. It cannot be the data root, an ancestor of it, or `.yamlite/` (also when reached through a symlink or a different letter case), and inside the root it must sit in a dot-folder (YAMLite ignores those; a plain folder would become a table on the next sync).
- An existing `--out` folder is replaced only if it holds a previous export or is empty; `--force` replaces anything else, but never the root, its ancestors or `.yamlite/`.
- Open it over HTTP (`npx serve ../notes-site`); browsers do not load the app from `file://`, so the page opened that way only says to use a web server.
- Set `SOURCE_DATE_EPOCH` to make the output byte-for-byte reproducible.

Publishing to GitHub Pages:

```yaml
# .github/workflows/pages.yml
on: { push: { branches: [main] } }
permissions: { contents: read, pages: write, id-token: write }
jobs:
  deploy:
    runs-on: ubuntu-latest
    environment: github-pages
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: 24 }
      - run: npx yamlite export .
      - uses: actions/upload-pages-artifact@v3
        with: { path: .yamlite-export }
      - uses: actions/deploy-pages@v4
```
