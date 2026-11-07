# みちあかり

> Michiakari helps rail passengers in Kansai see the options they have now, and the outlook for each, during service disruptions.
> It turns announcements into an estimated time to resumption, a break-even time, and a concrete action.
> The judgment uses rules drawn from a former train dispatcher's experience, and every number is computed by code, not by Claude.

Built with Claude: Japan 2026 ハッカソンの提出作品です。

## 目次

- [解決する課題](#解決する課題)
- [判断の作り方](#判断の作り方)
- [主な機能](#主な機能)
- [Claude の使い方](#claude-の使い方)
- [Claude Code での開発](#claude-code-での開発)
- [構成](#構成)
- [動かし方](#動かし方)
- [シナリオと非公開の材料](#シナリオと非公開の材料)
- [推定の扱いと運行情報](#推定の扱いと運行情報)
- [データと出典](#データと出典)
- [ライセンス](#ライセンス)

## 解決する課題

電車が止まると、運行情報は「運転見合わせ」とだけ伝えます。
利用者が知りたいのは、いつ動きそうかと、待つべきかです。
切り替えるなら、どこへ歩けば何に乗れるかも知りたいはずです。
終電や約束の時刻に間に合うかも気になります。

指令の内部では、事象の性質と経過から復旧の見込みを立てています。
その判断材料が利用者に届いていません。
みちあかりはこの情報の差を埋めます。

アプリが返すものは次の 3 つです。

| 返すもの | 内容 |
|---|---|
| 見込み | 再開までの残り時間を幅で示します。 |
| 分岐点 | この時刻までに再開しなければ、振替のほうが早く着く境目です。 |
| 行動 | 待つ、切り替える、保留のいずれかと、推奨する経路です。 |

すべての判断に、使った手がかりと規則を根拠として付けます。

## 判断の作り方

判断は、元指令員の経験を落とした規則表と報道の統計値で出します。
知見そのものは公開しない開発の材料で、リポジトリには入れていません。
規則は社内の数値ではなく、外から観察できる兆候で定義しています。

## 主な機能

| 機能 | 内容 |
|---|---|
| 状況の入力 | 掲示の撮影、発表文の貼り付け、選択式の 3 通りで伝えます。 |
| 見込み | 残り時間を中央値と 80% 点の幅で出します。事象の段階は示しません。 |
| 分岐点 | 再開を待つ期限の時刻を示します。待つ場合と代替経路の到着時刻から計算します。 |
| 行動 | 結論の一文と代替経路の一覧を出します。経路ごとに到着時刻と徒歩の分数が付きます。 |
| 実距離の地図 | 国土数値情報の路線を地理院タイルに重ねます。止まっている区間と推奨経路を描きます。 |
| 徒歩の到達範囲 | 徒歩 10 分と 20 分の範囲を地図に描きます。範囲内で動いている別路線の駅も示します。 |
| リプレイ | 架空のシナリオの発表を時刻順に流します。判断と地図が変わる様子を再生します。 |
| 推論過程の表示 | 読み取りから分岐点までの各段を順に表示します。Claude の進捗メモも各段に出します。 |

画面は日本語と英語に対応し、スマートフォンの縦画面を優先しています。

## Claude の使い方

モデル名は `apps/agent/src/config.ts` の 1 か所で管理しています。

| 役割 | モデル | 使い方 |
|---|---|---|
| 観測の解釈 | `claude-haiku-5-5` | 掲示の写真や発表文を読みます。事象の種類、区間、手がかりを構造化した観測にします。 |
| 判断 | `claude-opus-5-5` | 自前のツール実行ループで判断材料を集めます。最後に判断を確定するツールを呼びます。 |

判断ループのツールは次のとおりです。

- `lookup_incident_rules` は事象の止まり方と防護無線の有無を規則表から引きます
- `get_weather` は気象庁アメダスの 10 分間降水量を引きます
- `estimate_remaining` は規則表と統計値から残り時間を見積もります
- `find_alternatives` は止まっている区間を避けた経路を探します
- `compute_break_even` は分岐点を計算します
- `emit_judgment` は判断を確定します

`lookup_incident_rules` と `estimate_remaining` の名前は、agent の作り直しの後に合わせます。要確認です。

設計の要点は次のとおりです。

- 数値はすべて `packages/core` と `packages/geo` のコードが計算します
- Claude は数値を出さず、行動の選択と根拠の説明を担います
- 判断の数値はサーバーがツールの結果から組み立てます
- 文中の時刻、分、円はツールの結果と照合します
- 照合に失敗したら、指摘を返して 1 回まで再生成させます
- システムプロンプトとツール定義は固定し、プロンプトキャッシュを効かせます
- 各ツールの開始と結果を SSE の判断イベントで画面へ流します
- ツール呼び出しの合間の進捗メモも `progress` イベントで流します
- 利用者の入力はシステムプロンプトに混ぜず、観測データとして渡します
- Claude が失敗したら、済んだ手順を残して決定論の規則で仕上げます

ファイル操作やコマンド実行のツールは公開サービスに不要です。
イベントの粒度も細かく制御したいので、ループを自前で書いています。

## Claude Code での開発

開発は Claude Code を中心に進めました。詳しくは [docs/guides/claude-code-usage.html](docs/guides/claude-code-usage.html) にあります。

- `.claude/hooks/protect-paths.mjs` が、`scenarios/` と非公開の材料のフォルダへの書き込みを遮断します。
- `pnpm guard` が、`scenarios/` を承認記録と照合します。材料の文が追跡中のファイルに無いことも確かめます。
- 根のエージェントが計画し、Claude の子エージェントに実装を振ります。別系統の Codex がレビューします。
- 利用者向けの文は `docs/agents/wording.md` の決まりで書き、`docs/agents/wording-audit.md` で監査しました。
- 画面は e2e でスクリーンショットを撮り、目で確かめました。
- コミットは 376 件、e2e は 153 件です。最新の作業記録 `docs/progress.md` から取りました。

## 構成

```
利用者の端末
  apps/web  Next.js / MapLibre GL JS
     │  POST /judge で観測の列と新しい入力を送る
     ▼
  apps/agent  Hono / Anthropic SDK
     │  1. 解釈     Haiku か文字列照合で観測にする
     │  2. 判断     Opus のツール実行ループか決定論の規則
     │  3. 検査     Zod のスキーマと数値の照合
     │
     ├─ packages/core    残り時間、到着時刻、分岐点、運賃、徒歩時間
     ├─ packages/geo     路線・駅のネットワークと経路探索
     └─ scenarios/ の YAML
     │
     └─ SSE で判断イベントを返す ──▶ apps/web が逐次描画する

前処理
  国土数値情報 ──packages/data──▶ packages/geo/data の GeoJSON と JSON
```

| ディレクトリ | 役割 |
|---|---|
| `apps/web` | 開始、状況の入力、判断、リプレイ、このアプリについての画面です。 |
| `apps/agent` | 判断エージェントです。`POST /judge` と `GET /health` を持ちます。 |
| `packages/schema` | 全境界の Zod スキーマです。型はここから導出します。 |
| `packages/core` | 決定論的な計算です。Claude を呼びません。 |
| `packages/geo` | 路線・駅の参照と、ネットワーク上の経路探索です。 |
| `packages/data` | DuckDB による前処理です。関西の路線 106 本と駅 1356 駅を出力します。 |
| `e2e` | Playwright による振る舞いテストとデモの録画です。 |

関西にはオープンな時刻表データがありません。
乗車時間は駅間距離と路線種別ごとの速度から概算します。
徒歩時間は直線距離の 1.3 倍から概算します。
これらのパラメータは開発者の推定による仮の値です。

設計の詳細は [docs/architecture.md](docs/architecture.md) にあります。
Claude Code での作り方は [docs/guides/claude-code-usage.html](docs/guides/claude-code-usage.html) にまとめています。

## 動かし方

Node.js 24 以上と pnpm 10 が必要です。

```bash
pnpm install
pnpm --filter e2e exec playwright install chromium  # e2e と録画に使うブラウザ
```

### API キーなしの起動

API キーが無いと、エージェントは決定論モードで動きます。
解釈は文字列照合で、判断は規則で行います。
写真の読み取りだけは使えません。
次のコマンドで、画面とエージェントを開発用のダミー内容で起動します。

```bash
pnpm dev:demo
```

http://localhost:3000 を開きます。
リプレイは http://localhost:3000/replay から始められます。
エージェントはポート 8787 で待ち受けます。
`pnpm dev:demo` は API キーがあっても決定論モードで動きます。

### claude モードの起動

環境変数 `ANTHROPIC_API_KEY` を設定すると claude モードになります。
キーはエージェント側の環境変数にだけ置き、画面には渡しません。

```bash
export ANTHROPIC_API_KEY=<あなたのキー>
JUDGE_MODE=claude pnpm dev:demo
```

`JUDGE_MODE=claude` を付けると、ダミー内容のまま claude モードになります。
起動時のログに `mode: claude` と出れば有効です。

### 環境変数

| 変数 | 対象 | 内容 |
|---|---|---|
| `ANTHROPIC_API_KEY` | agent | Claude の API キーです。あれば claude モードになります。 |
| `JUDGE_MODE` | agent | `claude` か `deterministic` を指定し、自動の判定を上書きします。 |
| `CONTENT_DIR` | agent, web | シナリオの読み込み元です。リポジトリルートからの相対パスで書きます。 |
| `PORT` | agent | 待ち受けるポートです。既定は 8787 です。 |
| `CORS_ORIGINS` | agent | 許可するオリジンをカンマ区切りで書きます。既定は `http://localhost:3000` です。 |
| `RATE_LIMIT_PER_MINUTE` | agent | 接続元ごとの 1 分あたりの上限です。既定は 20 です。 |
| `TRUST_PROXY` | agent | `true` のとき、頻度制限に `X-Forwarded-For` を使います。 |
| `NEXT_PUBLIC_AGENT_URL` | web | エージェントの URL です。既定は `http://localhost:8787` です。 |

### テスト

```bash
pnpm lint && pnpm typecheck
pnpm test                # 全パッケージの単体テスト
pnpm test:e2e            # シナリオの振る舞いテスト
pnpm guard               # scenarios/ の改変と、材料の文の写し込みを検査
pnpm validate:dev        # ダミーのシナリオの YAML を検証
pnpm validate --watch    # 保存のたびに scenarios/ を検証
pnpm smoke:claude        # 実 API で claude モードを 1 回確認。キーが無ければ案内だけ
```

`pnpm test:e2e` は画面とエージェントを自動で起動します。
エージェントは決定論モードで、ダミーの内容を読みます。
各シナリオの期待する振る舞いから、テストを自動で生成します。

### 録画

```bash
pnpm --filter e2e record
```

デモ動画用に、スマートフォンの縦画面でリプレイを録画します。
動画は `e2e/recordings/` に出力され、git では管理しません。

## シナリオと非公開の材料

`scenarios/` は開発者本人が書く領域です。
エージェントは読むだけで、フックが書き込みを遮断します。
`pnpm guard` は承認記録と照合し、改変を検出します。

開発者の知見の材料は、リポジトリの外に置いています。
材料の文はコードにもテストにも文書にも写しません。
材料から得た値は、`packages/core` の規則表に「開発者の推定」として置きます。
手順は [docs/guides/knowledge-authoring.html](docs/guides/knowledge-authoring.html) にあります。

シナリオは次のコマンドで雛形から書き始めます。

```bash
ALLOW_PROTECTED_EDIT=1 pnpm scenario:new <scenario_id> --event <event_id>
```

開発用のダミーのシナリオは `packages/schema/test/fixtures/dev-content/` にあります。
ダミーは画面とエージェントを動かすための仮のものです。

シナリオはすべて架空です。
実在の事故記録や公式発表文は転載していません。

## 推定の扱いと運行情報

みちあかりの出力はすべて推定です。
判断結果には、推定である旨の注意書きが必ず付きます。
画面では結論の近くに、公式発表を優先するよう常に表示します。

鉄道事業者の運行情報と列車走行位置は自動で取得しません。
運行情報は、利用者が撮影や貼り付け、選択で持ち込みます。
入力した内容と現在地は判断に使うだけで、保存しません。

## データと出典

使ってよいデータと利用条件は [docs/data-sources.md](docs/data-sources.md) にまとめています。
画面の地図の隅と「このアプリについて」に、次の出典を表示します。

```
地図: 国土地理院 / © OpenStreetMap contributors
鉄道データ: 「国土数値情報（鉄道データ）」（国土交通省）を加工して作成
駅の乗降客数: 「国土数値情報（駅別乗降客数データ）」（国土交通省）を加工して作成
気象データ: 気象庁
```

国土数値情報の鉄道データは 2025 年度版を使っています。
駅別乗降客数データは 2024 年度版で、どちらも CC BY 4.0 です。

## ライセンス

コードは MIT ライセンスです。全文は [LICENSE](LICENSE) にあります。
データは、[docs/data-sources.md](docs/data-sources.md) に書いた各ライセンスと出典の表示に従います。
