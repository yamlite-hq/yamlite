---
title: "クイックスタート"
description: "データを配置し、スキーマを作成して、同期と SQL での検索まで進めます。"
order: 2
---

## クイックスタート

1. **データを配置する。** ルート直下の各項目が、それぞれ 1 つのテーブルになります。

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

2. **スキーマを作成する。** `yamlite init` は、ファイル(または既存のデータベース)からテーブルとカラムの型を推論します。データから明らかなキー、展開するリスト、参照も推論し、`notes/yamlite.yaml` に書き出します。内容を確認して、データと一緒にコミットしてください。

   ```bash
   yamlite init notes
   ```

3. **プレビューしてから同期する。**

   ```bash
   yamlite status notes   # shows what would change, writes nothing
   yamlite sync notes
   ```

4. **SQL で検索・編集する。** データベースは `notes/.yamlite/db.sqlite` にあります。

   ```bash
   sqlite3 notes/.yamlite/db.sqlite "select team, count(*) from people group by team"
   ```

   `sqlite3` がなくても、`yamlite query` で SQL を直接実行できます。

   ```bash
   yamlite query "select team, count(*) from people group by team" notes
   ```

   逆方向の書き込みもできます。書き換わるのは変更したフィールドだけで、コメントは残ります。

   ```console
   $ sqlite3 notes/.yamlite/db.sqlite "update tasks set done = 1 where id = 'buy-milk'"
   $ yamlite sync notes > /dev/null && cat notes/tasks/buy-milk.yaml
   # tasks/buy-milk.yaml
   title: 牛乳を買う
   done: true
   priority: 2
   tags: [errand, home]
   ```

5. **作業中は同期を保つ。**

   ```console
   $ yamlite watch notes
   YAMLite · watching people, tasks in ~/notes · Ctrl-C to stop

     12:03:41  tasks   → db        buy-milk
     12:03:55  people  → file      2
     12:04:02  tasks   − file      renew-passport
   ```

6. **キャッシュを除外する。** `.gitignore` に `.yamlite/` を追加します。コミットするのは、YAML ファイルと `yamlite.yaml` です。
