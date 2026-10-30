---
title: "Limitations"
description: "What YAMLite does not do."
order: 12
---

## Limitations

- Local, single-machine use. One YAMLite process per data folder.
- Sized for hundreds to thousands of records per table; every sync scans the whole table.
- No SQLite foreign-key constraints ([references](configuration.md#references) are checked, not enforced). Only YAML is read: `.md` and `.mdx` files through their YAML front matter, never TOML or JSON front matter or other formats.
- A table splits by one column only.
- When a file is rewritten, the space before an inline comment is normalized to one (`a: 1  # note` → `a: 1 # note`).
