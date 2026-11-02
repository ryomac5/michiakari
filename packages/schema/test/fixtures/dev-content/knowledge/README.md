# 開発用のダミー知見

開発用のダミー。開発者の知見ではない。本番の判断には使わない。

- 開発者の本物のナレッジが揃うまで、画面とエージェントを動かすために置く
- 書式はリポジトリルートの `knowledge/_template.yaml` に合わせている
- 所要時間は報道や利用者の体感程度の目安で、根拠のある値ではない
- 社内の規制値・規程・内部手順の数値は含めない
- 読み込むには `CONTENT_DIR=packages/schema/test/fixtures/dev-content` を指定する
- 検証は `pnpm validate:dev` で行う
