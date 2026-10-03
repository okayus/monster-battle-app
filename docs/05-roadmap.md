# 05. 実装の順序

## 基本方針: 縦の串を先に通す

**1 つのスライスを DB → API → 画面まで貫通させてから次に行く。**
「まず全部のテーブルを作る」「まず API を全部書く」と層ごとに横に作らない。

理由は 2 つ。層をまたぐ問題（型の受け渡し、CORS、ビルド順、コンテナの設定）は**貫通させて初めて出る**。
そして、動くものが常に手元にあると、次に何が必要かの判断が具体的になる。

---

## Step 0 — 疎通（完了）

環境構築とドキュメント。`/api/health` と、それを叩く 2 つの SPA の骨組みまで。

`docker compose up` で 3 つの開発サーバが立ち、両 SPA に API の応答が表示されれば完了。

---

## Step 1 — スキンの形式を確定させる（完了）

**最初にここをやる。** 形式が後から変わると、保存済みのデータの移行が発生するため。

1. `packages/sprite` の `parseSkin()` と `toRenderable()` を実装
2. 単体テストを書く。特に **「矩形結合の結果を展開し直すと元と 1 ドットも違わない」**
3. `@mba/sprite-react` の `<Sprite>` が、手書きのサンプルスキンを描けることを確認

画面も DB もまだ要らない。純粋関数だけなので、テストで完結する。

実装時の判断は [docs/02-sprite-format.md](02-sprite-format.md) §実装に追記した。

---

## Step 2 — スキンを保存して表示する（最初の縦の串）（完了）

```
エディタ（最小） → POST /api/skins → SQLite → GET /api/skins/:id → <Sprite> で表示
```

1. `packages/db` に `skins` テーブルを足して `db:generate`
2. `POST /api/skins`（`parseSkin()` を通し、`toRenderable()` の結果も一緒に保存）
3. `GET /api/skins/:id`
4. `apps/web` に最小のエディタ（CSS グリッドのセルを塗るだけ）と保存ボタン

**この時点でエディタは完成品でなくてよい。** 1 パーツ・1 コマ・数色で十分。
串が通っていることの確認が目的で、道具としての使い勝手は Step 6 で上げる。

実装時の判断は [docs/04-api-design.md](04-api-design.md) §実装 と
[docs/03-data-model.md](03-data-model.md) §マイグレーション に追記した。

---

## Step 3 — マップを表示して歩く（完了）

1. `maps` テーブルと `GET /api/maps/:id`
2. `@mba/core` の `step()` を実装（純粋・テストあり）
3. `apps/web` にマップ画面。タイルは CSS グリッドで描く
4. `saves` テーブルと `PUT /api/save`。リロードしても位置が残ること

実装時の判断は [docs/01-architecture.md](01-architecture.md) §データの流れ（移動とセーブを例に）、
[docs/03-data-model.md](03-data-model.md) §マップ、[docs/04-api-design.md](04-api-design.md) §実装 に追記した。

---

## Step 4 — バトル（完了）

1. `@mba/core` の `calcDamage()`（乱数は引数で受け取る。中で `Math.random()` を呼ばない）
2. `species` / `moves` / `owned_monsters` テーブル
3. `POST /api/battles` と `POST /api/battles/:id/turn`。**乱数はサーバで引く**
4. バトル画面

**勝敗の判定をクライアントに置かない。** 学習用でも、ここを最初からサーバに置いておくと
「信用できる境界はどこか」という感覚が身につく。

実装時の判断は [docs/01-architecture.md](01-architecture.md) §データの流れ（バトルを例に）、
[docs/03-data-model.md](03-data-model.md) §モンスターとバトル、[docs/04-api-design.md](04-api-design.md) §実装 に追記した。
テーブルは上の 3 つに加えて `species_moves`・`map_encounters`・`battles` を足している。

---

## Step 5 — 管理画面（完了）

1. `/api/admin/species` と `/api/admin/maps`
2. `apps/admin` に一覧と編集フォーム
3. モンスターの見た目は `@mba/sprite-react` でプレビュー（プレイヤー側と同じコンポーネント）

管理画面を後回しにするのは、**編集する対象が固まってからの方が作りやすい**ため。
先に作ると、スキーマが変わるたびにフォームを直すことになる。

実装時の判断は [docs/04-api-design.md](04-api-design.md) §実装 に追記した。やっていないことは次のとおり。

- **retire**（提示から外す）。消す手段も外す手段もまだ無い（docs/03 §削除しない）
- **技の追加・更新。** 一覧を読めるだけ。種族のフォームは既にある技から選ぶ
- **マップの大きさの変更。** API は受け付けるが、画面には無い。新しいマップは 16×12 で始まる
- **マップ間の移動。** マップは増やせるが、プレイヤーが開始マップから出る手段がまだ無い

---

## Step 6 — エディタを道具として仕上げる

Step 2 の最小エディタを、実際に描ける道具にする。

- パーツの切り替えと、他パーツの半透明表示（位置合わせ）
- パレット。**「色を選ぶ／色を足す」と「色を作り直す」を UI で分ける**
  （後者はその色を使っている全パーツに波及するため）
- コマの追加と再生
- 着せ替えプレビュー

---

## Step 7 — 本番相当の 1 コンテナ確認

```sh
docker build --target prod -t monster-battle-app .
docker run -p 3000:3000 -v mba-data:/app/data monster-battle-app
```

`/` と `/admin` の両方が開き、`/api` が同じポートで応答すること。
開発時（Vite のプロキシ）と本番（Hono の静的配信）でパスの解決が変わる部分が、ここで初めて表に出る。

---

## 各ステップの完了条件

共通して、以下が通ること。

```sh
docker compose exec dev pnpm typecheck
docker compose exec dev pnpm lint
docker compose exec dev pnpm test
```

そして**画面で動作を確認する**。型が通ることと動くことは別。
