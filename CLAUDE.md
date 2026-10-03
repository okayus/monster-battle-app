# monster-battle-app — CLAUDE.md

> モンスターバトルを題材にした **フルスタック Web アプリの学習用リポジトリ**。
> **ゲームの中身を作り込むことは目的ではない。** Web アプリとしての組み立て方
> （フロント / API / 管理画面 / DB / 型の共有 / コンテナ）を学ぶために作る。

## 実装を始める前に

**`docs/` を読んでから書くこと。** 設計判断はコードではなくドキュメント側に置いてある。
特に [docs/02-sprite-format.md](docs/02-sprite-format.md) は、形式・API・セキュリティが 1 つの判断から
導かれているので、ここを読まずにスキン周りを触ると設計が崩れる。

実装の順序は [docs/05-roadmap.md](docs/05-roadmap.md)。**縦の串を先に通す**（1 スライスを
DB → API → 画面まで貫通させてから次へ）。層ごとに横に作らない。

## 絶対ルール

- **ユーザーから SVG・画像・マークアップを受け取らない。** 受け取るのは専用エディタが生成した
  スキンデータ（数値と、厳格なパターンに一致する文字列だけ）のみ。理由は docs/02。
  この一線を越えると、サニタイズという別の防御を丸ごと背負うことになる。
- **検証はサーバ側で行う。** エディタ側の整形は UX であって防御ではない。
  `parseSkin()` が唯一の境界で、そこを通った後は下流で再検査しない。
- **`@mba/core` は何も import しない。** I/O もフレームワークも DOM も。純粋関数だけ。
- **`apps/api` は `@mba/sprite-react` に依存しない。** API はスキンを検証するが描画はしない。
  React が API の依存グラフに入っていたら設計が壊れている。
- **手書きの `class` 宣言を作らない。** ライブラリのクラス（`new Hono()` 等）は可。
  失敗しうる関数は例外ではなく `Result<T, E>` を返す。
- **DB に画像を入れない。** 見た目は「どのスキンか・どのバリアントか・どの色か」というレシピで表す（docs/03）。
- **固有名詞を使わない。** public リポジトリなので、既存作品の名称・キャラクター名を持ち込まない。

## 依存の向き

```
        @mba/core ──────┐
                        ├──> apps/api      （+ @mba/db, @mba/sprite）
        @mba/sprite ────┘
             │
             └──> @mba/sprite-react ──> apps/web, apps/admin
```

矢印を逆流させない。特に `@mba/sprite` から React 側へ依存を作らないこと。

## 開発の回し方

```sh
docker compose up -d                       # 起動（初回はイメージビルド）
docker compose exec dev pnpm typecheck     # 型
docker compose exec dev pnpm lint          # oxlint
docker compose exec dev pnpm test          # vitest
docker compose exec dev pnpm --filter @mba/db run db:generate --name <名前>   # スキーマ変更後

docker build --target check .                                             # CI と同じ検査（型・lint・整形・単体テスト）
docker compose -f docker-compose.e2e.yml up --build --exit-code-from e2e  # 本番イメージに対する画面のテスト
```

- **依存の追加も実行もコンテナ内で行う。** ホストで `pnpm install` しない。
- 開発サーバ: プレイヤー `:5173` / 管理 `:5174` / API `:3000`。両 SPA は `/api` を `:3000` へプロキシするので CORS は不要。
- SQLite は名前付きボリューム。`docker compose down -v` でだけ消える。
- マイグレーションは `--name` を必ず付けて生成する（省くとランダムな名前に固有名詞が混ざる）。
  適用は API の起動時だけなので、生成後は `docker compose restart dev`。詳細は docs/03 §マイグレーション。
- **下の 2 つが CI そのもの。** 書いている最中は上の `exec dev` で回し、区切りで下の 2 つを通す。dev コンテナは動かしたままでよい。
- **画面の流れを足したら、`e2e/tests/` にテストを足す。** 足したら、守っているはずのコードを壊して落ちることを見る。
  通るテストが何かを守っているとは限らない（docs/06 §書いたテストは、壊して確かめる）。
- `e2e/` はワークスペースの外で、自分の lockfile を持つ。テストの整形と依存の変え方は docs/06 §日々の操作。

## 迷ったときの判断基準

- **そのデータは誰がどの頻度で変えるか。** 作者がデプロイで変えるものはコードと一緒に、
  ユーザーが遊びながら変えるものは DB に。
- **その処理は書き込み時にできるか。** 矩形結合のような重い変換は保存時に 1 回だけやって
  結果も保存する。読み取りのたびに計算しない。
- **その値は誰が信用しているか。** クライアント由来の値は、サーバで検証されるまで信用しない。
