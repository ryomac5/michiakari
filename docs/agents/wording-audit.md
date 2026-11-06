# 文言の監査

`docs/agents/wording.md` の決まり R1 から R16 に照らした、2026-11-06 の直した後の状態を書く。
直す前の監査は 197 行の違反を挙げていた。その一覧は git の履歴に残る。

ファイル名は短く書く。場所の対応は次のとおりとする。

- `ja.json`: `apps/web/messages/ja.json`
- `en.json`: `apps/web/messages/en.json`
- `templates.ts`: `apps/agent/src/judge/templates.ts`
- `judgment-system.md`: `apps/agent/src/prompts/judgment-system.md`
- `emit-judgment.ts`: `apps/agent/src/tools/emit-judgment.ts`
- `person-accident.ts`: `apps/web/src/features/judgment/fixtures/person-accident.ts`
- `session.ts`: `apps/agent/src/judge/session.ts`
- `time.ts`: `apps/web/src/features/judgment/time.ts`

## 直したもの

| 場所 | 直した文の数 | 主な直し方 |
|---|---|---|
| `ja.json` | 110 | 補足と案内をです・ます調にそろえた。数と助詞の間の空白を消した。質問の見出しを「〜を選ぶ」にした |
| `en.json` | 77 | 短縮形と「/」と括弧をやめた。resume を restart に、Decision を cutoff にそろえた |
| `templates.ts` | 約70 | 「頃」を「ごろ」にした。理由の先頭の文を、待つ場合との比較に書き換えた。補足の文をです・ます調にした |
| `judgment-system.md`、`emit-judgment.ts` | 13 | 文の例を新しい形にした。文体、「ごろ」、指令の言葉、ノイズの文の決まりを足した |
| `person-accident.ts` | 14 | デモの判断の時刻を文の書き方にした。根拠の文から知見の言い方を外した |
| `session.ts`、`app.ts`、`run-judge.ts`、`geo-provider.ts` | 17 | エラー文と根拠文から「リクエスト」「再試行」「観測」と括弧を外した |
| ダミーの知見の名前 | 2 | 「車内対応」を「急病人の救護・非常ボタン」にした |

画面の部品も 2 つ直した。

- 文の中の時刻は `time.ts` の `formatClockInSentence` と `spellClockInSentence` で「21時40分」にそろえた。境目の説明、結末の要約、時間軸の読み上げが当たる。
- 「動くのは 14時58分ごろ の見込み」と「23:32 までに動けば間に合う」の空白は、flex の `gap` が文の切れ目に入っていた。文を 1 つの `span` で包んで消した。

## 残した箇所

| 場所 | いまの文 | 決まり | 残した理由 |
|---|---|---|---|
| `ja.json` の `situation.paste.placeholder` | 例: 人身事故のため、運転を見合わせています | R2 | 入力例は放送の文を写してよい例外である |
| `ja.json` の `start.locating` ほか 7 件 | 判断しています / 計算しています / 地図は準備中です | R1 | 進行中の状態の表示である。R7 の良い例と同じ形にした |
| `ja.json` と `en.json` の `about.attribution` | 地図: 国土地理院 / © OpenStreetMap contributors | R7 | 出典の正式名称と表記の例外である |
| `ja.json` の `judgment.conclusion.live` | 結論: {action}。{headline} | R1 | 読み上げ専用で、画面には出ない |
| `ja.json` の `entry.gpsStationQuestion` | {station}駅にいますか | R1 | 「はい」「違う」で答える問いなので、問いの形を残した |
| `ja.json` の `judgment.change.title` ほか | 判断が変わりました / 通信が途切れました | R1 | 状態の変化の知らせである。wording.md の補いで認めた |
| `en.json` の `judgment.trainTypes` | local / rapid | R11 | 文の途中に差し込むため、小文字のまま残した |
| `session.ts` の `remaining` の根拠文 | 再開して乗れるまでの残り時間の見込み | R2 | 見込みの出どころは別の担当が直している。根拠文は画面に出ていない |
| `ja.json` の `judgment.premise.trainsAheadPhoto` | 走行位置の画像から、前の列車を種別の分からない列車と読みました。 | R8 | 種別が分からないときだけ同じ語が重なる。種別名を差し込む文の形を優先した |

## 開発者に確認したい点

- 本番の知見を書くときは、事象の名前に「車内対応」のような指令の言葉を使わないでほしい。名前はリプレイの一覧と根拠の欄に出る。
- ダミーの知見 `in_car_response.yaml` の summary とシナリオの note には「短く終わることが多い」がある。画面には出ないが、本番の知見では避けてほしい。
- 結論の見出しの時刻は「20時05分まで待つ」のように文の書き方にした。札は「21:40」とする R5 と分けた理由は、wording.md の補いに書いた。
