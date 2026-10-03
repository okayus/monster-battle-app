# monster-battle-app

モンスターバトルを題材にした **フルスタック Web アプリの学習用リポジトリ**。
ゲームの面白さではなく、**Web アプリとしての組み立て方**（フロント / API / 管理画面 / DB / 型の共有 / コンテナ）を学ぶことが目的。

ローカルで完結する。デプロイ先は想定していない。

## 何を作るか

3 つの面がある。

| 面 | 何をするか | ポート（開発時） |
|---|---|---|
| **プレイヤー向け SPA** | ゲーム画面（タイルマップ＋ターン制バトル）と設定画面。設定画面から**自分のキャラのスキンを描くエディタ**を開ける | 5173 |
| **管理画面 SPA** | モンスター・技・マップといったマスターデータの追加・更新と、retire | 5174 |
| **API** | ユーザー情報・所持モンスター・マップ・スキンの永続化。DB に触れる唯一のプロセス | 3000 |

**スキン（見た目）は数値データとして扱う。** ユーザーは専用エディタで描いた結果を保存するだけで、SVG や画像のアップロードはできない。この判断が形式・API・セキュリティのすべてに効いているので、先に [docs/02-sprite-format.md](docs/02-sprite-format.md) を読むこと。

## 技術構成

pnpm workspace の中に、共有パッケージ 4 つとアプリ 3 つ。

```
packages/core          @mba/core          純粋なドメインロジック（バトル計算・移動）。I/O 無し
packages/sprite        @mba/sprite        スキンの形式・検証・矩形結合。React 非依存
packages/sprite-react  @mba/sprite-react  スキンの React レンダラ
packages/db            @mba/db            SQLite + Drizzle。スキーマ / クライアント / マイグレーション
apps/api               @mba/api           Hono。ゲーム API + 管理 API + 本番の静的配信
apps/web               @mba/web           プレイヤー向け SPA（React + Vite）
apps/admin             @mba/admin         管理画面 SPA（React + Vite）
```

ビルド・テスト・lint・整形はすべて [vite-plus](https://viteplus.dev)（`vp`）経由。

これとは別に、`e2e/` に画面のテスト（Playwright）がある。ワークスペースの外に置いてあり、依存も Docker のイメージも別。

## 開発（Docker）

```sh
docker compose up            # dev ステージをビルドし、コンテナ内で pnpm install && pnpm dev
docker compose logs -f dev   # 3 つの開発サーバの起動を見る
```

- <http://localhost:5173> … プレイヤー向け SPA
- <http://localhost:5174/admin/> … 管理画面（`/` を開くとここへリダイレクトされる）
- <http://localhost:3000/api/health> … API の生存確認

管理画面が開発時も `/admin/` 配下なのは意図的。本番では 1 ポートに 2 つの SPA を同居させるため
`apps/admin/vite.config.ts` で `base` を設定しており、開発と本番でパスを揃えてある
（揃えないと、本番でだけアセットのパスが壊れる類の問題が出る）。

リポジトリはバインドマウントされるので、ホストのエディタでの編集がそのまま反映される（Vite の HMR、API は `tsx watch`）。`node_modules` は匿名ボリュームに置いてバインドマウントに潰されないようにしてある。SQLite ファイルは名前付きボリューム `sqlite-data` にあるので、`docker compose down`（`-v` 無し）ではデータが残る。

**依存のインストールとコードの実行はコンテナ内で完結する。** ホストで `pnpm install` する必要はない。

コンテナは**非 root（`node` / uid 1000）で動く**ので、生成されるファイルはホストから見ても自分の所有になる。
バインドマウントは uid を数値のまま素通しするだけで変換しないため、ここを root にすると
`node_modules` や `dist` が root 所有になるだけでなく、**依存の postinstall スクリプトが
ホストのソースツリー（`.git/hooks` を含む）に root 権限で書き込める**状態になる。詳細は Dockerfile の dev ステージのコメント。

ホストの `node_modules/` と `data/` は空のディレクトリに見えるが、これは正常。中身は Docker のボリューム側にあり、
ホスト側は volume を取り付けるためのマウント点でしかない（Docker が作るので root 所有だが、空なので普通に削除できる）。

## 開発（Docker 無し）

```sh
pnpm install
pnpm dev
```

`better-sqlite3` がネイティブビルドされるので C/C++ ツールチェーンが要る。

## 本番相当の 1 コンテナ実行

```sh
docker build --target prod -t monster-battle-app .
docker run -p 3000:3000 -v mba-data:/app/data monster-battle-app
```

<http://localhost:3000> でプレイヤー向け SPA、<http://localhost:3000/admin> で管理画面。API と両方の SPA を Hono が 1 プロセス・1 ポートで配信する。

- **開発用のコンテナが動いていると、ポート 3000 がぶつかる。** 先に `docker compose stop` するか、
  `-p 3300:3000` のように公開するポートを変える（その場合は <http://localhost:3300>）
- データは名前付きボリューム `mba-data` に入る。開発用の DB（`sqlite-data`）とは別物で、最初は空から始まる
- Ctrl+C でも `docker stop` でもすぐに止まる。プロセスが自分でシグナルを受けて、DB を閉じてから終了する

## テストと CI

```sh
docker build --target check .                                             # 型・lint・整形・単体テスト
docker compose -f docker-compose.e2e.yml up --build --exit-code-from e2e  # 本番イメージを立てて、ブラウザで操作する
docker compose -f docker-compose.e2e.yml down                             # 後片付け
```

GitHub Actions が main への push と pull request のたびに走らせるのも、上の 2 つ。ワークフローに独自の手順は無いので、
CI で落ちたものは同じコマンドで手元でも落ちる。

- どちらも開発用のコンテナを動かしたまま実行できる（ポートを公開せず、開発用の DB にも触れない）
- 画面のテストの相手は、開発サーバではなく**本番イメージのコンテナ**。開発サーバで通ることは、配るものが動くことを意味しないため
- 組み立て、テストを書くときの決まり、落ちたときの調べ方は [docs/06-testing.md](docs/06-testing.md)

## コマンド

| コマンド | 内容 |
|---|---|
| `pnpm dev` | Vite ×2（:5173 / :5174）と Hono（:3000）を同時起動 |
| `pnpm build` | 依存順に全パッケージ・全アプリをビルド |
| `pnpm test` | テストのあるパッケージで Vitest |
| `pnpm typecheck` / `pnpm lint` / `pnpm fmt` | ワークスペース全体 |
| `pnpm --filter @mba/db run db:generate --name <名前>` | `packages/db/src/schema.ts` を変えた後に SQL マイグレーションを生成。`--name` は必須（[docs/03](docs/03-data-model.md) §マイグレーション） |

## ドキュメント

実装より先にこちらを読む。

| ドキュメント | 内容 |
|---|---|
| [01-architecture.md](docs/01-architecture.md) | 全体構成・依存の向き・なぜ管理画面を別アプリにするか |
| [02-sprite-format.md](docs/02-sprite-format.md) | **スキンの形式。なぜ SVG ではなく数値なのか**・検証仕様・スキン規格 |
| [03-data-model.md](docs/03-data-model.md) | DB が持つもの／持たないもの。見た目は「合成のレシピ」 |
| [04-api-design.md](docs/04-api-design.md) | ゲーム API と管理 API の分離・認証と認可の置き場所 |
| [05-roadmap.md](docs/05-roadmap.md) | 実装の順序 |
| [06-testing.md](docs/06-testing.md) | テストの 2 段・なぜ画面のテストの相手が本番イメージか・CI |

## 現在の状態

**ロードマップの Step 0〜11 を終えた。** 各 Step で決めたこと・やらなかったことは [docs/05-roadmap.md](docs/05-roadmap.md) にある。

プレイヤー側の縦の串が 4 本と、それらが読むマスターデータを書く管理画面があり、全体が 1 コンテナ・1 ポートでも動く。
その全部を、本番イメージを相手にした画面のテストが確かめている。

```
エディタ → POST /api/skins → SQLite → GET /api/skins/:id → <Sprite> で表示（開き直すときは /source）
マップ画面 → step() で移動 → PUT /api/save → SQLite → GET /api/save → 同じ位置から再開
出口に乗る → その 1 歩の保存を待つ → POST /api/travel → 行き先はサーバが決める → 開いたときと同じ経路で読み直す
草むらで調べる → POST /api/battles → 技を選ぶ → POST /api/battles/:id/turn → 勝敗はサーバが決める
きがえ → PUT /api/appearance（スキンの id と色だけ） → SQLite → マップ画面がスキンを集めて 1 体に組む
管理画面 → PUT /api/admin/species/:id・/api/admin/maps/:id → 次のバトル・次に開いたマップから反映
管理画面 → PUT /api/admin/<種類>/:id/retired → 行は消さない。一覧から外れ、参照していたセーブや見た目は取得層で既定へ
```

- `@mba/core` … 移動（`step()`）、バトル（`calcDamage()`・`playTurn()`）、マスターデータの規則（`checkSpecies()`・`checkMove()`・`checkMap()`）
- `@mba/sprite` … `parseSkin()`（検証）、`toRenderable()`（矩形結合）、`frameAt()`（その時刻のコマ）、
  `parseAppearance()`（見た目のレシピの検証）、`composeAppearance()`（レシピどおりに 1 体に組む）
- `@mba/sprite-react` … `<Sprite>`。プレイヤーの見た目もモンスターも、管理画面のプレビューも同じコンポーネントで描く。
  時間を渡すとコマが進み、色を渡すと CSS 変数で着せ替える
- `@mba/db` … 12 テーブル。docs/03 にあるものは全部ある
- `@mba/api` … ゲーム API（スキン、マップ、セーブ、マップ間の移動、バトル、見た目）と管理 API（種族、技、マップと出口、retire）。インメモリの SQLite と決め打ちの乱数でテストしている
- `@mba/web` … マップ画面（着ている見た目で歩く。出口に乗ると、つながった先のマップへ移る）、バトル画面、きがえ（スキン・パーツ・色を選ぶ）、
  スキンエディタ（パーツごとに描く・色を足す／作り直す・コマと再生・着せ替えプレビュー）
- `@mba/admin` … 種族・技の一覧とフォーム、マップの一覧とタイルを塗るエディタ（出口も置ける）、スキンの一覧。どれも retire できて、戻せる
- `e2e/` … 画面のテスト 58 本。マップ、マップ間の移動、バトル、きがえ、エディタ、管理画面、retire と、1 ポートでの配信
- この先（Step 12） … 成長と報酬。
  ロードマップに入れていないのは、本物の認証、本番イメージの軽量化、エディタの undo と描きかけの保存
