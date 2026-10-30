---
title: "Quick Start"
description: "Lay out your data, create the schema, sync, and query with SQL."
order: 2
---

## Quick Start

1. **Lay out your data.** Each entry directly under the root becomes a table:

   ```
   notes/
   ├── tasks/              # directory → one record per file, key = path (subfolders too)
   │   ├── buy-milk.yaml
   │   └── write-blog.yaml
   └── people.yaml         # file → a list of records, key = `id`
   ```

   ```yaml
   # tasks/buy-milk.yaml
   title: 牛乳を買う
   done: false
   priority: 2
   tags: [errand, home]
   ```

   ```yaml
   # people.yaml
   - id: 1
     name: Alice
     team: platform # lead
   - id: 2
     name: Bob
     team: sales
   ```

2. **Create the schema.** `yamlite init` infers tables and column types from your files (or an existing database), plus keys, expanded lists and references where the data makes them clear, and writes `notes/yamlite.yaml`. Review it and commit it with your data.

   ```bash
   yamlite init notes
   ```

3. **Preview, then sync.**

   ```bash
   yamlite status notes   # shows what would change, writes nothing
   yamlite sync notes
   ```

4. **Query and edit with SQL.** The database lives at `notes/.yamlite/db.sqlite`.

   ```bash
   sqlite3 notes/.yamlite/db.sqlite "select team, count(*) from people group by team"
   ```

   Or use `yamlite query` to run SQL directly without needing `sqlite3`:

   ```bash
   yamlite query "select team, count(*) from people group by team" notes
   ```

   Writes go the other way too — only the changed field is rewritten, and comments stay:

   ```console
   $ sqlite3 notes/.yamlite/db.sqlite "update tasks set done = 1 where id = 'buy-milk'"
   $ yamlite sync notes > /dev/null && cat notes/tasks/buy-milk.yaml
   # tasks/buy-milk.yaml
   title: 牛乳を買う
   done: true
   priority: 2
   tags: [errand, home]
   ```

5. **Keep them in sync while you work.**

   ```console
   $ yamlite watch notes
   YAMLite · watching people, tasks in ~/notes · Ctrl-C to stop

     12:03:41  tasks   → db        buy-milk
     12:03:55  people  → file      2
     12:04:02  tasks   − file      renew-passport
   ```

6. **Ignore the cache.** Add `.yamlite/` to your `.gitignore` — the YAML files and `yamlite.yaml` are what you commit.
