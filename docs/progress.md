# 作業記録

各セッションは、ターンの終わりに以下の書式で追記する。新しい記録を上に書く。

## 書式

```
### YYYY-MM-DD HH:MM / <WS名> / <ゴールの要約>

- やったこと:
- 確認結果: （実行したコマンドと結果）
- 残課題:
- 開発者に確認したいこと: （knowledge/・scenarios/ の内容への疑問、仕様の判断が必要な点）
```

## 記録

### 2026-11-02 / M0 / 基盤の実装

- やったこと:
  - モノレポの雛形を作った。pnpm 10、Turborepo、TypeScript strict、Biome、Vitest、Playwright を使う。Next.js と Hono の骨組みを置いた
  - `packages/schema` に全境界の Zod スキーマと単体テストを追加した。レビュー指摘を受け、二重定義を解消し、参照検査とリプレイ用の `scenarioId` を足した
  - YAML ローダー、内容検証、雛形の整合検査を追加し、`pnpm validate` にまとめた
  - `pnpm guard` と `pnpm guard:approve` を追加した
  - 実装に合わせて `docs/architecture.md` の 4 章と 7 章、`CLAUDE.md`、`docs/roadmap.md` の 4 章を更新した
- 確認結果:
  - `pnpm typecheck`、`pnpm test`、`pnpm lint`、`pnpm validate`、`pnpm test:e2e` は exit 0
  - `pnpm guard` は承認記録が無いため失敗した。シンボリックリンク、ブランチ差分、内容検証の検査は合格した
- 残課題:
  - 開発者が `pnpm guard:approve` を初めて実行する
  - protect-paths フックの穴を塞ぐ修正案を出す。対象は Bash 経由の書き込み、大文字小文字の違い、シンボリックリンク
  - 地名を座標に変えるジオコーダを調査する
  - `.describe()` による項目説明を、スキーマ側とツール側のどちらに持つかを WS4 で決める
- 開発者に確認したいこと:
  - `scenarios/_template.yaml` に `weather.readings` の記入例を足してほしい
  - 同じ雛形の `timeline.kind` のコメントに `train_movement` が無い。スキーマは許している
  - `exit_signals` を次の段階の兆候に限るか。いまは同じファイルのどの兆候も指せる
  - 残り時間の分布をどう算出するか。WS3 の最初の設計判断になる
  - 鉄道運賃のデータ源が無いため、`fareYen` は null を許している
  - 国土数値情報の利用条件を確認してほしい。WS1 の着手条件である
