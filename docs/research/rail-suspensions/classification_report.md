# 過去事例から作った事象分類とバリエーション

8大分類・27種類。関西の時間付き事例58件と、分類用補助11件の計69件を整理した。主分類と変種の組は44通り。件数を増やすために同じ事象を別事例に分割していない。

主分類は1事例につき1つ。引き金と損傷の組合せは副分類で保持する。表の根拠件数は副分類も含むため合計して事例数とはしない。関西外・時刻不足・徐行のみ・単一列車・複合事象は分類用に限り、関西の時間分布に混ぜない。

| 大分類 | 種類 | 根拠件数（副分類含む） | 関西の時間付き事例 | 関西外の補助事例 |
| --- | --- | --- | --- | --- |
| 線路・構造物 | 橋げたの衝撃・確認 | 1 | 1 | 0 |
| 線路・構造物 | 駅・トンネル設備の落下 | 2 | 2 | 0 |
| 線路・構造物 | 暑さによるレール変形の疑い | 1 | 1 | 0 |
| 線路・構造物 | 線路付近の発煙確認 | 1 | 1 | 0 |
| 線路・構造物 | 線路・軌道構造物の支障 | 2 | 1 | 1 |
| 衝突・脱線・火災 | 踏切での列車と車両の衝突 | 1 | 1 | 0 |
| 衝突・脱線・火災 | 脱線 | 1 | 1 | 0 |
| 衝突・脱線・火災 | 車内の発火 | 1 | 1 | 0 |
| 線路・踏切の支障物 | 動物との接触 | 2 | 1 | 0 |
| 線路・踏切の支障物 | 踏切内の車両立ち往生 | 1 | 0 | 0 |
| 線路・踏切の支障物 | 架線・線路の異物 | 2 | 2 | 0 |
| 線路・踏切の支障物 | 倒木・樹木の接触 | 4 | 4 | 0 |
| 人・旅客対応 | 急病人対応 | 2 | 0 | 2 |
| 人・旅客対応 | 車内旅客トラブル | 1 | 0 | 1 |
| 人・旅客対応 | 人との接触 | 17 | 17 | 0 |
| 人・旅客対応 | 不審物確認 | 1 | 0 | 0 |
| 人・旅客対応 | 線路内立ち入り | 1 | 0 | 1 |
| 電力 | 停電・送電設備の不具合 | 2 | 2 | 0 |
| 信号・ポイント | ポイントの転換不良 | 3 | 2 | 1 |
| 信号・ポイント | 信号・保安装置の不具合 | 8 | 6 | 1 |
| 車両 | 車両故障・点検 | 5 | 4 | 0 |
| 車両 | 車両の発煙確認 | 1 | 1 | 0 |
| 気象・自然 | 地震後の確認 | 1 | 1 | 0 |
| 気象・自然 | 大雨 | 5 | 4 | 1 |
| 気象・自然 | 落雷 | 3 | 2 | 1 |
| 気象・自然 | 雪・凍結 | 2 | 1 | 1 |
| 気象・自然 | 強風 | 6 | 6 | 0 |

## 同じ原因でも分けるバリエーション

| 観点 | 実例の違い | 時間予測で混ぜないこと |
| --- | --- | --- |
| 人の対応 | 人との接触、立ち入り、急病人の搬送、旅客トラブル | 非常ボタンの使用だけで原因や短時間の再開を確定しない |
| 大雨 | 叡山電鉄2024-07-24は雨の弱まり後に再開、多摩2024-07-20は漏水で保安装置が故障 | 雨が止んだら設備も直るとは扱わない |
| 落雷 | 叡山電鉄2024-07-24は信号の部品交換、多摩2024-07-21は軌道桁の補修 | 落雷を一律の待ち時間に置き換えない |
| 雪・凍結 | 多摩2025-03-04は減速運転、叡山電鉄2025-02-08はポイントが動かず運休 | 最大遅延と見合わせ継続時間を混ぜない |
| 動物との接触 | JR奈良方面2025-06-09は損傷の記録なし、叡山電鉄2024-06-18は空気漏れと救援列車 | 損傷の記録がないことを損傷なしと解釈しない |
| 踏切 | 南海2024-02-06は列車と自動車が接触、叡山電鉄2025-02-01は自動車の撤去 | 立ち往生だけで列車との衝突や車両損傷を決めつけない |
| 架線・電力 | 阪急2026-09-09はシートの支障、神戸電鉄2025-07-17は樹木の接触による停電 | 撤去・送電・設備復旧は別の観点として持つ |

## アプリへの反映方針

分類の種類と予測時間モデルの対応数は別である。この変更は調査資料の分類を拡充するもので、アプリの選択肢や推定時間を同じ種類数に増やしたものではない。既存モデルとの候補対応はtaxonomy.jsonのexisting_model_idに記録した。対応先があっても精度検証済みという意味ではない。

追加する候補は、まず信号・ポイント、強風、停電、倒木・飛来物、動物接触、地震後の確認。次に急病人と旅客トラブルの分離、踏切の衝突と立ち往生の分離、大雨・落雷・雪に伴う設備損傷の分岐を検討する。分類だけで段階別の所要時間は作らない。

後日判明した故障原因を含む事後分類であり、利用者が最初から細分類を答えられる前提にはしない。入口は放送で聞いた大分類を使い、詳細は追加情報があるときに絞る設計とする。急病人対応の補助事例には36分の全線停止もあり、急病というだけで数分と断定しない。

## 出典と再現

元の58件はcases.jsonl、追加の11件はsupplemental_cases.jsonlに出典URL・閲覧日・対象範囲・時刻不足の理由を持つ。case_classifications.jsonlは元事例への分類根拠と出典の対応を持ち、classified_cases.csvで事例ごとの分類を確認できる。報告書の表はtaxonomy_coverage.csvから再現する。

`uv run classify_cases.py` で全事例の分類漏れ、出典との対応、主副分類、補助事例の混入禁止と日跨ぎの時刻差を検査して再生成する。本文・PDF・図表・個人の属性は転載しない。資料の利用条件はdocs/data-sources.mdを参照する。

- 人との接触: [HK-2025-0620-person](https://www.kyoto-np.co.jp/articles/-/1498509)、[HK-2026-0902-person](https://www.kyoto-np.co.jp/articles/-/1783191)

- 急病人対応: [TAMA-2024-0516-passenger-mixed](https://www.tama-monorail.co.jp/safety_report_2025.pdf)、[TAMA-2024-1130-medical](https://www.tama-monorail.co.jp/safety_report_2025.pdf)

- 車内旅客トラブル: [TAMA-2024-0516-passenger-mixed](https://www.tama-monorail.co.jp/safety_report_2025.pdf)

- 線路内立ち入り: [TAMA-2025-0518-intrusion](https://www.tama-monorail.co.jp/20250519_pressrelease.pdf)

- 不審物確認: [JRW-2025-0412-suspicious-object](https://www.kyoto-np.com/cn/video/jHf_QeVZVo0)

- 車両故障・点検: [EIZ-2024-0618-animal-rescue](https://eizandensha.co.jp/data/wp-content/uploads/sites/12/2025/09/anzen2025.pdf)、[HS-2024-1209-vehicle](https://www.kobe-np.co.jp/news/backnumber2/202412/0018430574.shtml)

- 車両の発煙確認: [JRW-2024-0207-kobe-vehicle](https://www.westjr.co.jp/press/article/items/240209_00_press_jrkobesen_2.pdf)

- 信号・保安装置の不具合: [EIZ-2024-0724-lightning](https://eizandensha.co.jp/data/wp-content/uploads/sites/12/2025/09/anzen2025.pdf)、[EIZ-2024-0902-track-circuit](https://eizandensha.co.jp/data/wp-content/uploads/sites/12/2025/09/anzen2025.pdf)

- ポイントの転換不良: [EIZ-2025-0208-snow-point](https://eizandensha.co.jp/data/wp-content/uploads/sites/12/2025/09/anzen2025.pdf)、[JRW-2024-1013-hanwa-signal](https://www.westjr.co.jp/press/article/items/250225_00_press_trouble_hanwasen_1.pdf)

- 停電・送電設備の不具合: [OM-2025-0813-chuo-power](https://subway.osakametro.co.jp/news/news_release/20250814_r4unkou_release.php)、[SK-2025-0717-tree](https://www.kobe-np.co.jp/news/society/202507/0019239235.shtml)

- 倒木・樹木の接触: [JRW-2026-0404-tree](https://www.kyoto-np.co.jp/articles/-/1689691)、[JRW-2026-0909-tree](https://www.kobe-np.co.jp/news/society/202609/0020799969.shtml)

- 架線・線路の異物: [HK-2026-0909-other](https://www.kobe-np.co.jp/news/society/202609/0020799969.shtml)、[KT-2024-0820-bamboo](https://www.nara-np.co.jp/news/20240820104438.html)

- 動物との接触: [EIZ-2024-0618-animal-rescue](https://eizandensha.co.jp/data/wp-content/uploads/sites/12/2025/09/anzen2025.pdf)、[JRW-2025-0609-deer](https://www.nara-np.co.jp/news/20250609222917.html)

- 踏切内の車両立ち往生: [EIZ-2025-0201-crossing-obstruction](https://eizandensha.co.jp/data/wp-content/uploads/sites/12/2025/09/anzen2025.pdf)

- 線路・軌道構造物の支障: [JRW-2026-0425-tozai-track](https://www.westjr.co.jp/press/article/2026/10/05/items/261005_00_press_tozailine_senro.pdf)、[TAMA-2024-0721-lightning-structure](https://www.tama-monorail.co.jp/safety_report_2025.pdf)

- 駅・トンネル設備の落下: [OM-2024-0118-yotsubashi-fitting](https://subway.osakametro.co.jp/news/news_release/20240118_yotsubashi_setsubitenken_owabi.php)、[OM-2026-0725-sakaisuji-concrete](https://subway.osakametro.co.jp/news/news_release/20260726_ebisuchou.php)

- 橋げたの衝撃・確認: [JRW-2024-1204-bridge](https://www.nara-np.co.jp/news/20241204134134.html)

- 線路付近の発煙確認: [JRW-2024-1009-kansai-track](https://www.westjr.co.jp/press/article/items/241030_00_press_trouble_kansaikukosen.pdf)

- 暑さによるレール変形の疑い: [HJ-2025-0801-rail](https://www.kobe-np.co.jp/news/backnumber2/202508/0019302978.shtml)

- 大雨: [EIZ-2024-0724-rain](https://eizandensha.co.jp/data/wp-content/uploads/sites/12/2025/09/anzen2025.pdf)、[EIZ-2024-0824-rain](https://eizandensha.co.jp/data/wp-content/uploads/sites/12/2025/09/anzen2025.pdf)

- 強風: [HS-2024-0320-wind](https://www.kobe-np.co.jp/news/society/202403/0017451322.shtml)、[JRW-2024-0320-wind](https://www.kobe-np.co.jp/news/society/202403/0017451322.shtml)

- 地震後の確認: [JRW-2026-0325-quake](https://www.kobe-np.co.jp/news/society/202603/0020165508.shtml)

- 落雷: [EIZ-2024-0724-lightning](https://eizandensha.co.jp/data/wp-content/uploads/sites/12/2025/09/anzen2025.pdf)、[KH-2026-1030-lightning](https://www.kyoto-np.co.jp/articles/-/1817969)

- 雪・凍結: [EIZ-2025-0208-snow-point](https://eizandensha.co.jp/data/wp-content/uploads/sites/12/2025/09/anzen2025.pdf)、[TAMA-2025-0304-snow-slow](https://www.tama-monorail.co.jp/safety_report_2025.pdf)

- 踏切での列車と車両の衝突: [NK-2024-0206-crossing](https://www.nankai.co.jp/lib/company/news/pdf/240206.pdf)

- 脱線: [KT-2026-0629-derail](https://kumanichi.com/articles/2008366)

- 車内の発火: [OM-2026-0419-battery](https://subway.osakametro.co.jp/news/news_release/20260419_r1daikokucho.php)
