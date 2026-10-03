# 06. テストと CI

## 2 つのコマンド

```sh
docker build --target check .
docker compose -f docker-compose.e2e.yml up --build --exit-code-from e2e
```

1 つ目は**型・lint・整形・単体テスト**。2 つ目は**本番イメージを立てて、ブラウザで操作する**。
どちらも終了コードが結果で、CI が走らせるのもこの 2 行だけ（下の「CI」）。

| | 何を確かめるか | かかる時間 |
|---|---|---|
| `check` | コードとして正しいか。動かさずに分かること全部 | ソースを変えた後は 30 秒〜2 分。何も変えていなければ 1 秒 |
| e2e | 配るものが、ブラウザから操作して動くか | テストだけを変えた後は約 30 秒。アプリを変えた後は 1〜3 分 |

時間に幅があるのは、ソースが変わると依存のダウンロードからやり直すため（下の「今は入れていないもの」）。
テストそのものは、単体が数秒、画面が 20 秒ほど。

- **どちらも開発用のコンテナに触れない。** ポートを公開せず、compose のプロジェクト名も別にしてあるので、
  `docker compose up` したまま走らせられる。開発用の DB も読まない
- 2 つ目の後片付けは `docker compose -f docker-compose.e2e.yml down`。残るのは止まったコンテナだけなので、急がない
- **書いている最中は、今までどおり dev コンテナで回す**（`docker compose exec dev pnpm test` など）。速いのはそちら。
  2 つのコマンドは「これが通れば CI も通る」を確かめるためのもの

`check` は Dockerfile のステージで、検査 1 つが `RUN` 1 つになっている。落ちたときは、どの検査かがビルドの出力に名前で出る。
dev コンテナで同じ検査を回すのとの違いは、**まっさらな状態から始めること**。lockfile どおりに入れ直した依存と、
コピーしたばかりのソースだけを使うので、「自分の dev コンテナにたまたま入っているもの」に頼った結果にならない。

## テストは 2 段ある

| 段 | 道具 | 相手 | 件数 |
|---|---|---|---|
| 単体・API | Vitest | 純粋関数と、インメモリの SQLite を渡した API（`app.request()`） | 538 |
| 画面 | Playwright と Chromium | 本番イメージのコンテナ | 44 |

**規則は下の段で、組み立ては上の段で確かめる。** ダメージの式、スキンの検証、マップの規則は、単体テストが決め打ちの入力で
隅まで見ている。画面のテストはそれをやり直さない。見るのは部品がつながっていること——ボタンを押すとリクエストが飛び、
DB に入り、リロードしても残っていること。

**だから、画面のテストは乱数を決め打ちしない。** 本番イメージの API は本物の `Math.random` を引く。誰が出るか・どれだけ効くか・
どちらが勝つかは毎回違うので、テストに書くのは「何が出ても成り立つこと」だけ（HP は減る一方で増えない、こちらの技は必ず当たる、
終わったときは片方が 0）。「この出目なら勝つ」を書くのは API のテストの仕事（[docs/04](04-api-design.md)）。

## なぜ相手が本番イメージなのか

**開発サーバで通ることは、配るものが動くことを意味しない。** 開発時は Vite が 2 つと `tsx` が 1 つ、本番は Hono が 1 つ。
同じコードの、違う組み立て（[docs/01](01-architecture.md) §開発と本番で変わるところ）。Step 7 で見つかった不具合は、
どれも開発サーバでは起きなかった。

本番でだけ意味を持つ行を消して、確かめてある。`check` は通ったままで、画面のテストだけが落ちる。

| 消したもの | `check` | 画面のテスト |
|---|---|---|
| `apps/api/src/index.ts` の、`/admin/*` を配る行 | 通る | 管理画面を開く 8 本が落ちる |
| `apps/admin/vite.config.ts` の `base: "/admin/"` | 通る | 同じ 8 本が落ちる |

## 画面のテストの組み立て

```
docker-compose.e2e.yml
  server   Dockerfile の prod ステージ。DB は tmpfs に置く
  e2e      e2e/Dockerfile。Playwright・Chromium・テスト。server のネットワークに同居する
```

**ブラウザ入りの環境は、別のコンテナで、依存も別。** `e2e/` は pnpm ワークスペースの外にあり、自分の `package.json` と
lockfile を持つ。Docker のビルドコンテキストも別（アプリ側の `.dockerignore` が `e2e` を外している）。
テストの道具がアプリの依存グラフに入らず、開発用のイメージがブラウザを抱えずに済む。テストを直しても、アプリのイメージは作り直されない。

**テストもコード。** `e2e` のイメージは、ビルドの途中でテスト自身の型・lint・整形を検査する。通らなければイメージができない。

**DB は毎回、空から。** `server` の `/app/data` は tmpfs で、コンテナと一緒に消える。起動のたびにマイグレーションと種まきが走るので、
テストはいつも同じ最初の状態を相手にする。開発用の DB を借りないのは、このため。

**Chromium の版は、Playwright の版が決める。** `@playwright/test` は lockfile で固定してあり、それに対応するビルドのブラウザが
イメージに入る。ブラウザと、それを動かすライブラリがずれない。

### コンテナ同士の住所

テストは `server` のネットワークに同居して（`network_mode: service:server`）、`http://127.0.0.1:3000` を開く。

素直なやり方——別のコンテナから、サービス名で呼ぶ——は 2 回失敗した。どちらも、症状から原因までが遠い。

- **サービス名が `app` だと、Chromium はページを 1 つも開けない。** `.app` は TLD ごと HSTS のプリロードリストに載っていて、
  Chromium は `http://app:3000` を黙って https に書き換える。出るのは `ERR_SSL_PROTOCOL_ERROR` だけ。`.dev` も同じリストにある。
  コンテナの中のブラウザにとって、サービス名は実在の TLD と区別がつかない
- **ほかの名前にしても、15 回に 1 回ほど、リクエストが 5 秒止まった。** Playwright はホスト名を IPv4 と IPv6 で別々に引く。
  サービスには IPv6 のアドレスが無く、Docker の内蔵リゾルバはその問い合わせに自分で答えずに上流の DNS へ回す。
  上流の返事が遅いと、その間ずっと待つ

**住所を名前ではなく数字にすると、両方とも消える。** 引くものが無く、HSTS の対象にもならない。

## テストを書くときの決まり

`e2e/playwright.config.ts` と `e2e/tests/helpers.ts` に、理由と一緒に書いてある。

- **前提は API で作り、確かめたい操作だけを画面でする。** バトルのテストは草むらまで歩かず、`PUT /api/save` で立たせる。
  歩くことが壊れたときに、バトルのテストまで落ちないように。歩くことには歩くことのテストがある
- **1 本ずつ順に走らせる**（`workers: 1`）。ユーザーは 1 人、セーブは 1 つ、DB も 1 つ。並べて走らせると互いのプレイヤーを動かす
- **リトライしない**（`retries: 0`）。2 回目に通ったテストは、通っていない。直すか、消す
- **探すのは役割と名前で**（`getByRole("button", { name: "保存" })`）。役割を持たないもの（タイル、キャンバスのセル、スプライト）は
  `data-*` 属性で。クラス名では探さない
- **値を読むのは、待てる形で**（`expect(...)` に locator を渡すか、`expect.poll()`）。その場で 1 回だけ読むと、
  画面が追いつく前の値を読むことがある
- **作るものの名前は実行ごとに変える。** 管理画面のテストは種族とマップを作る。空の DB が相手なら要らないが、
  同じサーバに何度走らせても通るようにしてある（下の「1 本だけ走らせる」）
- **ページが投げた例外は、テストの失敗にする**（`failOnPageErrors()`）。画面が見かけ上動いていても、誰も受けなかった例外は不具合

## 書いたテストは、壊して確かめる

**通るテストが、何かを守っているとは限らない。**

「矢印キーでページがスクロールしない」のテストは、守っているはずの 1 行（`preventDefault()`）を消しても通った。
キーによるスクロールはアニメーションで、押した直後の位置は、これからスクロールする場合でも 0 だから。
今は、スクロールが始まっているはずの時間だけ待ってから見る。さらに、マップが使わないキー（PageDown）ではスクロールすることも見る。
これが無いと、「スクロールしなかった」が「そもそもキーでスクロールできない画面だった」と区別できない。

**「起きない」を確かめるテストは、こうなりやすい。** 起きるはずのことが起きる前に見ても、起きないことの確認にはならない。

もう 1 つ。「続けて歩いても最後の位置が残る」のテストは、守っているはずの仕組み（`saver.ts`）を壊しても通ることがあった。
保存が速すぎて、リクエストが重ならなかったため。今は最初の保存をテストの側で止めておき、その間に残りを歩く。
送られたリクエストが「最初の位置」と「最後の位置」の 2 本だけであることまで見る。

だから、テストを足したら、守っているはずのコードを壊して落ちることを見る。壊して確かめたものは次のとおり。

| 壊したもの | 落ちるテスト |
|---|---|
| 矢印キーの `preventDefault()` を消す | `does not scroll the page with the arrow keys` |
| 保存中に来た位置を捨てる | `keeps the last position of a burst of steps` ほか 1 本 |
| 位置を 1 つずつ、待たずに送る | `keeps the last position of a burst of steps` |
| マップを開いただけで位置を保存する | `saves each step, and starts from there after a reload` |
| ターンを断られた後、状態を取り直さない | `catches up when the turn was already played somewhere else` |
| スプライトを CSS 変数でなく色そのもので塗る | `tries parts and colours on without changing the drawing` |
| コマの長さの欄が、前のコマの値を出したままになる | `adds, times and removes frames` |
| 開始位置のタイルを木で塗れるようにする | `paints a map, keeps the spawn standable, and the game serves what was saved` |
| マップが、1 歩ごとに見た目を取り直す | `is fetched once, not again for every step` |
| マップの自分を、ただの丸のままにする | `starts as the default skin, drawn on the map where the marker was` ほか 4 本 |
| マップが、色を付けずに見た目を描く | `dyes a colour, and leaves the skin as it was drawn` ほか 1 本 |
| パーツの差し替えを無視して、全部を着ているスキンから組む | `takes a part from another skin, with the colours that part is painted in` ほか 2 本 |
| `<Sprite>` が、色の CSS 変数を付けない | `dyes a colour, and leaves the skin as it was drawn` ほか 4 本 |
| その見た目に無い色も、レシピに入れて送る | `sends only the colours that apply, and keeps the others for when they do again` |
| 選び直した後も「保存した」を出したままにする | `stops saying it is saved once something is changed` |
| パレットにある色を全部、色の欄に出す | `offers the colours the look is painted with, and no others` ほか 2 本 |
| サーバに断られても、何も出さない | `says so when the server refuses, and the look stays as it was` |
| レシピを保存せずに 200 を返す | `wears the skin chosen on the dressing screen, on the map and after a reload` ほか 5 本 |

`check` の方も同じように確かめてある。型エラー、lint 違反、整形されていない行、成り立たなくなった単体テストは、
それぞれ自分の `RUN` で落ちる。

**単体テストも同じ。** 検査を 1 つ外す、条件を 1 つ緩める、といった壊し方を 1 つずつ入れて、そのパッケージのテストを回す。
画面のテストと違って 1 回が数秒なので、検査の数だけ試せる。Step 9 では `parseAppearance()` の検査と
見た目の API の検査を 1 つずつ外して、どれも落ちることを見た。

## 日々の操作

### 落ちたとき

出力に、落ちたテスト・期待した値と実際の値・テストのどの行かが出る。それで足りないときは、テスト用のコンテナに残っているものを取り出す。

```sh
docker compose -f docker-compose.e2e.yml cp e2e:/e2e/test-results e2e/
```

落ちたテストごとに 3 つある。通ったテストの分は残らない。

- `test-failed-1.png` … 落ちた瞬間の画面
- `error-context.md` … そのときのページの構造（役割と名前の木）
- `trace.zip` … そこまでの操作の記録。<https://trace.playwright.dev> に置くと、操作 1 つごとの画面と通信を見られる
  （ブラウザの中で開くだけで、どこにも送られない）

`e2e/test-results/` は git の管理外にしてある。

### 1 本だけ走らせる

```sh
docker compose -f docker-compose.e2e.yml run --rm --build e2e pnpm exec playwright test tests/map.spec.ts
docker compose -f docker-compose.e2e.yml run --rm --build e2e pnpm exec playwright test -g "arrow keys"
```

`server` は立ったままになるので、2 回目からは数秒で返る。DB も前の実行のまま。空に戻すのは `down`。
アプリの方を変えた後は、`--build` が `server` のイメージも作り直してコンテナを入れ替える（DB も空に戻る）。

`test.only` で絞ってもよいが、**消し忘れると残りのテストが黙って走らなくなる。** CI では `test.only` が残っているだけで失敗にしてある
（`forbidOnly`。`CI` という環境変数があるときだけ効く）。

### テストを整形する

`e2e` のイメージのビルドは、整形されていないテストで落ちる。直すのは dev コンテナの整形で。

```sh
docker compose exec dev pnpm exec vp fmt e2e/tests e2e/playwright.config.ts
```

`e2e/package.json` の oxfmt と oxlint は、vite-plus が中に持っているのと同じ版に固定してある。版がずれると、
片方で整形したものがもう片方で落ちる。**vite-plus を上げたら、ここも合わせる。**

### e2e の依存を変える

`e2e/package.json` を書き換えてから、lockfile を作り直す。

```sh
docker compose exec dev sh -c 'cd e2e && pnpm install --lockfile-only --ignore-workspace'
```

更新されるのは lockfile だけで、`node_modules` は作られない（入れるのはイメージのビルド）。
`--ignore-workspace` が要るのは、dev コンテナの中では `e2e/` が親のワークスペースの下に見えるため。

## CI

`.github/workflows/ci.yml`。main への push と pull request のたびに、2 つのジョブが上の 2 つのコマンドを 1 つずつ走らせる。

**ワークフローには、独自の手順が無い。** チェックアウトして、コマンドを 1 つ実行するだけ。Node も pnpm もブラウザも、
ランナーには入れない。どれを使うかは Dockerfile と lockfile が決める。CI にしか無い手順があると、CI でだけ落ちたときに
手元で調べようがない。ここでは、CI で落ちたものは、同じコマンドで手元でも落ちる。

- **アクションはコミットで固定する**（`actions/checkout@<コミット> # v7.0.1`）。タグは後から別のコードに付け替えられるが、コミットは変わらない
- **権限は読み取りだけ**（`permissions: contents: read`）。チェックアウトに使ったトークンも残さない（`persist-credentials: false`）。
  そのディレクトリは、直後に Docker のビルドコンテキストになる
- **ランナーは `ubuntu-latest`。** 要るのは Docker だけなので、ランナーの版で結果が変わらない
- **ジョブに時間の上限を付ける。** 付けないと、固まったジョブが 6 時間走る
- **ジョブは 2 つに分ける。** 互いの結果を待つ必要が無く、赤くなった方の名前で、壊れたものの種類が分かる

**ワークフローは手元では走らせられない。** 置く前に確かめられるのは書き方までで、それは actionlint で見る。

```sh
docker run --rm -v "$PWD:/repo:ro" --workdir /repo rhysd/actionlint:latest
```

中身を薄くしてあるのは、このためでもある。ワークフローが呼ぶ 2 つのコマンドの方は、クローンし直したリポジトリで、
キャッシュ無し・`CI=true` で通ることを手元で確かめられる。

## 今は入れていないもの

- **ビルドのキャッシュの工夫。** Dockerfile は `COPY . .` の後で `pnpm install` するので、ソースを 1 行変えると依存のダウンロードから
  やり直す。CI は毎回ベースイメージの取得から始める。どちらも正しく動いていて、遅いだけ。速くするのは最適化
- **CI からの持ち出し。** 落ちたときのスクリーンショットとトレースは、手元で同じコマンドを走らせて取る。
  CI でだけ落ちて手元で再現しない、ということが起きたら、そのとき足す
- **Chromium 以外のブラウザ。** 確かめたいのは配るものが動くかどうかで、ブラウザごとの違いではない
- **見た目の比較**（スクリーンショットの差分）。テストが見るのは構造と値
