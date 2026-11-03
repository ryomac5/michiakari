# アーキテクチャ

## 1. 全体像

```
[利用者の端末]  apps/web（Next.js）
    │  入力: 写真 / 貼り付け / 選択式、現在地、行き先、制約
    │  SSE で判断イベントを受信し、結論・タイムライン・地図を逐次更新
    ▼
[判断エージェント]  apps/agent（Hono + Anthropic SDK）
    │  1. 入力の解釈（Haiku）: 写真・文章 → 構造化された観測
    │  2. 判断ループ（Opus）: ツールで判断材料を集め、総合して判断
    │  3. 判断結果を Zod で検証して返す
    ▼
[ツール群]
    ├─ 知見ナレッジ参照        knowledge/*.yaml
    ├─ 気象（雨量推移・警報）  気象庁
    ├─ 代替手段の算出          packages/geo + packages/core（徒歩時間、乗車時間、運賃）
    ├─ 段階と残り時間の推定    packages/core（ナレッジの所要時間分布にもとづく）
    └─ 分岐点の計算            packages/core
```

原則: **数値はコード、解釈と判断と説明はエージェント。** エージェントが数値を自分で計算することを禁止し、必ずツールの結果を使わせる。

## 2. 構成要素

### 2.1 apps/web

- Next.js（App Router）、スマートフォン優先
- 地図: MapLibre GL JS。背景は地理院タイルの淡色地図とする。路線・駅・経路・到達範囲は GeoJSON のレイヤーで重ねる
- 判断の受信: SSE。イベントごとに画面の該当部分を更新する
- 多言語: 日本語・英語（next-intl）。エージェント出力も利用者の言語で返す
- リプレイモード: `scenarios/` のシナリオを時刻順に入力として流し、判断の変化を再生する
- 分岐点の時間軸: 分岐点と再開見込みの関係を横 1 本の軸で示す。観測が進むと帯と目盛りが動く
- 知見の閲覧画面: `/knowledge` に知見ナレッジを並べる。PC 幅では左に YAML の該当部分、右に構造化した表示を置く

リプレイは `/replay` で動く。要点は次のとおり。

- 画面のサーバー側が `CONTENT_DIR` からシナリオを読む。検証に通ったものだけを使い、`expectations` は画面に渡さない
- timeline の 1 件を `scenario` 型の RawInput にし、解釈済みの観測の列と合わせて `POST /judge` に送る
- 時計はシナリオの 1 分を実時間 1 秒で進める。判断の生成中は止め、`judgment_ready` を受けてから次の観測へ進む
- 速さは 1x・2x・4x から選ぶ。`?speed=` で 600 倍まで上げられ、`?scenario=` で最初に開くシナリオを指定できる。どちらもテストと録画のためである
- 4x 以下では、推論の過程を目で追えるようイベントの間を 320 ミリ秒空ける
- 判断が確定しなければ再生を止め、同じ観測を入れ直せるようにする
- 観測ごとの行動・段階・根拠を履歴に残し、判断が変わったことを示す

### 2.2 apps/agent

- Hono による常駐サービス。エンドポイント:
  - `POST /judge` 入力を受け取り、判断イベントを SSE で返す
  - `GET /health`
- Anthropic Client SDK（`@anthropic-ai/sdk`）で自前のツール実行ループを実装する
  - 理由: 公開 Web サービスにファイル操作・コマンド実行のツールは不要で危険。イベントの粒度を完全に制御したい
- モデル: 判断 `claude-opus-5-5`、入力の解釈 `claude-haiku-5-5`（設定ファイル1か所で管理）
- 状態: 判断のたびに、これまでの観測の列をすべて入力として受け取る（サーバーに保存しない）
- モード: `claude` と `deterministic` の 2 つ。環境変数 `JUDGE_MODE` で指定し、無ければ `ANTHROPIC_API_KEY` があるときだけ `claude` にする
  - `claude`: Haiku で解釈し、Opus のツール実行ループで判断する。選択式の入力は Claude を通さない
  - `deterministic`: 文字列照合で解釈し、規則で判断する。写真は読めないので error を返す
  - 原因が分からないときと確信度が低いときは保留する。ただし分岐点までの残りが `holdDecisionWindowMinutes` 以内なら言い切る
  - その場合、再開見込みの幅のうち分岐点より後の割合が `lateShareToSwitch` 以上なら切り替える。閾値は agent の config に置く
  - 見込みが立てやすく、再開までの p80 が core の `SHORT_FLOW_MAX_MINUTES` 以内の事象は「短く終わる」とみなす。確信度が低くても保留せず、比較で決める
  - 見込みが立てやすい事象は、発生直後から言い切る。知見から見積もった再開の見込みが分岐点より後なら、時間の窓を待たずに切り替える
  - 発表された見込み時刻があるときは、発表の時刻で比べる。知見の下限は当てない
  - 見込みが立てやすく、原因が観測から特定できたときは、確信度を `confidenceParams.floorWhenPredictable` より下げない
  - 見込みが立てやすい事象で、知見から見積もっているときは、理由の頭に流れの一文を置く。claude モードもプロンプトで同じ方針にする
- フォールバック: claude モードの失敗は決定論モードで仕上げる
  - 解釈が失敗したら、文字列照合で解釈し直す
  - 判断ループが失敗したら、済んだツールの結果を残して残りを決定論で進める。失敗とは拒否、`max_tokens`、ツール呼び出し 12 回の超過、反復の上限、検証の再失敗、例外である
  - 拒否された呼び出しは、まずサーバー側のフォールバックで別モデルに回す
- 切断時の中断: 利用者が切断したら AbortController で Claude の呼び出しと判断ループを止め、何も送らずに終える
- 頻度制限: 接続元ごとの固定窓で、プロセス内のメモリで数える
  - 上限は 1 分あたり 20 件とし、`RATE_LIMIT_PER_MINUTE` で変えられる。超えたら 429 と error イベントを返す
  - 単位は既定で接続元アドレスとする。`TRUST_PROXY=true` のときだけ `X-Forwarded-For` の先頭を使う

### 2.3 packages/schema

すべての境界の型を Zod で定義する唯一の場所。主要スキーマは本書 4 章。

### 2.4 packages/core

決定論的な計算。Claude を呼ばない。すべて単体テストを持つ。

- `estimateRemaining`: 知見・現在の段階・段階の経過時間から、実際に乗れる列車が来るまでの残り時間分布（p50, p80）を返す。再開後の初列車待ちである after_resume を含む
- `estimateBranchAwareRemaining`: 段階の分岐を考えた残り時間を返す。発生からの経過を渡すと、知見の下限を当てる
  - 下限は `typical_floor_minutes` から発生からの経過を引いた分で、再開までの部分に当てる
  - 標本ごとに再開までの部分を下限へ切り上げる。長い側の形は変えない
  - 発生時刻は観測から分からないので、agent は最初の観測の時刻を発生とみなす
  - 発表された見込み時刻を使うときは下限を当てない
- `describeTypicalFlow`: 知見から、よくある流れと見込みの立てやすさを返す。詳細は 4.1 に書く
- `computeArrival`: 経路（徒歩・乗車・待ち）から到着時刻を返す
- `computeBreakEven`: 待つ場合と各代替手段の到着時刻を比べ、分岐点の時刻を返す。分岐点の time は運転再開の期限である
- `computeTaxiFare`: 距離と時刻から公示運賃体系にもとづく概算運賃を返す

### 2.5 packages/geo

- 路線・駅・事業者（国土数値情報から整形）
- 乗換の徒歩時間は、Valhalla の経路を事前に計算して求める
- 経路が大回りになる組と、データが無い組は、直線距離の 1.3 倍を分速 80m で割る概算に戻す。計算は packages/core の walk が担い、パラメータは `packages/core/params/walk.ts` に置く
- 徒歩10分・20分の到達範囲は、乗降客数の上位 300 か所が事前計算の結果である。それ以外の駅は概算の円で描く
- 路線上の距離からの乗車時間の概算（関西にはオープンな時刻表データがないため。後述）

経路探索は packages/geo の routing が担う。ネットワーク上のダイクストラで探し、止まっている区間の辺を除く。前の候補の主な路線を除いて探し直し、多様な候補を最大 3 本返す。

### 2.6 packages/data

前処理。`pnpm data:build` で以下を生成する。

1. 対象エリアのポリゴンで国土数値情報の鉄道データを切り出す
2. 事業者名を正規化する（例: 旧泉北高速鉄道 → 南海 泉北線）
3. 駅の線データから代表点を求める
4. 駅別乗降客数を結合する
5. 線路のグラフから隣接駅と駅間距離を求め、乗換候補を結ぶ
6. 路線・駅を GeoJSON、ネットワークを JSON で `packages/geo/data/` に書き出す

徒歩経路と到達範囲は、`pnpm data:build` とは別のコマンドで事前に計算する。

1. `pnpm data:osm` で Geofabrik の関西抽出を `packages/data/.cache/valhalla/` に取得する
2. `infra/valhalla/compose.yaml` で Valhalla を起動する
3. `pnpm data:walk` で乗換の徒歩経路と到達範囲を求め、`packages/geo/data/` に書く

公開環境では Valhalla を動かさず、書き出した結果を読むだけにする。手順は `infra/valhalla/README.md` を正とする。

画面は GeoJSON を静的に読み込んで配信する。PMTiles は tippecanoe が開発環境に無いため作らない。手順の詳細は `packages/data/README.md` を正とする。

## 3. 判断の流れ

```
入力（観測の列、現在地、行き先、制約、言語）
  │
  ├─ 1. interpret_observation（Haiku）
  │     写真・文章 → Observation（事象種別の候補、区間、文言、時刻、見込み時刻の記載有無）
  │
  ├─ 2. 判断ループ（Opus、最大 N 回のツール呼び出し）
  │     lookup_knowledge → 該当事象の段階と兆候を得る
  │     （大雨・強風なら）get_weather → 雨量推移・警報
  │     estimate_phase_and_remaining → 段階と残り時間
  │     find_alternatives → 代替手段と到着時刻
  │     compute_break_even → 分岐点
  │
  └─ 3. emit_judgment
        Judgment を Zod で検証。失敗したら修正を求めて再生成（1回まで）
```

各ステップで判断イベントを SSE で送り、画面はそれを逐次描画する。推論の過程が見えることは、デモと信頼性の両方にとって中核の価値である。

## 4. 主要スキーマ（packages/schema）

YAML のキーは雛形どおり snake_case で書く。API とイベントの項目は camelCase で書く。型はスキーマから `z.infer` で導出し、同じ形を別に定義しない。時刻はオフセット付きの ISO 8601 で表す。

### 4.1 Knowledge（知見ナレッジ）

書式は `knowledge/README.md` と `knowledge/_template.yaml` を正とする。

- 文言は `ja` を必須とし、`en` は省略できる
- 所要時間の `p50` と `p80` は必須で、0 以上の整数とする。`p80` は `p50` 以上にする
- ファイルごとに次を検査する
  - 段階の id が重複しない
  - 兆候の id がファイル全体で重複しない
  - `exit_signals` は同じファイルで定義した兆候の id を指す
  - `id` は拡張子を除いたファイル名と一致する

任意項目 `predictability` で、見込みの立てやすさを書ける。無ければ省いてよい。

| キー | 内容 |
|---|---|
| `level` | `high`、`medium`、`low` のいずれか。必須 |
| `basis` | 見込みを立てやすい理由。外から観察できる言葉で書く。必須 |
| `typical_floor_minutes` | これより早く再開することはまれ、という目安の分。任意 |

`packages/core` の `describeTypicalFlow` が、この項目を読んで「よくある流れ」を返す。
返す型は `TypicalFlowSchema` で、キーは camelCase である。

- 段階の列は、各段階の名前と所要時間の p50 と p80 を持つ
- 発生から再開までの見込みは、残り時間の計算を経過 0 分で呼んで出す。下限があれば当てる
- この見込みは初列車待ちを含まない。初列車待ちは別の項目で返す
- 知見に `predictability` が無ければ、再開までの p80 と p50 の比から推し量る
- 比の閾値は `packages/core/params/estimation.ts` に置く
- 書かれた値か推し量った値かを `source` で区別する

### 4.2 Observation（利用者が持ち込んだ観測）

`kind` と `rawText` だけが省略できる。null を許す項目も、キーは省略せずに null を入れる。

| フィールド | 内容 |
|---|---|
| `id` | 観測の ID。空でない文字列 |
| `observedAt` | 観測時刻 |
| `source` | `photo` / `text` / `selection` / `scenario` |
| `kind` | 観測の種類。知見の `observable_from` と同じ 5 値をとる |
| `rawText` | 読み取った原文。写真では OCR 結果を入れる |
| `eventTypeCandidates` | 事象種別 `eventType` と確信度 `confidence` の配列。確信度は `low` / `medium` / `high` |
| `operator`, `line` | 事業者と路線。不明なら null |
| `section` | 区間 `{ fromStation, toStation }`。不明なら null |
| `statedResumeTime` | 発表文に記載された再開見込み時刻。記載が無ければ null |
| `transferServiceActive` | 振替輸送の実施有無。記載が無ければ null |
| `detectedSignals` | 兆候との対応 `{ eventType, signalId, quote }` の配列。`quote` は根拠の文言 |

### 4.3 JudgmentEvent（SSE で送るイベント）

全イベントは `type` に加えて、連番 `seq` と時刻 `at` を持つ。

| type | 内容 | 画面での表示 |
|---|---|---|
| `observation_parsed` | `{ observation: Observation }` | 「掲示を読み取りました」 |
| `signal_detected` | `{ signal: DetectedSignal }` | 根拠リストに追加 |
| `weather_checked` | `{ source, readings, warnings, trend, summary }` | 雨量の推移と警報を出す。readings は 36 件・6 時間まで |
| `phase_estimated` | `{ estimate: Estimate }` | タイムラインの「いまここ」を更新 |
| `alternatives_computed` | `{ options: RouteOption[] }` | 地図に経路と到達範囲を描画 |
| `break_even_computed` | `{ breakEven: BreakEven \| null }` | 分岐点の表示を更新 |
| `judgment_ready` | `{ judgment: Judgment }` | 結論を確定表示 |
| `error` | `{ message: string, retryable: boolean }` | 再試行の案内 |
| `progress` | `{ message: string, stage?: ProgressStage }` | 推論の過程の該当する段に一文を出す |

`progress` は判断の途中経過である。両モードで各段階の開始を知らせ、claude モードでは Claude の text ブロックと進捗メモも流す。進捗メモは `thinking.display: "updates"` で得る。

- `stage` は `interpret` / `knowledge` / `weather` / `phase` / `alternatives` / `break_even` / `judgment` のいずれか
- Claude の進捗メモは `stage` を持たない。画面は進行中の段に付ける
- 画面は知らない種類のイベントを読み飛ばす

### 4.4 Judgment（判断結果）

| フィールド | 内容 |
|---|---|
| `action` | `wait` / `switch` / `hold`（判断保留、分岐点のみ提示） |
| `headline` | 結論の一文（利用者の言語） |
| `reason` | 結論の理由。1〜2 文で、省略できる |
| `breakEven` | 分岐点の時刻 `time` と意味の説明 `explanation`。null を許す |
| `estimate` | Estimate。項目は下表に示す |
| `options` | RouteOption の配列。`id` を重複させない |
| `recommendedOptionId` | 推奨する代替手段の `id`。null を許すが、`action` が `switch` なら必須 |
| `evidence` | `{ kind, id, description }` の配列。`kind` は `signal` / `knowledge` / `weather` / `computation` |
| `disclaimer` | 推定である旨（必須） |
| `typicalFlow` | 事象のよくある流れ。`TypicalFlowSchema` の形で、省略できる。agent が知見から詰め、原因が分からなければ入れない |

`recommendedOptionId` は `options` にある `id` を指す。参照と重複は `checkJudgmentRefs` で検査する。スキーマに refine を付けないのは、Claude のツール定義に変換するためである。

Estimate の項目は次のとおり。

| フィールド | 内容 |
|---|---|
| `eventType` | 事象種別。特定できなければ null とし、分岐点だけで判断を返す |
| `phaseId` | 段階の id。null を許す |
| `elapsedMinutes` | 段階の経過分。null を許す |
| `remaining` | 実際に乗れる列車が来るまでの残り時間 `{ p50, p80 }`。after_resume を含み、null を許す |
| `confidence` | `low` / `medium` / `high` |

RouteOption の項目は次のとおり。

| フィールド | 内容 |
|---|---|
| `id` | 代替手段の id |
| `kind` | `wait` / `transfer` / `taxi` / `walk` |
| `label` | 表示名 |
| `legs` | RouteLeg の配列 |
| `arrivalTime` | 到着時刻 |
| `fareYen` | 運賃の円。null を許す |
| `walkMinutes` | 徒歩の分 |
| `isTransferService` | 振替輸送を使うか |

RouteLeg は `mode`、`from`、`to`、`minutes` を持ち、`line` は省略できる。`mode` は `walk` / `ride` / `wait` / `taxi` のいずれかである。

### 4.5 Scenario（リプレイ用シナリオ）

書式は `scenarios/_template.yaml` を正とする。

- 任意の `weather.readings` を足せる。大雨のリプレイで `get_weather` が返す観測値である
- `weather.readings` の各要素は `offset_minutes`、`rainfall_10min_mm`、`warnings` を持つ
- `expectations` の各要素は、`action`・`phase`・`evidence_includes`・`break_even_shown` の少なくとも一つを持つ
- `user.constraints.deadline` は `HH:MM` で書く。`resolveDeadline` が `start_time` 以降の日本時間に変換する
- ファイルごとに次を検査する
  - timeline の id が重複しない
  - timeline の `offset_minutes` が昇順に並ぶ。同じ値は許す
  - `weather.readings` の `offset_minutes` が狭義の昇順に並ぶ
  - `expectations.after` は timeline の id を指す
- 知見との参照を次のとおり検査する
  - `event_type` は知見の id を指す
  - `expectations.phase` はその知見の段階を指す
  - `expectations.evidence_includes` はその知見の兆候を指す

### 4.6 RawInput（未解釈の入力）

利用者が持ち込んだ未解釈の入力。`type` で 4 種に分かれる。

| type | 項目 |
|---|---|
| `photo` | `imageBase64` と `mediaType`。形式は JPEG・PNG・WebP・GIF |
| `text` | 貼り付けた文章 `text` |
| `selection` | 選んだ事象種別 `eventType` と兆候の `signalIds` |
| `scenario` | `scenarioId`、`observationId`、`kind`、`text` |

`scenario` 型はリプレイで timeline の 1 件を流し込む。`scenarioId` は `weather.readings` を引くシナリオを特定する。

### 4.7 JudgeRequest（判断の依頼）

`POST /judge` の入力。

| フィールド | 内容 |
|---|---|
| `observations` | 解釈済みの Observation の配列。画面が前回までの結果を返送する |
| `newInput` | 今回持ち込まれた RawInput。無ければ null |
| `origin`, `destination` | 現在地と行き先の Place |
| `constraints` | `deadline`、`knowsAlternatives`、`mobilityNotes`。`deadline` と `mobilityNotes` は null を許す |
| `language` | `ja` / `en` |
| `now` | 判断の基準時刻。リプレイではシナリオ時刻を入れる |

### 4.8 Place（地点）

M0 では駅名 `{ kind: "station", name }` と座標 `{ kind: "coord", lon, lat }` の 2 種とする。地名による指定は、ジオコーダを調査してから決める。

## 5. ツール仕様（apps/agent/src/tools）

| ツール | 入力 | 出力 | 実装 |
|---|---|---|---|
| `lookup_knowledge` | 事象種別 | 段階、兆候、所要時間の目安、利用者への提示方針 | YAML 読み込み |
| `get_weather` | 区間の座標、時間幅 | 10分ごとの雨量、警報の発表状況 | 気象庁 |
| `estimate_phase_and_remaining` | 事象種別、観測の列 | 段階 ID、段階の経過時間、残り時間分布、よくある流れと流れの一文 | packages/core |
| `find_alternatives` | 現在地、行き先、止まっている区間、時刻、制約 | 代替手段の一覧（徒歩・乗車・待ち・運賃） | packages/geo + core |
| `compute_break_even` | 待つ場合の条件、代替手段の到着時刻 | 分岐点の時刻 | packages/core |

## 6. 時刻表データがないことへの対応

関西にはオープンな時刻表データがない。代替手段の乗車時間は次の方法で概算する。

- 乗車時間 = 路線上の駅間距離 ÷ 路線種別ごとの表定速度（自作パラメータ）
- 待ち時間 = 路線・時間帯ごとの運転間隔の半分（自作パラメータ）
- パラメータは `packages/core/params/` に置き、出典は「開発者の推定」と明記する

概算であることを画面に示す。精度より、待つ場合と切り替える場合の比較が正しい向きになることを優先する。

## 7. 検証

このプロジェクトには、統計的な評価に使えるほどの正解データはない（復旧時間の過去データは存在せず、シナリオは架空）。検証は次の3層で行う。知見とシナリオの書式は 7.4 で検査する。

### 7.1 計算の単体テスト（packages/core）

分岐点、到着時刻、運賃、残り時間の推定は、入力に対して答えが一つに決まる。Vitest で網羅的にテストする。

### 7.2 シナリオの振る舞いテスト（Playwright）

各シナリオの `expectations` に、開発者が期待する振る舞いを数か所だけ書く。

- ある観測の後で、結論が特定の行動（待つ／切り替える／保留）になっていること
- 根拠に特定の兆候が挙がっていること
- 分岐点が表示されている／されていないこと

点数を出すためのものではなく、プロンプト・ツール・判断ロジックを変えたときに振る舞いが壊れていないかを確かめる回帰テストとして使う。エージェントの出力は揺れるため、検証は行動の種類と根拠の兆候 ID のような構造化された項目で行い、文面では比較しない。

e2e は外部のタイルとフォントを取りに行かない。

- 画面の外部要求は `e2e/support/test.ts` の共通 fixture が受ける。地図のタイルは `e2e/fixtures/tiles` の淡い格子で返す
- web サーバーの Google Fonts は `NEXT_FONT_GOOGLE_MOCKED_RESPONSES` で空の応答に差し替える
- `E2E_REAL_TILES=1` で本物に戻す。録画の `pnpm --filter e2e record` は常に本物を使う
- 地図の準備は下地のタイルを待たない。スタイルと自前のレイヤーが描け、視点が止まった時点とする

### 7.3 開発者による確認

判断が現場の感覚に合っているかは、最終的に開発者が画面を見て確認する。気になった点は `docs/progress.md` に記録し、知見ナレッジまたはシナリオの期待値に反映する。

### 7.4 YAML の内容検証

`pnpm validate` は `knowledge/` と `scenarios/` の YAML を検証する。エラーが 1 件でもあれば exit 1 で終わる。

- 対象は直下の `.yaml` とし、`_` で始まるファイルは除く
- 拡張子 `.yml` はエラーとする
- YAML 1.2 として読み、構文エラーと重複キーをエラーとする
- 値に `TODO` が残っていればエラーとする
- スキーマと 4.1・4.5 の検査を行い、エラーを行番号付きで示す
- 知見の id とシナリオの id は、それぞれ複数のファイルで重複させない

雛形の整合も同じコマンドで検査する。2 つの `_template.yaml` のキー構造をスキーマと突き合わせ、値は見ない。スキーマに無いキーと、雛形に無い必須キーをエラーとする。`pnpm guard` もこの検証を実行する。

## 8. セキュリティとプライバシー

- API キーはエージェント側の環境変数のみ。画面には渡さない
- 現在地・入力内容は判断に使うのみで保存しない。ログにも残さない
- 画像のサイズ・枚数、リクエスト頻度に上限を設ける
- 利用者の入力をシステムプロンプトに混ぜない。観測データとして明示的に区別して渡す
