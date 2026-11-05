# 過去事例の点検と現行モデルの比較

対象は2024-01-01〜2026-11-05。計58件を構造検査し、開始・再開の両方がある事例は時刻差と所要時間の一致も検査した。
両時刻が概数でない記録は9件、事業者の公表資料を出典に含む記録は13件。これは今回全件のリンクを再閲覧したという意味ではない。直近に追加したJR西日本3件と叡山電鉄4件は一次資料の時刻を個別に確認した。

## 所要時間の集計

| 原因 | 件数 | 中央値（分） | p80（分） | 最短（分） | 最長（分） |
| --- | --- | --- | --- | --- | --- |
| person_accident | 17 | 100.0 | 123.2 | 25 | 147 |
| other | 9 | 75.0 | 148.8 | 23 | 225 |
| natural_wind | 6 | 52.5 | 245.0 | 10 | 330 |
| signal_failure | 5 | 190.0 | 258.2 | 135 | 531 |
| vehicle_failure | 5 | 85.0 | 92.8 | 71 | 96 |
| natural_other | 4 | 142.5 | 240.0 | 20 | 375 |
| natural_rain | 4 | 71.0 | 105.2 | 34 | 140 |
| natural_lightning | 2 | 48.5 | 55.4 | 37 | 60 |
| power_failure | 2 | 492.5 | 503.0 | 475 | 510 |
| crossing_accident | 1 | 614.0 | 614.0 | 614 | 614 |
| derailment | 1 | 1575.0 | 1575.0 | 1575 | 1575 |
| natural_snow | 1 | 85.0 | 85.0 | 85 | 85 |
| onboard_fire | 1 | 28.0 | 28.0 | 28 | 28 |

## 現在の開発用モデルとの比較

| 原因 | 件数 | 予測p50（分） | 予測p80（分） | 平均絶対誤差（分） | 平均誤差・予測−実績（分） | p80以内の件数 |
| --- | --- | --- | --- | --- | --- | --- |
| natural_rain | 4 | 131 | 208 | 56.5 | 52.0 | 4 |
| person_accident | 17 | 60 | 110 | 42.5 | -36.1 | 11 |
| vehicle_failure | 5 | 34 | 125 | 50.8 | -50.8 | 5 |

この比較は、事象を正しく識別でき、見合わせ開始時点で段階の経過が0分、途中の兆候と公式見込み時刻がない場合の固定予測である。coreの実際の分岐・下限・2万回の標本生成を使い、段階のp50/p80の単純加算はしない。大雨は運転見合わせ前の段階を除く。実績の終点に合わせ、再開後の初列車待ちは0にして比較した。

学習やパラメータの変更はしていないため、同じ事例を使った学習・評価の混同はない。ただし、報道に残った事例の選択バイアス、概数、発生時刻の代用、全区間と部分再開の違いがある。運用時の段階判定・途中時点の残り時間・実際に乗車できた時刻の精度は測れていない。p80以内の割合はこの標本での実績であり、利用者全体に対する保証ではない。

10件未満の区分（other, natural_wind, signal_failure, vehicle_failure, natural_other, natural_rain, natural_lightning, power_failure, crossing_accident, derailment, natural_snow, onboard_fire）は特に少数で、実用の時間分布として採用できる根拠が不足する。事業者の事後報告も大きな障害に偏るため、件数だけで採用しない。

## 再現と出典

`uv sync --locked` の後、`uv run research.py` を実行する。cases.jsonlを正とし、cases.csv、duration_summary.csv、model_evaluation.csvとこの文書を生成する。出典URL・閲覧日・概数・注記はcases.jsonl/cases.csvに残る。対象外候補はscreened_candidates.jsonlに理由を記録する。

比較対象は開発用ダミー知見。再現用のファイル指紋はmodel_evaluation.csvに含む。情報源の利用条件はREADME.mdとdocs/data-sources.mdを参照する。収集や構造検査だけで学習利用の許諾が得られるわけではない。予測パラメータの自動更新はしない。

モデル指紋: [{"event": "person_accident", "knowledge_sha256": "f3044e044c35cb733bb87230f2b2ce42bd478f94ae2372b896be9df6d20c7af5"}, {"event": "vehicle_failure", "knowledge_sha256": "0094b3eb9974c4bcb1e0f73808bbe81d4d6f1165dee1420a4bbbb5f073fc891d"}, {"event": "heavy_rain", "knowledge_sha256": "468afcc9a4afc446a587de4248a989f820f31110badc15eb21c3626f2526e28e"}]
