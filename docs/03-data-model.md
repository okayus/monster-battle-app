# 03. データモデル

## 原則: DB は識別子と数値を持つ。絵は持たない

見た目は「どのスキンか・どのバリアントか・どの色か」という**レシピ**で表す。レシピは数十バイトで済み、
絵そのものを持つより後から効く。

- 髪の色を変えても、増えるのは 1 レコードの hex 文字列だけ。スキンは複製されない
- 「赤毛でベストを着た自分」は 1 行で表現できる

**マップも画像にしない。** タイル ID の配列として持つ。こうすると当たり判定・エンカウント判定・
経路探索が同じデータから引ける。画像にした瞬間、それらを別に持つ羽目になる。

## テーブル方針

`packages/db/src/schema.ts` に定義済みなのは `users` と `skins`。残りはスライスを実装するたびに足す。

### マスターデータ（管理画面が編集する）

| テーブル | 主な列 | 補足 |
|---|---|---|
| `species` | id, name, max_hp, attack, defense, skin_id | モンスターの種族。絵は `skin_id` の参照だけ |
| `moves` | id, name, power | 技 |
| `species_moves` | species_id, move_id | 種族が覚える技 |
| `maps` | id, name, width, height, tiles, encounter_rate | `tiles` はタイル ID の配列（JSON か TEXT） |
| `map_encounters` | map_id, species_id, weight | どのマップに何が出るか |

### ユーザーデータ

| テーブル | 主な列 | 補足 |
|---|---|---|
| `users` | id, display_name, created_at | ローカル学習用。認証は docs/04 参照 |
| `saves` | user_id, map_id, x, y, updated_at | セーブデータ。1 ユーザー 1 行から始める |
| `owned_monsters` | id, user_id, species_id, nickname, level, exp, hp | 所持モンスター |
| `appearances` | user_id, skin_id, variant_overrides, color_overrides | **見た目のレシピ**。数十バイト |

### スキン

| テーブル | 主な列 | 補足 |
|---|---|---|
| `skins` | id, owner_id, name, format_version, source, renderable, created_at | `owner_id` が null なら運営が用意したスキン |

- `source` … 編集用の正本（ランレングス）。エディタが読み書きする
- `renderable` … 描画用（矩形の配列）。保存時に生成する（docs/02）

両方を持つのは重複に見えるが、**書き込み時に 1 回変換して読み取りを軽くする**という意図的な非正規化。
`source` から `renderable` はいつでも再生成できるので、真実は `source` にある。

どちらも JSON を TEXT で持つ。**`@mba/db` はその中身の形を知らない**（`@mba/sprite` に依存しない）。
入力を `Skin` にするのは API の `parseSkin()` で、DB 層は渡された文字列をしまうだけ。
行の型を `SkinRow` と呼んで `Skin` と区別しているのも同じ理由（下の「型はどこに置くか」）。

## マイグレーション

`schema.ts` を変えたら、コンテナ内で SQL を生成する。

```sh
docker compose exec dev pnpm --filter @mba/db run db:generate --name <内容を表す名前>
```

- **`--name` を必ず付ける。** 省くと drizzle-kit がランダムな名前を付けるが、その語彙には
  既存作品のキャラクター名が含まれている。public リポジトリに固有名詞を持ち込まない、というルールに触れる。
- **適用されるのは API の起動時だけ。** `runMigrations()` が `drizzle/*.sql` をファイル名順に 1 回ずつ流す。
  開発サーバ（`tsx watch`）は `.sql` を監視していないので、生成した後は API を再起動する
  （`docker compose restart dev`）。
- **適用済みのファイルは書き換えない。** 適用したかどうかはファイル名で記録しているので、
  中身を直しても二度と流れない。変更は新しいマイグレーションとして足す。
- **`drizzle/` は整形の対象から外してある**（`packages/db/.prettierignore`）。drizzle-kit が生成のたびに
  書き直すファイルなので、整形すると毎回差分が出る。

## 削除しない

**マスターもスキンも物理削除しない。** セーブデータや所持モンスターが参照しているため。
`retired_at`（または `status`）を立てて、提示から外すだけにする。

参照先が retire されていた場合の表示は、**呼び出し側ではなく取得層でフォールバック**させる
（既定スキン・不明な種族の扱いを 1 箇所に置く）。画面ごとに `if (!species) return null` を書き散らさない。

## 型はどこに置くか

- **DB の行の型**は Drizzle が `schema.ts` から生成する（`typeof users.$inferSelect`）
- **ドメインの型**は `@mba/core` に手で書く（`Species`, `OwnedMonster` など）

この 2 つは意図的に別物にしてある。DB の都合（NULL 許容、スネークケース、外部キー）が
ドメインの表現に染み出さないようにするため。API 層で相互に変換する。

最初は同じ形に見えるので冗長に感じるが、「レベルは 1 以上」「HP は最大値を超えない」といった
ドメインの制約を型で表そうとした瞬間に、この分離が効いてくる。
