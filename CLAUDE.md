# CLAUDE.md

## このプロジェクトについて

輸送障害に遭遇した関西の鉄道利用者に、元指令員の知見をもとに「待つか、切り替えるか」を判断できる見込みと行動を示すWebアプリ。
既存の運行情報は「何が起きたか」までしか伝えない。本アプリは「だから、あなたはどうすべきか」まで返す。

Built with Claude: Japan 2026 ハッカソン（2026/11/2〜11/8）の提出作品。リポジトリは公開される。

## 作業前に必ず読む文書

| 文書 | 内容 |
|---|---|
| `docs/vision.md` | 製品仕様。何を、誰のために、なぜ作るか。作らないもの |
| `docs/architecture.md` | 構成、データの流れ、エージェント設計、ツールとイベントの仕様、検証方法 |
| `docs/data-sources.md` | 使ってよいデータ、ライセンス、出典表示 |
| `docs/ux.md` | 画面構成、地図仕様、設計原則 |
| `docs/roadmap.md` | マイルストーン、作業の流れ（WS）の分担、完了条件 |
| `docs/goals.md` | `/goal` で自律的に作業するときの規則 |
| `docs/progress.md` | 作業記録。各ターンの終わりに追記する |
| `knowledge/README.md` | 指令員の知見ナレッジの書式 |

担当するWSが決まっている場合は、`docs/roadmap.md` の該当箇所を必ず読んでから着手する。

## 絶対に守る制約

1. **権利のないデータを使わない。** `docs/data-sources.md` に記載のないデータ源を追加する場合は、実装前にライセンスを確認し、同文書に追記してから使う。
2. **鉄道事業者の運行情報・列車走行位置を自動取得しない。** スクレイピング、非公式APIの利用は禁止。運行情報は利用者が持ち込む（撮影・貼り付け・選択入力）。
3. **社内情報を含めない。** 規制値、社内規程、内部手順の数値をコード・ナレッジ・テストデータに書かない。知見は外から観察できる兆候で定義する。
4. **秘密情報をコミットしない。** APIキーは環境変数のみ。`.env*` はコミットしない。キー名だけを書いた `.env.example` は例外としてコミットする。フロントエンドにキーを渡さない。
5. **`knowledge/` と `scenarios/` は開発者本人が書く。** エージェントは読むだけで、作成・変更しない（フックで遮断される）。内容に問題を見つけたら `docs/progress.md` の「開発者に確認したいこと」に書く。
6. **シナリオは架空。** 実在の事故記録や公式発表文を転載しない。
7. **推定であることを隠さない。** 利用者向け出力には、推定である旨と公式発表を優先すべき旨を必ず含める。

## 技術スタック

- モノレポ: pnpm workspaces + Turborepo、TypeScript（strict）
- 画面: Next.js（App Router）、Tailwind CSS、shadcn/ui、MapLibre GL JS、deck.gl
- 判断エージェント: Node.js 常駐サービス（Hono）、Anthropic Client SDK（`@anthropic-ai/sdk`）による自前のツール実行ループ、SSE で画面へストリーミング
- スキーマ: Zod（`packages/schema` が唯一の正）
- データ前処理: DuckDB（空間拡張）を SQL 中心で使用、tippecanoe で PMTiles を生成
- 徒歩経路: Valhalla（Docker、OpenStreetMap 関西抽出）
- テスト: Vitest（単体）、Playwright（シナリオの振る舞い・画面）
- 公開: 画面は Vercel、エージェントと Valhalla はコンテナ環境

## ディレクトリ構成

```
apps/
  web/            Next.js 画面
  agent/          判断エージェント（Hono + Anthropic SDK）
packages/
  schema/         Zod スキーマ（ナレッジ、観測、イベント、判断結果、シナリオ）
  core/           決定論的な計算（分岐点、到着時刻、運賃、残り時間）
  geo/            路線・駅・徒歩時間の参照
  data/           前処理スクリプトと SQL
knowledge/        指令員の知見ナレッジ（YAML、開発者が記述）
scenarios/        リプレイ用の架空シナリオと期待する振る舞い（YAML、開発者が記述）
infra/            Valhalla などのコンテナ定義
docs/             設計文書、作業記録
.claude/          Claude Code の設定とフック
```

テスト用の固定データは各パッケージの `test/fixtures/` に置く。`knowledge/` と `scenarios/` には置かない。

## よく使うコマンド

```bash
pnpm install
pnpm dev                 # web と agent を同時起動
pnpm test                # 全パッケージの単体テスト
pnpm test:e2e            # シナリオの振る舞いテスト（Playwright）
pnpm lint && pnpm typecheck
pnpm format              # Biome で整形
pnpm validate            # knowledge/ と scenarios/ の YAML と雛形の整合を検証
pnpm guard               # knowledge/ と scenarios/ を承認記録との照合、ブランチ差分、シンボリックリンク、内容検証で確認
pnpm guard:approve       # 開発者専用。ALLOW_PROTECTED_EDIT=1 と TTY での確認が必要
pnpm data:build          # 前処理（路線・駅・徒歩時間・タイル）
```

コマンドを追加・変更したら、この節を更新する。

## コーディング規約

- リーダブルなコードを書く。一関数一目的。取得・計算・表示を分離する
- 関数名は動詞で始める（`buildJudgment`、`computeBreakEven`、`renderPhaseTimeline`）
- 型は `packages/schema` の Zod スキーマから `z.infer` で導出する。同じ形の型を二重に定義しない
- 外部からの入力（API リクエスト、Claude の出力、YAML）は境界で Zod により検証する
- コメントは機能の要点のみ日本語で簡潔に書く。冗長な説明コメントは書かない
- 不要な try-catch を書かない。エラーは境界でまとめて扱う
- 数値計算（分岐点、到着時刻、運賃、残り時間）は `packages/core` に置き、Claude に計算させない
- テストを削除・skip して通すことをしない
- コードを提示するときは省略せず完全な形で示す

## Claude API の使い方

- 判断の中心: `claude-opus-5-5`
- 画像・発表文の読み取りなど速さが欲しい処理: `claude-haiku-5-5`
- モデル名は `apps/agent` の設定ファイル1か所で管理する
- システムプロンプトとツール定義は `apps/agent/src/prompts/` と `apps/agent/src/tools/` に置き、コードに文字列を埋め込まない

## 作業の進め方

1. 着手前に計画を立て、変更範囲を明示する
2. 共有スキーマ（`packages/schema`）を変更する場合は、影響を受ける WS を計画に書く
3. `pnpm typecheck`、`pnpm test`、`pnpm guard` が通ることを確認してからコミットする
4. 判断ロジック・プロンプト・ツールを変えたら `pnpm test:e2e` を実行し、シナリオの振る舞いが壊れていないことを確認する
5. コミットは小さく、意味のある単位で。メッセージは日本語で何をしたかを書く
6. 各ターンの終わりに `docs/progress.md` へ作業内容を追記する
7. 迷ったら `docs/` を正とし、文書と実装が食い違う場合は文書の更新を提案する
