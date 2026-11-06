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
- 吹き出しの駅: 歩ける駅は、代替手段の探索と同じ関数と上限で選ぶ。詳細は 2.5 を正とする
- 判断の受信: SSE。イベントごとに画面の該当部分を更新する
- 多言語: 日本語・英語（next-intl）。エージェント出力も利用者の言語で返す
- リプレイモード: `scenarios/` のシナリオを時刻順に入力として流し、判断の変化を再生する
- 分岐点の時間軸: 分岐点と再開見込みの関係を横 1 本の軸で示す。観測が進むと帯と目盛りが動く

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
  - 原因が分からなくても、発表された再開見込みの時刻があれば保留しない。その時刻を見込みとして分岐点と比べ、待つか切り替えるかを返す
  - このときの見込みは core の `estimateStatedRemainingWithoutKnowledge` で求める。p50 は発表の時刻どおり、p80 は `STATED_RESUME_SLACK_MINUTES` だけ後ろに置く
  - 確信度は `confidenceParams.whenStatedWithoutEvent` にする。結論の理由は、発表の時刻をもとにした推定だと分かる言い方にする
  - 発表の時刻が無いときの振る舞いは変えない。claude モードもプロンプトで同じ方針にする
  - 知見の無い原因でも、要求の `cause` に入口で答えた原因があれば、core の `estimateStatsRemaining` で統計値から見込みを出す。`remainingBasis` は `statistics` にする
  - 統計値の見込みは確信度を low のままにする。事象は決め打ちせず、原因が分からないときと同じ規則で保留か切り替えを選ぶ
  - 統計値から見積もったことは文に書かない。再開までの時間も文で言い切らない。見込みは見込みの図の幅で示す
  - 見込みの出どころは `estimate.source` に持つ。知見は `knowledge`、統計値は `statistics`、どちらも無ければ `none` にする
  - 発表の時刻があれば、統計値より発表の時刻を使う。出どころは原因の見込みの元を指すので `statistics` のままにする
  - 発表の時刻ちょうどとその後は、知見の原因と同じく原因の見込みに戻す。発表の時刻と延長の有無は結果に残す
  - 計算に使う事象は、観測と入口の原因からコードが決める。claude モードで Claude の指定が違っても、コードの事象を使い、結果の `note` で知らせる
  - claude モードには `<request>` の `cause` で原因を渡す。数値はツールが返し、Claude には計算させない
  - 見込みが立てやすく、再開までの p80 が core の `SHORT_FLOW_MAX_MINUTES` 以内の事象は「短く終わる」とみなす。確信度が低くても保留せず、比較で決める
  - 見込みが立てやすい事象は、発生直後から言い切る。知見から見積もった再開の見込みが分岐点より後なら、時間の窓を待たずに切り替える
  - 発表された見込み時刻があるときは、発表の時刻で比べる。知見の下限は当てない
  - 見込みが立てやすく、原因が観測から特定できたときは、確信度を `confidenceParams.floorWhenPredictable` より下げない
  - 見込みが立てやすい事象で、知見から見積もっているときは、理由の頭に流れの一文を置く。claude モードもプロンプトで同じ方針にする
  - 理由の最後に、比較した分岐点までに再開する確率を添える。例は「分岐点の23時23分までに再開する見込みは3割です。」
  - 閉じたカードは先頭の 1 文を要約に出す。シートを開くと残りの文を読める。要約を詳細に重ねない。全文の上限を超えるなら、流れの一文、確率の一文の順に外す
  - 代替手段が無いとき、期限が理由でタクシーを勧めるときは、期限に間に合う再開時刻とその確率か、目盛りの確率を使う
  - 再開見込みの大半が分岐点より後か、早着の比較がある延長後の判断では、分岐点後の遅めの再開確率を述べる。claude モードも同じ時点と文型を使う
  - 期限が理由でタクシーを勧めるときの分岐点の説明は、「8時10分までに再開すれば8時55分着のタクシーに切り替えず期限に間に合います」の形にする
  - 理由も、タクシーのほうが早く着くではなく、待っては期限に間に合わないと書く
  - claude モードは、`compute_break_even` の `labels.resumeChance` の表示をそのまま写す。自分で計算した確率は数値の検査で弾く
  - 利用者が駅と駅の間の車内にいるときは、`trainPosition` を受けて次の駅に着いてからの行動で結論を書く
  - 出発地は次の駅とし、代替手段はホームに着ける駅に着く見込みの時刻から探す。分岐点もその前提で出す
  - 乗ったまま待つ側の到着には、前の列車が先に発車するぶんの遅れを足す。待つ側だけが楽観的にならないようにするためである
  - 結論は「{駅}に着いたら降りて{路線}に乗り換える」か「{駅}に着いてもそのまま乗る」の形にする。「あと N 分待って」は使わない
  - 理由の頭に、その駅に着く見込みの一文を置く。前の列車の本数か種別の事情を添える
  - 駅にいる人と、駅に止まっている車内の人の判断は変えない。claude モードもプロンプトで同じ方針にする
- 勧める代替手段は、core の `selectBestAlternative` が決める
  - 決定論モードは、分岐点の結果の `bestAlternativeId` を切り替えの推奨にする
  - claude モードも同じ方針をプロンプトに書く。切り替えの推奨が違えば検証エラーにして、一度だけ直させる
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
- `estimateStatedRemaining`: 発表された見込み時刻までの分に、知見の初列車待ちを足す
- `estimateStatedRemainingWithoutKnowledge`: 事象が分からないときに、発表された見込み時刻だけから残り時間を返す
  - p50 は発表の時刻までの分とする。p80 はそれに `STATED_RESUME_SLACK_MINUTES` を足す
  - 余地の根拠は `packages/core/params/estimation.ts` のコメントに書く
- `estimateStatsRemaining`: 知見の無い原因の見込みを、集めた事例の統計値から返す
  - 統計値は `packages/core/params/incident-durations.ts` にある。生成元は `docs/research/rail-suspensions/build_incident_durations.py` である
  - `resolveIncidentDuration` が使う値を決める。種類の値が `sufficient` なら種類、`use_group` か null なら大分類の値を使う
  - 大分類が `insufficient` か統計値に無ければ null を返す。agent は知見なしの流れのままにする
  - 止まった時刻が平日の通勤時間帯なら `byPeriod.commute`、そうでなければ `byPeriod.other` の値を使う
  - `use_mixed` の区分は、p50 と p80 にまぜた値が入っているので、そのまま使う
  - 時間帯の境は `packages/core/params/estimation.ts` の `COMMUTE_HOUR_RANGES` に置く。統計値のファイルは境を定数で持たない。生成元の `COMMUTE_HOURS` との一致を単体テストで確かめる
  - 所要時間の p50 と p80 から対数正規分布を当て、発生からの経過を超えた条件付きの残りを標本にする。知見の段階の残りと同じ `sampleRemainingDuration` を使う
  - 統計値は報道に残った事例なので長引いたものに偏る。初列車待ちは含めない
- `describeTypicalFlow`: 知見から、よくある流れと見込みの立てやすさを返す。詳細は 4.1 に書く
- `computeResumeChance`: 残り時間の推定と同じ標本から、時刻ごとの再開の見込みと、待ったほうが早く着く確率を 1 割単位で返す。詳細は 4.9 に書く
- `sampleRemaining` と `sampleDurationDist`: 推定に使う標本を取り出す。推定の p50・p80 はこの標本の分位点である
- `selectKeyTick`: 要点の 1 文に使う目盛りを選ぶ。5 割に達する最初の目盛りで、無ければ最後の目盛り
- `computeArrival`: 経路（徒歩・乗車・待ち）から到着時刻を返す
- `chooseBestAlternative` と `selectBestAlternative`: 勧める代替手段を選ぶ。この決まりは core のここ 1 か所に置き、ほかでは選び直さない
  - 鉄道の代替のうち、到着がいちばん早いものを勧める。鉄道の代替とは、タクシー以外の代替を指す。乗り継ぎと、近距離の全区間徒歩を含む
  - タクシーを勧めるのは、鉄道の代替が無いときと、鉄道の代替では期限に間に合わずタクシーなら間に合うときだけである
  - タクシーは勧めないときも、選択肢として運賃と一緒に出し続ける
  - `chooseBestAlternative` は、勧める代替手段と選んだ理由を返す。理由は `fastest_rail`、鉄道の代替が無い `no_rail`、期限に間に合うのがタクシーだけの `rail_misses_deadline` の 3 つである
  - `selectBestAlternative` は、そのうち勧める代替手段だけを返す
  - agent の分岐点の計算と、画面のリプレイの結末が、この関数を呼ぶ
- `computeBreakEven`: 待つ場合と、勧める代替手段の到着時刻を比べ、分岐点の時刻を返す。期限を渡すと、勧める代替手段の選び方に使う。分岐点の time は運転再開の期限である
  - 期限が理由でタクシーを勧めるときは、分岐点をタクシーの到着ではなく期限から求める。待っても期限に間に合う最後の再開の時刻になり、結果は `deadlineBasis` に期限を持つ
  - この場面で利用者が知りたいのは、タクシーより早いかではなく、待っても期限に間に合うかだからである
  - 鉄道の代替が無く、タクシーしか無いときは、期限があっても、これまでどおりタクシーの到着と並ぶ時刻を分岐点にする
- `computeTaxiFare`: 距離と時刻から公示運賃体系にもとづく概算運賃を返す
- `estimateTrainQueueArrival`: 駅間に止まった列車が、ホームに着ける駅に着く時刻の p50 と p80 を返す
  - 入力は、再開までの残り、自分の種別、前の列車の種別の並び、先の駅と駅間の走行時間、事業者ごとの詰める動きである
  - 詰める事業者は、まず JR西日本だけにする。事業者は乗っている路線の ID の先頭から先に引き、引けなければ観測の事業者名の表記の揺れをそろえて引く。詰め始めるのは線路の安全が確かめられてからで、外からは再開に向けた放送か、再開の見込みの時刻が出たことで分かる。agent の `checkTrackCleared` は、再開の見込みの時刻か、「まもなく運転を再開」「順次運転を再開」のように再開が近いと言い切る放送を見たときだけ `closeUpCleared` を true にする。「点検が終わり次第」のような条件付きの文と、知見の段階が進んだことだけでは数えないそれまでは詰めず、再開を待ってから着くとみなす
  - 詰める事業者では、前の列車を遠いほうから順に前の駅へ入れる。各列車はその種別が着けるホームのある駅にしか入れず、順番を追い越せない
  - 駅の間では、信号機と信号機の間に 1 本ずつ列車が詰まる。前の列車 1 本が 1 つの信号の区間を空けるまでを、経験からの目安で中央 4 分、長め 5 分とする
  - 利用者が押した並びは、目の前に詰まっている列車とみなす。運転パターンから推し量った並びは、ふだんの間隔をあけて先を走っていたとみなし、間隔の分を駅間の走行時間で何駅先かに直す
  - すぐ前の列車が駅に入れなければ、自分の列車も再開のあとに着く。自分の種別が次の駅に止まれなければ、降りられる駅はその先になる
  - 遅れる理由を `delays` で返す。`platform_occupied` はその駅のホームに前の列車が止まっている、`ahead_cannot_stop` は前の列車の種別がその駅に止まれず手前で動けない、`own_cannot_stop` は自分の種別がその駅に止まれない
  - 前の列車が先に発車するぶんの遅れを `departureDelayMinutes` で返す。行く手の列車 1 本ごとに線路を空けるまでの中央の分を数え、乗ったまま待つ側の到着にも足す。着く時刻の p80 には長めの分を使う
  - 自分の列車が動き出す時刻を `departure` で返す。着く時刻から、その駅までの走行時間を引いたものである
- `selectAfterAlightStep`: 駅間の車内の人が次の駅に着いた後の一手を選ぶ。次の駅に着く見込みの時刻から探した代替手段を比べるだけで、時刻は作らない
  - 行き先が次の駅のとき、乗ったままで行き先に着けるとき、乗ったままのほうが早いときは選ばない
  - 止まっている路線に乗る経路は数えない。鉄道と徒歩の手段が無いときだけタクシーを選ぶ
- `resolveStopKind`: 知見の事象か入口の原因の種類から、種類ごとの止まり方を引く。その列車だけが止まる `train_only`、その列車から止まる `train_first`、区間が止まる `section` の 3 つである。表は `stop-scope.ts` の 1 か所に置き、分からない種類は `section` にする
- `resolveStopScope`: 画面と判断で使う止まり方を決める。`train_only` は `train`、`train_first` は発表に区間が出るまで `train`、ほかは `section` にする。画面と判断が同じ表を引く
- `resolveObservedStopScope`: 観測と入口の原因から止まり方を決める。事象は `selectObservedEventType` が、知見のある候補だけを確信度で重みづけして選ぶ。画面と判断が同じこの関数を呼ぶ
  - 種別が分からない列車は普通として扱う。並びが分からなければ本数の目安を目の前の普通として置く
- `inferTrainsAheadFromPattern`: 路線と方面の運転パターンから、自分の種別の前を走る列車を近い順に 3 本並べる。複々線では同じ線路の列車だけを数える
- 詰める動きの値、駅ごとの着けるホームの表、運転パターンの表は `packages/core/params/train-queue.ts` に置く。詰める事業者と信号の区間を空ける分は開発者の答えで決めた。着けるホームの表と運転パターンは仮の値で、デモで使う JR神戸線と JR京都線の大阪付近だけを入れる

### 2.5 packages/geo

- 路線・駅・事業者（国土数値情報から整形）
- 乗換の徒歩時間は、Valhalla の経路を事前に計算して求める
- 経路が大回りになる組と、データが無い組は、直線距離の 1.3 倍を分速 80m で割る概算に戻す。計算は packages/core の walk が担い、パラメータは `packages/core/params/walk.ts` に置く
- 徒歩10分・20分の到達範囲は、乗降客数の上位 300 か所が事前計算の結果である。それ以外の駅は概算の円で描く
- 路線上の距離からの乗車時間の概算（関西にはオープンな時刻表データがないため。後述）

経路探索は packages/geo の routing が担う。ネットワーク上のダイクストラで探し、止まっている区間の辺を除く。前の候補の主な路線を除いて探し直し、多様な候補を最大 3 本返す。

歩いて乗りに行ける駅は、packages/geo の `listWalkAccessStations` が選ぶ。地図の吹き出しと代替手段の探索が、この同じ関数を呼ぶ。

- 現在地の駅と同じ駅の路線違いと、止まっている路線の駅は含めない
- 徒歩の分は、乗換の辺が路線データにあればその分、無ければ core の概算を使う
- 乗換の辺は、直線 300m 以内か、名前が関連する 1km 以内の駅にしか無い。探索はこの辺に加えて、現在地の駅から上の駅へ歩く辺を足して探す
- 徒歩の上限は `packages/core/params/routing.ts` に置く。通常は `ACCESS_WALK_MAX_MINUTES` の 15 分である
- 通常の上限の中に鉄道の代替が 1 つも無いときだけ、`ACCESS_WALK_MAX_MINUTES_EXTENDED` の 25 分に広げて探し直す
- どちらの値も開発者が確かめた値である
- 地図に出す駅は、探索が候補にする駅の中から選ぶ。探索の候補にしない駅は地図にも出さない

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
| `judgment_ready` | `{ judgment: Judgment }` | 結論を確定表示。近くのバス停の確認候補は判断の確定後に決定論で `busChecks` に付け、Claude には渡さない |
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
| `breakEven` | 分岐点の時刻 `time` と意味の説明 `explanation`。任意で時刻ごとの再開の見込み `resumeChance` を持つ。null を許す |
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
| `source` | 見込みの出どころ。`knowledge` / `statistics` / `none`。以前の記録との互換のため省略できる。画面は前提の言い方を選ぶのに使い、出どころの説明は出さない |

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
| `trainPosition` | 車内の位置。任意で、無ければ駅にいるとみなす |
| `cause` | 入口で答えた原因。統計値の大分類の `group` と種類の `type` を持ち、`type` は null を許す。任意で、分からないときとリプレイでは省く。知見の無い原因の見込みに使う |

`trainPosition` の項目は次のとおり。駅間のときだけ、次の駅以降の項目に値を入れる。

| フィールド | 内容 |
|---|---|
| `kind` | `at_station` / `on_train_at_station` / `between_stations` |
| `nextStation` | 次に着く駅。駅間でなければ null |
| `previousStation` | 来た側の駅。先の駅と走行時間を路線から引くのに使う。null を許す |
| `trainsAhead` | 前に止まっている列車の種別を近い順に並べた配列。空なら前に列車はいない。分からなければ null |
| `trainsAheadCount` | 並びが分からないときの本数の目安。`none` / `few` / `many` / `unknown`。並びがあれば null |
| `ownTrainType` | 乗っている列車の種別。`local` / `rapid` / `special_rapid` / `limited_express` / `unknown`。null を許す |
| `trainsAheadHeadwayMinutes` | 並びを運転パターンから推し量ったときの、同じ線路の運転間隔の分。任意。値があれば前の列車はこの間隔で先を走っていたとみなし、無ければ目の前に詰まっているとみなす |

画面は駅間を選んだ人に問いを重ねず、既定値で判断を出す。既定値は `apps/web/src/features/entry/train-position-defaults.ts` に置く。

- 次の駅は、選んだ駅から方面の向きに 1 つ先の駅
- 自分の種別は、路線と方面の運転パターンでいちばん多い種別。パターンが無ければ普通
- 前の列車は、運転パターンから推し量った並び。パターンが無ければ「分からない」とし、本数の目安を `unknown` にする
- 判断の画面のチップで直すと、出発の駅を次の駅に置き直し、同じ観測で判断を出し直す

### 4.8 Place（地点）

M0 では駅名 `{ kind: "station", name }` と座標 `{ kind: "coord", lon, lat }` の 2 種とする。地名による指定は、ジオコーダを調査してから決める。

### 4.9 ResumeChance（時刻ごとの再開の見込み）

`BreakEven` の任意項目 `resumeChance`。`packages/core` の `computeResumeChance` が、残り時間の推定と同じ標本から求める。
agent は `compute_break_even` で詰め、`break_even_computed` と `judgment_ready` に載せる。残り時間の見込みが無ければ付けない。

| フィールド | 内容 |
|---|---|
| `stepMinutes` | 目盛りの刻み。10・15・30・60 分から、目盛りが 6 個以内に収まる最小のものを選ぶ |
| `ticks` | 4〜6 個の目盛り。時刻 `time`、その時刻までに動いている確率 `tenths`、発生からの分 `sinceOnsetMinutes` を持つ |
| `waitFaster` | 待ったほうが早く着く確率。代替手段が無ければ null |
| `waitOnTime` | 待って期限に間に合う確率。期限か経路が無ければ null |
| `resumeByForDeadline` | 期限に間に合うために動いていなければならない時刻。期限から乗車時間と初列車待ちを引く |
| `onsetTime` | 発生とみなした時刻。最初の観測の時刻 |

確率の定義は次のとおり。標本 s は再開して乗れるまでの残りの分で、初列車待ちを含む。

- 待った場合の到着は T_wait = now + s + 再開後の乗車時間 とする
- 代替手段の到着 T_alt は `find_alternatives` が返した決まった値として扱う。ばらつきは持たせない
- `waitFaster` は P(T_wait ≤ T_alt) とする。同着は待つ側に数える。乗り換えの手間が無いぶん待つほうが楽なためである
- T_alt は、勧める代替手段の到着である。タクシーのほうが早く着く場合でも、鉄道の代替を勧めるなら鉄道の代替の到着を使う
- 分岐点は T_alt から乗車時間と初列車待ちの p50 を引いた時刻である。この確率は P(s ≤ 分岐点までの分 + 初列車待ち) と同じ値になり、分岐点と食い違わない
- 期限が理由でタクシーを勧めるときは、分岐点が期限から求めた時刻で、`resumeByForDeadline` と同じになる。このとき `waitFaster` は null とし、`waitOnTime` で示す。タクシーと比べた確率は、分岐点と食い違うためである
- `waitOnTime` は P(T_wait ≤ 期限) とする。同時刻は間に合うとみなし、`checkDeadline` と同じにする
- 目盛りの確率は、乗れる時刻から初列車待ちの p50 を引いた再開の時刻が、目盛り以前である確率とする。再開見込みの幅と同じ近似で、p50 の目盛りはおよそ 5 割になる

目盛りと丸めの決め方は次のとおり。

- 目盛りは、いまより後の切りのよい時刻から始め、9 割の標本が動いている時刻まで覆う。分岐点がその 60 分以内なら分岐点まで延ばす
- 4 個に満たなければ延ばす。60 分刻みでも 6 個を超えるなら 6 個で打ち切る
- 確率は 1 割単位に丸める。0.05 未満は 0 で「1 割未満」、0.95 以上は 10 で「9 割以上」とし、0 割と 10 割は出さない
- 分岐する知見では、p50 までは最短の経路の標本に、p80 からは最長の経路の標本に従い、あいだは直線でつなぐ。推定の p50・p80 と一致する
- 発生時刻は観測から分からないので、最初の観測の時刻を発生とみなす。画面は入口で止まってからの時間を答えたときだけ「発生から」を出す
- 待つか切り替えるかの規則は確率を使わず、これまでどおりである

## 5. ツール仕様（apps/agent/src/tools）

| ツール | 入力 | 出力 | 実装 |
|---|---|---|---|
| `lookup_knowledge` | 事象種別 | 段階、兆候、所要時間の目安、利用者への提示方針 | YAML 読み込み |
| `get_weather` | 区間の座標、時間幅 | 10分ごとの雨量、警報の発表状況 | 気象庁 |
| `estimate_phase_and_remaining` | 事象種別、観測の列 | 段階 ID、段階の経過時間、残り時間分布、よくある流れと流れの一文。事象が null でも発表の見込み時刻があれば残り時間を返す。駅間の車内なら、ホームに着ける駅とそこに着く時刻、動き出す時刻、遅れる理由を `trainQueue` で返す。止まり方を `stopScope` で返す | packages/core |
| `find_alternatives` | 現在地、行き先、止まっている区間、時刻、制約 | 代替手段の一覧（徒歩・乗車・待ち・運賃）。駅間の車内なら、次の駅に着く見込みの時刻から探す。その結果はいまの選択肢として示さず、着いた後の次の一手を選ぶ比較にだけ使う。通常の徒歩の上限の中に鉄道の代替が無ければ、上限を広げて探す。バス停は返さない | packages/geo + core |
| `compute_break_even` | 待つ場合の条件、代替手段の到着時刻、期限 | 分岐点の時刻、勧める代替手段の id、比較表、時刻ごとの再開の見込みと待ったほうが早く着く確率。駅間の車内でも同じ標本から求める | packages/core |

バス停は駅から約 616m 以内だけを収録する。現在地をそのまま起点にすると、駅から離れたバス停は出ない。

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

## 9. 性能

駅で急ぐ人がスマホで使うので、最初の地図と判断の結論が出るまでの速さを測る。

### 9.1 測り方

- `pnpm build` の生成物を `next start` で動かし、agent は決定論モードで本番と同じく起動する
- Playwright で 390×844 の画面を真似る。CPU は 4 倍遅くし、回線は Fast 3G に絞る
- 絞りは Chrome DevTools Protocol の `Emulation.setCPUThrottlingRate` と `Network.emulateNetworkConditions` で掛ける
- 外部の地図タイルは e2e と同じ固定の画像で返す。毎回新しい文脈で始め、キャッシュは空にする
- 入口は大阪から三ノ宮を選び、原因は聞き取れず、放送の時刻を選んで判断へ進む
- 頁ごとの最初の JS は、ビルドの manifest から頁の読む塊を集めて gzip の大きさを足す

### 9.2 結果

2026-11-06 に 5 回測った中央値。転送量は gzip 後の大きさ。

| 項目 | 直す前 | 直した後 |
|---|---|---|
| 入口の FCP | 2.90 秒 | 2.90 秒 |
| 入口の LCP | 3.97 秒 | 3.96 秒 |
| 入口の地図が操作できるまで | 9.74 秒 | 9.25 秒 |
| 入口で読む JS / CSS / フォント / データ | 589 / 123 / 456 / 144 KB | 同じ |
| 答えてから結論が出るまで | 3.52 秒 | 2.41 秒 |
| 答えてから判断の地図が出るまで | 5.16 秒 | 4.07 秒 |
| 判断画面の長いタスクの合計 | 1.07 秒 | 1.06 秒 |
| 判断画面の操作の INP | 80 ms | 80 ms |
| agent の判断の応答 | 12 ms | 同じ |

ビルドから数えた最初の JS は、入口 289 KB、判断 273 KB、リプレイ 267 KB だった。CSS はどの頁も 122 KB で、うち 102 KB は Noto Sans JP の字形の宣言が占める。

### 9.3 データの置き場所

- 画面が読むのは `network.json` と `lines.geojson` だけで、入口の地図を出すときに後から読む
- `stations.geojson`、`isochrones.geojson`、`bus-stops.geojson` は画面に入れない
- 到達範囲は web のサーバーが索引に載せ、駅ごとに `/api/reach` で返す
- agent は路線網、到達範囲、バス停を起動時に一度だけ読む。起動は約 0.26 秒かかる

### 9.4 直したこと

- MapLibre の読み込みを路線データと並べて始める。前は路線データを読み終えてから読み始めていた
- 様子を聞く段に入ったら判断の画面を JS まで先に読む。答えた後の画面の切り替えを待たせない
- 本番では知見の抜粋を起動中に一度だけ読む。前は頁を開くたびに YAML を読み直していた

### 9.5 残る遅さ

入口は回線の太さで決まる。フォントが入口の転送量の 4 割近くを占める。Noto Sans JP を可変フォントにすると、FCP は 1.8 秒、LCP は 3.0 秒に縮んだ。ただし `font-semibold` の和文が 700 から 600 に細くなるので、見た目の判断が要る。
