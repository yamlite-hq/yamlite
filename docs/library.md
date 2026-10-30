---
title: "Library"
description: "Use YAMLite from Node with open(), status(), sync() and watch()."
order: 10
---

## Library

```ts
import { open } from "yamlite";

const y = await open({ root: "./notes" }); // or { db: "./app.db", tables: [{ name: "tasks", files: "./tasks/**/*.yaml" }] }

const plan = await y.status(); // what would change
const results = await y.sync(); // [{ table, ok, toDb, toFile, conflicts, warnings, ... }]

const watcher = y.watch({
  onSync: (r) => console.log(r.table, r.toDb, r.toFile),
  onConflict: (c) => console.warn(`conflict in ${c.table}/${c.key}, saved ${c.savedTo}`),
  onError: (e) => console.error(e),
});
await watcher.ready;

await y.close();
```

Open your own `node:sqlite` (or any SQLite) connection to write to the database — `watch` picks up commits from other connections automatically.
