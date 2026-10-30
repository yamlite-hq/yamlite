---
title: "チェック、クエリ、エクスポート"
description: "ファイルをスキーマで検証し、読み取り専用の SQL を実行し、静的サイトを書き出します。"
order: 6
---

## チェック

```bash
yamlite check notes
```

`check` は、`export` と同じように、YAML を一時的なデータベースに同期し、見つけた問題をすべて報告します。対象は、失敗したテーブル、あらゆる警告(values、required、formats、min と max、references、型、インデックス)、`yamlite.yaml` にまだ記載がないテーブルとカラムです。問題が 1 つでもあれば、終了コード 1 で終了します。ルート配下には何も書き込まず、ロックも取りません。そのため、CI、pre-commit フック、実行中の `watch` や `serve` と並行して使えます。

- `--table`(複数指定可)を付けると、指定したテーブルだけを検証します。
- `--json` は `{ ok, tables: [{ table, ok, error?, warnings, unregistered }], unregisteredTables }` を出力します。

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

## クエリ

```bash
yamlite query "select status, count(*) from tasks group by status" notes
yamlite query "select * from people" notes --format csv > people.csv
```

`query` は、`sqlite3` がなくても、読み取り専用の文を 1 つ(`SELECT`、`WITH … SELECT`、`EXPLAIN`、`VALUES`)実行します。`check` と同様に、最初に YAML を一時的なデータベースに同期します。そのため、常にファイルの内容を読み、ルート配下には何も書き込まず、`watch` や `serve` と並行して実行できます。同期に失敗したテーブルは、そのデータベースに含まれないので、クエリすると `no such table` というエラーになります。失敗の内容と同期時の警告は、標準エラー出力に出ます。

- `--db <path>` を付けると、同期せずに、そのデータベースをそのまま読みます。たとえば `.yamlite/db.sqlite` を指定すると、アプリが書き込んだがまだ同期されていない内容を確認できます。
- `--format` には `table`(デフォルト)、`json`(1 行につき 1 オブジェクト。重複するカラム名には `_2`、`_3`、… が付きます)、`csv`(LF 改行)を指定できます。
- `--limit`(デフォルトは 1000)は行数の上限です。`0` で上限がなくなります。行数と切り詰めの有無は標準エラー出力に出るので、標準出力はパイプにそのまま渡せます。
- 書き込みには、`sqlite3`、アプリ、Web UI を使ってください。データベースは読み取り専用で開かれます。

## エクスポート

```bash
yamlite export notes --out ../notes-site
```

`export` は、Web UI を静的サイトとして書き出します。任意の Web サーバーに置けます。テーブルとビューの閲覧、YAML 付きのレコードの表示、絞り込み、並べ替え、ER 図の表示、SQL コンソールでの `SELECT` の実行ができます。書き込みはできません。保存、削除、新規作成のボタンも 「同期」ページもなく、コンソールは `SELECT`、`EXPLAIN`、`VALUES` 以外を拒否します。データはブラウザー内で [sql.js](https://sql.js.org) が処理します。

- YAML を一時的なデータベースに同期するので、`.yamlite/` がなくても CI で動き、ルートには触れません。`yamlite.yaml` の変更も、`.yamlite/` フォルダーの作成も、ロックもありません。
- `--table`(複数指定可)を付けると、指定したテーブルだけを書き出します。ほかのテーブルは、データベースにも含まれません。
- 出力は `index.html`、`assets/`、`data/`(`snapshot.json`、`db.sqlite`、テーブルごとの `yaml/<table>.json`。各 YAML ファイルのテキストを 1 回だけ保持)です。URL はすべて相対パスなので、GitHub Pages の `/<repo>/` のようなサブパスでも動きます。
- マシン固有のパスは隠されます。ルートはフォルダー名で、ルートの外のパスはベース名で表示されます。
- `--out` のデフォルトは `.yamlite-export` です。データのルート、その祖先、`.yamlite/` は指定できません(シンボリックリンクや大文字小文字の違いを経由した場合も同様です)。ルートの内側に置くときは、ドットで始まるフォルダーにしてください(YAMLite はそれらを無視します。通常のフォルダーだと、次の同期でテーブルになってしまいます)。
- 既存の `--out` フォルダーは、以前のエクスポートが入っているか、空のときだけ置き換えます。それ以外のフォルダーは `--force` で置き換えられますが、ルート、その祖先、`.yamlite/` は置き換えられません。
- HTTP 経由で開いてください(`npx serve ../notes-site`)。ブラウザーは `file://` からアプリを読み込まないため、そのように開いたページには、Web サーバーを使うよう案内するメッセージだけが表示されます。
- `SOURCE_DATE_EPOCH` を設定すると、出力がバイト単位で再現可能になります。

GitHub Pages に公開する場合は、次のようにします。

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
