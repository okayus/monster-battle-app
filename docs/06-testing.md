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
テストそのものは、単体が数秒、画面が 35 秒ほど。

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
| 単体・API | Vitest | 純粋関数と、インメモリの SQLite を渡した API（`app.request()`） | 894 |
| 画面 | Playwright と Chromium | 本番イメージのコンテナ | 64 |

**規則は下の段で、組み立ては上の段で確かめる。** ダメージの式、スキンの検証、マップの規則は、単体テストが決め打ちの入力で
隅まで見ている。画面のテストはそれをやり直さない。見るのは部品がつながっていること——ボタンを押すとリクエストが飛び、
DB に入り、リロードしても残っていること。

**画面の規則も、下の段に下ろしてある。** 「出口は、乗った 1 歩が保存されてから、1 歩につき 1 回だけ頼む」
「草むらは、サーバがその位置を知ってから調べられる」「遅れているのは `stale_turn` のときだけ」は、画面の状態を
1 つの値にして、次の状態を返す純粋な関数に書いてある（`apps/web/src/map/model.ts`・`battle/model.ts`。
[docs/01](01-architecture.md) §画面の組み立て）。ブラウザ無しで、数ミリ秒で試せる。画面のテストだけが守っていた頃は、
壊して確かめるのに 1 回 2 分かかった。

**だから、画面のテストは乱数を決め打ちしない。** 本番イメージの API は本物の `Math.random` を引く。誰が出るか・どれだけ効くか・
どちらが勝つかは毎回違うので、テストに書くのは「何が出ても成り立つこと」だけ（HP は減る一方で増えない、こちらの技は必ず当たる、
終わったときは片方が 0）。「この出目なら勝つ」を書くのは API のテストの仕事（[docs/04](04-api-design.md)）。

**勝った後・負けた後の画面を確かめたいときは、出目ではなく相手を決める。** 経験値が入る、HP を持ち越す、負けると
最初の場所に戻る、は勝ち負けが決まらないと確かめられない。テストは管理 API で、結果が 1 通りしかない相手を作る
（`e2e/tests/helpers.ts` の `arena()`）。乱数は本物のまま。

| 相手 | 能力値 | 何が出ても |
|---|---|---|
| 1 発で倒れる | HP 1 | こちらの 1 手目で勝つ。何も減らない |
| 1 回だけ殴り返す | HP 2、防御 999、攻撃 1 | こちらの技は 1 しか効かず、2 手で勝つ。その間に 1 だけ減る |
| 絶対に勝てない | HP・攻撃・防御・技の威力が 999 | 相手の 1 手目で負ける |

こちらが何レベルになっていても同じ結果になる数字を選んである。どの技も最低 1 は効く、という規則
（`calcDamage()`）が、ここで役に立つ。

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
- **最初から入っているものを壊さない。** DB は全部のテストで 1 つ。retire のテストは、自分で作った技・種族・マップ・スキンだけを
  外す。最初から入っている種族を外すと、あとから走るバトルのテストに出てこなくなる
- **一覧の並びを当てにしない。** 「先頭にあるはず」ではなく、名前で選ぶ。ほかのテストが一覧に足すので、
  何が先頭に来るかは、どのテストが先に走ったかで変わる。空の DB からの 1 回目では通ってしまうので、
  同じサーバに続けて走らせて確かめる
- **本物のマウスでなぞるときは、なぞる範囲が画面に入っていること。** 画面の外にあるものは押せないので、
  なぞりが途中で切れて、何も言わずに少なく塗る。`stroke()` は始点を画面の中央に寄せ、終点が外なら落ちる。
  データが増えると画面の形は変わるので、これも同じサーバに続けて走らせると出てくる
- **キーを押すのは、画面が読み込み終わってから。** マップが出る前に押したキーは、聞いているものがまだ無いので、
  どこにも届かない。開いた直後に押すテストは、まずマップと現在地が出たことを待つ
- **期待する値が、たまたま最初からそうなっていないかを見る。** 「選ぶとこの値になる」を確かめるなら、
  選ぶ前に別の値にしておく。何が既定で入るかが、ほかのテストの残したものに左右されるときは特に
- **前提を作る補助関数も、API に断られうる。** 断られたら、その場で落とす（`expect(response.ok())`）。
  断られたまま先へ進むテストは、確かめたいことの前提が無いまま通ることがある。プレイヤーを別のマップに置くのは、
  保存ではなく、出口を開けて通す補助関数（`visit()`）で
- **ページが投げた例外は、テストの失敗にする**（`failOnPageErrors()`）。画面が見かけ上動いていても、誰も受けなかった例外は不具合
- **前のテストが残したものを、始める前に片づける。** バトルは途中で離れても残り、次に草むらを調べると同じバトルに戻る。
  HP は次のバトルに持ち越す。バトルを使うテストは、まず `rest()` を呼ぶ。決着のついていないバトルを終わらせ、
  最初のマップに戻し、HP を全快にする。全快にする手段はゲームに 1 つしか無い（負ける）ので、テストもそれを使う
- **数を決め打ちしない。前と後をサーバから読んで、比べる。** プレイヤーのモンスターは、テストをまたいで育つ。
  同じサーバに続けて走らせれば、回をまたいでも育つ。「レベル 1 のはず」「HP は 24 のはず」と書いたテストは、
  2 本目か 2 回目で落ちる
- **確かめたい値が、別の値とたまたま同じになっていないかを見る。** 無傷のモンスターでは、HP と最大 HP が同じ数になる。
  「HP を出している」ことを確かめるなら、先に 1 だけ減らしておく

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
| 断られても、retire の操作が何も出さない | `will not retire a move a species still knows, and does once the species gives it up` ほか 3 本 |
| retire できた後、一覧を取り直さない | 同上 ほか 3 本 |
| 断った理由から、誰が使っているかを抜く | 同上 ほか 2 本 |
| フォームが、retire 済みのものも選択肢に出す | 同上 ほか 1 本 |
| 一覧で、retire 済みに印を付けない | 同上 ほか 2 本 |
| 技の保存が、いつも新しく作る | `creates a move, changes it, and offers it to species` |
| きがえの一覧が、外したスキンを出し続ける | `takes a retired skin out of the wardrobe and off whoever wears it, and gives the look back` |
| 外したスキンを着た見た目を、そのまま返す | 同上 |
| プレイヤーの側から、外したマップが見え続ける | `sends a player on a retired map back to the start, and puts them back when it returns` |
| 種族が覚えている技でも外せる | `will not retire a move a species still knows, and does once the species gives it up` |
| retire 済みの技を覚えた種族でも戻せる | `says what has to come back first when a species still knows a retired move` |
| 最初のマップと既定のスキンも外せる | `will not retire what everything else falls back to` ほか 1 本 |
| 「サーバがその位置を知っている」を、保存の表示から読む | `asks to go through only once the step onto the exit has been saved` |
| 出口に着いただけで、通ってしまう | `does nothing on arriving on an exit, and goes back through it once stepped onto` |
| マップを移っている間も、キーで歩ける | `holds the player still while the server is taking them through` |
| マップに出口を描かない | `marks the way out, and takes the player through it when they step on it` |
| 出口を通れなかったとき、何も出さない | `says so when the server will not let the player through, and lets them walk on` |
| travel が、プレイヤーを動かさずに答える | `marks the way out, and takes the player through it when they step on it` ほか 6 本 |
| 出口が、立てないタイルに着いてもよい | `is set up from the admin screen: an exit put on a map is one a player can take` |
| 出口の筆が、押した瞬間とクリックの両方で効く | 同上 |
| 行き先のマップを選んでも、位置が前のまま | 同上 |
| 管理画面のタイルに、出口の印を付けない | 同上 |
| 木の上にも出口を置ける | 同上 |
| 勝っても、経験値を書かない | `writes a win to the monster, and says on the screen what was written` ほか 2 本 |
| バトルで減った HP を書かない | `takes into the next battle the health the last one left` ほか 2 本 |
| どのバトルも全快から始める | 同上 ほか 1 本 |
| 負けても、プレイヤーを動かさない | `restores the monster after a loss, puts the player back at the start, and says so` ほか 2 本 |
| 負けても、全快させない | 同上 ほか 8 本 |
| 勝ったときも、最初の場所に戻す | `writes a win to the monster, and says on the screen what was written` ほか 2 本 |
| 一覧が、どのバトルの途中かを言わない | `goes back to a battle that is not over, from the grass and from the monsters screen` ほか 5 本 |
| 草むらを調べると、途中のバトルの横で新しく始める | 同上 |
| バトルのログが、手に入れたものを出さない | `writes a win to the monster, and says on the screen what was written` ほか 1 本 |
| ログが言うレベルが 1 つ多い | `takes into the next battle the health the last one left` |
| バトル画面のレベルが、いつも 1 | 同上 |
| 負けた後も、勝った後と同じことを言う | `restores the monster after a loss, puts the player back at the start, and says so` |
| なかまの画面が、HP の代わりに最大 HP を出す | `lists the player's monster with the level and the health the server gives it` |
| なかまの画面の HP のバーが、いつも満タン | 同上 |
| なかまの画面のレベルが、いつも 1 | 同上 ほか 1 本 |
| なかまの画面に、バトルへ戻るリンクが無い | `goes back to a battle that is not over, from the grass and from the monsters screen` |
| 一覧を読めなくても、何も言わない | `says so when the monsters cannot be loaded` |
| 次のレベルまでの残りを、0 から数える | `lists the player's monster with the level and the health the server gives it` |

| マップの中のコンポーネントが、見た目のリクエストを始める（Step 13 の途中。下） | `is fetched once, not again for every step` |

最後の行は、わざと壊したのではない。Step 13 で読み込みを React の `<Suspense>` に替えたとき、見た目のリクエストを
マップの中のコンポーネントが始める形にしてしまい、このテストが落ちた。React が描画をやり直すたびにリクエストも
始め直しになり、最初の 0.3 秒で同じ絵を 120 回ほど取りに行っていた。画面は正しく出ていたので、目では分からない。
「1 回だけ取る」を、リクエストを数えて確かめるテストがあったから見つかった。

`check` の方も同じように確かめてある。型エラー、lint 違反、整形されていない行、成り立たなくなった単体テストは、
それぞれ自分の `RUN` で落ちる。

**単体テストも同じ。** 検査を 1 つ外す、条件を 1 つ緩める、といった壊し方を 1 つずつ入れて、そのパッケージのテストを回す。
画面のテストと違って 1 回が数秒なので、検査の数だけ試せる。Step 9 では `parseAppearance()` の検査と
見た目の API の検査を 1 つずつ外して、どれも落ちることを見た。

**型で言ったことは、型のテストで確かめる。** 「終わったバトルに技は出せない」「`parseSkin()` を通していないスキンは
保存できない」「ルートに渡る口では書けない」は、どれもコンパイルが通らないことで守られている
（[docs/04](04-api-design.md) §型だけのしるし）。通らないことを、テストに 1 行で書く。

```ts
// @ts-expect-error — only a battle that is still going on can be played
playTurn(over, "bump", FULL);
```

`@ts-expect-error` は、次の行がエラーでなければ、それ自体がエラーになる。型を緩めて渡せるようにすると、注釈が余って
`tsc` が落ちる。`check` の型の検査はテストのファイルも見るので、これで足りる。行は、呼ばれない関数の中に置く
（実行はしない。確かめたいのは、書けないこと）。壊して確かめるのも同じで、型を 1 つ緩めて `pnpm typecheck` を回す。

- **注釈は、エラーが出る行の真上に置く。** 整形で式が複数行に分かれると、エラーの出る行が動いて、注釈が外れる。
  オブジェクトの中のプロパティが原因なら、そのプロパティの真上に書く
- **しるしを足すキャストは、1 つずつ。** `as Resolved<Checked<T>>` は 2 つのしるしを一度に付けるので、検査を
  1 つ飛ばしても型が通ってしまう。見つけたのは「規則の検査を飛ばす」という壊し方が生き残ったとき
- **スプレッドは、型のしるしも写す。** `{ ...skin }` は、`skin` が `Parsed<Skin>` なら `Parsed<Skin>`。
  「写したものは渡せない」とは書けない

**判断は、書く前の一覧を見て確かめられる。** API の判断は、書かずに「何を変えるか」を値で返す
（[docs/04](04-api-design.md) §読む・決める・書く）。テストは判断を直接呼んで、返ってきた一覧を比べる。
勝ったターンは 2 つ、負けたターンは 3 つ、もうその状態なら 0。HTTP 越しのテストはそのまま残してあり、
こちらは「何が書かれたか」を DB から読んで確かめる。

**表は、全部の行を 1 行ずつ壊す。** エラーの `kind` とステータスの対応は、50 行の表が 1 つ（`refusals.ts`）。
各行の数字を別の数字に変えて API のテストを回し、どの行にも落ちるテストがあることを見た。最初は 6 行に無かった。
どれも「その `kind` で断られること」を HTTP 越しに見るテストが無かった行で、うち 1 つ（`no_start_map`）は
応答そのものにテストが無かった。表にしたことで、テストの無い応答が数えられるようになった。

**「途中で失敗しても半端に残らない」は、途中で失敗させて確かめる。** バトルの結果の書き戻しは、バトル・モンスター・
位置を 1 つのトランザクションで書く（[docs/04](04-api-design.md)）。これは、普通に通るテストをいくら足しても確かめられない。
全部うまく書けたときは、トランザクションがあっても無くても同じ結果になる。API のテストは、DB にトリガーを仕込んで
書き込みの 1 つを失敗させ、バトルが元のターンのまま残ること、同じターンをもう一度送れば 1 回だけ書かれることを見ている。
バトルの書き込みをトランザクションの外に出すと、落ちるのはこの 2 本だけで、ほかの 300 本は通る。

**テーブルの形で言った決まりは、テーブルに直接書いて確かめる。** 「1 体のモンスターが同時に入れるバトルは 1 つ」は
ユニークインデックスが持っている（[docs/03](03-data-model.md)）。ルートは、インデックスに当たる前に途中のバトルを
返すので、ルートのテストだけでは、インデックスが無くても通ってしまう。テストは行を直接入れて、DB が断ることを見る。
マイグレーションの SQL から `UNIQUE` を消すと、このテストが落ちる。

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
