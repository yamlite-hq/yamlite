---
title: "Commands"
description: "Every yamlite command with its options."
order: 3
---

## Commands

| Command                      | Options                                                                               | Description                                                         |
| ---------------------------- | ------------------------------------------------------------------------------------- | ------------------------------------------------------------------- |
| `yamlite init [root]`        | `--db`, `--force`, `--print`                                                          | Create `yamlite.yaml` from your files and database                  |
| `yamlite guide`              |                                                                                       | Print the guide to writing `yamlite.yaml`, for people and AI agents |
| `yamlite check [root]`       | `--table <name>`, `--json`                                                            | Check the YAML files against `yamlite.yaml`; exits 1 on any problem |
| `yamlite query <sql> [root]` | `--db`, `--format` (table, json, csv), `--limit` (1000)                               | Run one read-only SQL statement and print the rows                  |
| `yamlite status [root]`      | `--db`, `--table <name>`, `--json`                                                    | Show what `sync` would change, without writing                      |
| `yamlite sync [root]`        | `--db`, `--table <name>`, `--force`, `--force-convert`, `--json`                      | Sync once; exits 1 if any table fails                               |
| `yamlite watch [root]`       | `--db`, `--quiet`                                                                     | Sync on every file save, database commit or config change           |
| `yamlite serve [root]`       | `--db`, `--port` (4610), `--host` (127.0.0.1), `--open`, `--no-agent`, `--web-search` | Open the web UI and sync continuously                               |
| `yamlite export [root]`      | `--out` (.yamlite-export), `--table`, `--force`                                       | Write the web UI as a read-only static site                         |

- `root` defaults to the current directory.
- `--db <path>` overrides the default `<root>/.yamlite/db.sqlite`.
- `--table <name>` can be repeated.
- `--force` allows mass deletions that the deletion guard would refuse.
- `--force-convert` clears values that cannot be converted when a column type changes (see [Column types](configuration.md#column-types)).
- `--json` prints the raw results (per table: counts, `changes` per key, `conflicts`, `warnings`) for scripting. `check --json` has its own shape (see [Check](check-query-export.md#check)).
- Output is colored on a terminal; set `NO_COLOR=1` to disable it.
