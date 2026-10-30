---
title: "ライブラリ"
description: "Node から open()、status()、sync()、watch() で YAMLite を使います。"
order: 10
---

## ライブラリ

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

データベースへ書き込むには、自分で `node:sqlite`(または任意の SQLite)の接続を開いてください。`watch` は、ほかの接続のコミットを自動的に検出します。
