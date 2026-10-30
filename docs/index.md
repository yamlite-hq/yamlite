---
title: "YAMLite"
description: "Your YAML files, queryable with SQL. Your SQLite database, reviewable in git."
order: 0
---

YAMLite keeps a folder of YAML files and a local SQLite database in sync, in both directions, continuously. Edit a file in your editor and the row changes. Run an `UPDATE` and the file changes — with your comments still in place.

## Pages

- [Installation](installation.md): Install YAMLite with npm or pnpm, or run it once with npx.
- [Quick Start](quick-start.md): Lay out your data, create the schema, sync, and query with SQL.
- [Commands](commands.md): Every yamlite command with its options.
- [Web UI](web-ui.md): Edit records in the browser, send changes for review, and ask AI to propose edits.
- [Pages](pages.md): Build custom pages over your tables and style the web UI.
- [Check, Query and Export](check-query-export.md): Check files against the schema, run read-only SQL, and export a static site.
- [Working with your data](data.md): How files map to tables, how types are inferred, and how nested values and lists are expanded.
- [Configuration](configuration.md): The yamlite.yaml schema: columns, formats, rules, references and indexes.
- [Use with AI agents](ai-agents.md): Give coding agents the yamlite guide and install the Agent Skill.
- [Library](library.md): Use YAMLite from Node with open(), status(), sync() and watch().
- [How it works](how-it-works.md): The three-way compare behind every sync, and the guarantees that protect your data.
- [Limitations](limitations.md): What YAMLite does not do.
