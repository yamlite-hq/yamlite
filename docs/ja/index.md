---
title: "YAMLite"
description: "YAML ファイルを SQL で検索できます。SQLite データベースの変更を git でレビューできます。"
order: 0
---

YAMLite は、YAML ファイルを置いたフォルダーとローカルの SQLite データベースを、双方向かつ継続的に同期します。エディターでファイルを編集すると行が変わります。`UPDATE` を実行するとファイルが変わり、コメントはそのまま残ります。

## ページ一覧

- [インストール](installation.md): npm または pnpm でインストールするか、npx で一度だけ実行します。
- [クイックスタート](quick-start.md): データを配置し、スキーマを作成して、同期と SQL での検索まで進めます。
- [コマンド](commands.md): yamlite のコマンドとオプションの一覧です。
- [Web UI](web-ui.md): ブラウザーでレコードを編集し、変更をレビューに送り、AI に編集案を作らせます。
- [ページ](pages.md): テーブルを使ったカスタムページを作り、Web UI の見た目を変えます。
- [チェック、クエリ、エクスポート](check-query-export.md): ファイルをスキーマで検証し、読み取り専用の SQL を実行し、静的サイトを書き出します。
- [データの扱い](data.md): ファイルとテーブルの対応、型の推論、入れ子の値とリストの展開を説明します。
- [設定](configuration.md): yamlite.yaml のスキーマ(カラム、フォーマット、ルール、参照、インデックス)を説明します。
- [AI エージェントと使う](ai-agents.md): コーディングエージェントに yamlite のガイドを渡し、Agent Skill をインストールします。
- [ライブラリ](library.md): Node から open()、status()、sync()、watch() で YAMLite を使います。
- [仕組み](how-it-works.md): 同期のたびに行う 3 方向の比較と、データを守るための保証を説明します。
- [制限事項](limitations.md): YAMLite が対応していないことを挙げます。
