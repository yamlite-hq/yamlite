---
title: "Use with AI agents"
description: "Give coding agents the yamlite guide and install the Agent Skill."
order: 9
---

## Use with AI agents

`yamlite guide` prints a guide to writing `yamlite.yaml` — the workflow (`init`, `status`, `check`), how to lay out tables, and when each rule fits — matching the installed version. Point any coding agent at it, or install it as an [Agent Skill](https://agentskills.io) for Claude Code, Codex, Cursor and others:

```bash
npx skills add yamlite-hq/yamlite
```

The skill tells the agent to read `yamlite guide` and to finish with `yamlite check` passing. The Ask AI panel in `yamlite serve` reads the same guide.
