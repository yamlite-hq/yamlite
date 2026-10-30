---
title: "AI エージェントと使う"
description: "コーディングエージェントに yamlite のガイドを渡し、Agent Skill をインストールします。"
order: 9
---

## AI エージェントと使う

`yamlite guide` は、`yamlite.yaml` の書き方ガイドを表示します。ワークフロー(`init`、`status`、`check`)、テーブルの構成の考え方、各ルールを使う場面を、インストール済みのバージョンに合わせて説明します。コーディングエージェントにこのガイドを読ませるか、[Agent Skill](https://agentskills.io) として Claude Code、Codex、Cursor などにインストールしてください。

```bash
npx skills add yamlite-hq/yamlite
```

このスキルは、エージェントに `yamlite guide` を読ませ、最後に `yamlite check` が通る状態にするよう指示します。`yamlite serve` の「AI に依頼」パネルも、同じガイドを読みます。
