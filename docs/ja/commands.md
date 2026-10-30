---
title: "コマンド"
description: "yamlite のコマンドとオプションの一覧です。"
order: 3
---

## コマンド

| コマンド                     | オプション                                                                            | 説明                                                                                 |
| ---------------------------- | ------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| `yamlite init [root]`        | `--db`, `--force`, `--print`                                                          | ファイルとデータベースから `yamlite.yaml` を作成する                                 |
| `yamlite guide`              |                                                                                       | `yamlite.yaml` の書き方ガイドを表示する(人間と AI エージェントの両方向け)            |
| `yamlite check [root]`       | `--table <name>`, `--json`                                                            | YAML ファイルを `yamlite.yaml` に照らして検証する。問題が 1 つでもあれば終了コード 1 |
| `yamlite query <sql> [root]` | `--db`, `--format` (table, json, csv), `--limit` (1000)                               | 読み取り専用の SQL を 1 文実行して、行を表示する                                     |
| `yamlite status [root]`      | `--db`, `--table <name>`, `--json`                                                    | `sync` で何が変わるかを、書き込まずに表示する                                        |
| `yamlite sync [root]`        | `--db`, `--table <name>`, `--force`, `--force-convert`, `--json`                      | 一度だけ同期する。失敗したテーブルがあれば終了コード 1                               |
| `yamlite watch [root]`       | `--db`, `--quiet`                                                                     | ファイルの保存、データベースのコミット、設定の変更のたびに同期する                   |
| `yamlite serve [root]`       | `--db`, `--port` (4610), `--host` (127.0.0.1), `--open`, `--no-agent`, `--web-search` | Web UI を開き、継続的に同期する                                                      |
| `yamlite export [root]`      | `--out` (.yamlite-export), `--table`, `--force`                                       | Web UI を読み取り専用の静的サイトとして書き出す                                      |

- `root` を省略すると、カレントディレクトリになります。
- `--db <path>` は、デフォルトの `<root>/.yamlite/db.sqlite` を置き換えます。
- `--table <name>` は繰り返し指定できます。
- `--force` は、削除ガードが拒否する大量削除を許可します。
- `--force-convert` は、カラムの型を変更したときに変換できない値を消去します([カラムの型](configuration.md#カラムの型)を参照)。
- `--json` は、スクリプト向けに生の結果(テーブルごとの件数、キーごとの `changes`、`conflicts`、`warnings`)を出力します。`check --json` は別の形式です([チェック](check-query-export.md#チェック)を参照)。
- 端末ではカラーで出力します。無効にするには `NO_COLOR=1` を設定します。
