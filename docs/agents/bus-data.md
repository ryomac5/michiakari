# 関西のバスデータ調査と実装設計

## 結論

一部使える：P11 の停留所位置で徒歩案内を勧め、時刻付きの乗換判断は許諾確認後に限る。

調査基準日は 2026-11-05 とし、一次情報の本文を読めた範囲を本書の確認済みとする。
公開が見つからない事業者は公開未確認とし、データ自体が存在しないという断定を避ける。
本書は実装担当者向けの調査と設計であり、データの追加やアプリの実装変更は行っていない。

## 根拠の表

### 国土数値情報

| 項目 | 内容 | 出典 URL | 確認日 |
|---|---|---|---|
| P11 の年度と内容 | 最新表示は 2022 年度版で、資料時点は概ね 2022 年８月。停留所の点、名称、事業者、系統を収録 | [P11 データ詳細](https://nlftp.mlit.go.jp/ksj/gml/datalist/KsjTmplt-P11-2022.html) | 2026-11-05 |
| N07 の年度と内容 | 最新表示は 2022 年度版で、資料時点は概ね 2022 年８月。経路の線、事業者名、備考を収録 | [N07 データ詳細](https://nlftp.mlit.go.jp/ksj/gml/datalist/KsjTmplt-N07-2022.html) | 2026-11-05 |
| P11 と N07 の許諾 | 2022 年度版は CC BY 4.0 の明記あり。旧版の P11 は 2010 年度、N07 は 2011 年度が非商用 | [P11 許諾欄](https://nlftp.mlit.go.jp/ksj/gml/datalist/KsjTmplt-P11-2022.html)、[N07 許諾欄](https://nlftp.mlit.go.jp/ksj/gml/datalist/KsjTmplt-N07-2022.html) | 2026-11-05 |
| 商用利用と再配布 | CC BY 4.0 は商用の共有と改変も許諾。適切な帰属表示、ライセンスへのリンク、変更の明示が条件 | [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/deed.ja) | 2026-11-05 |
| サイト規約と出典 | 2026 年３月23日から PDL 1.0 を適用し、個別の権利表記を優先。出典 URL と利用した資料名、加工した旨を表示 | [国土数値情報の利用規約](https://nlftp.mlit.go.jp/ksj/other/agreement.html) | 2026-11-05 |
| 関西の範囲 | 滋賀、京都、大阪、兵庫、奈良、和歌山の６府県。近畿地方版と府県別版を掲載し、三重は東海に分類 | [P11 地域選択](https://nlftp.mlit.go.jp/ksj/gml/datalist/KsjTmplt-P11-2022.html)、[N07 地域選択](https://nlftp.mlit.go.jp/ksj/gml/datalist/KsjTmplt-N07-2022.html) | 2026-11-05 |
| 形式と取得 | GML、Shapefile、GeoJSON の ZIP を掲載。近畿版は `P11-22_56_SHP.zip` と `N07-22_56_SHP.zip` | [P11 配布一覧](https://nlftp.mlit.go.jp/ksj/gml/datalist/KsjTmplt-P11-2022.html)、[N07 配布一覧](https://nlftp.mlit.go.jp/ksj/gml/datalist/KsjTmplt-N07-2022.html) | 2026-11-05 |
| 座標と取得条件 | 両データとも 2022 年度版は JGD2011 の緯度経度。公開配布一覧に登録や API キーの要件はなく、ZIP 実取得は未確認 | [P11 座標系](https://nlftp.mlit.go.jp/ksj/gml/datalist/KsjTmplt-P11-2022.html)、[N07 座標系](https://nlftp.mlit.go.jp/ksj/gml/datalist/KsjTmplt-N07-2022.html) | 2026-11-05 |
| P11 の位置の限界 | 原則として同一道路上の同一事業者・同一名称の停留所を統合。場所を特定できない停留所は未収録 | [P11 作成方法と注意](https://nlftp.mlit.go.jp/ksj/gml/datalist/KsjTmplt-P11-2022.html) | 2026-11-05 |
| N07 の属性の限界 | 2022 年度版の属性表は事業者名と備考のみ。系統別の停車順序、方向、発着時刻は属性表にない | [N07 属性情報](https://nlftp.mlit.go.jp/ksj/gml/datalist/KsjTmplt-N07-2022.html) | 2026-11-05 |
| 共通の対象外 | デマンドバスと都市間・長距離の高速バスを除外。一般路線の一部だけがデマンドの場合は収録対象になりうる | [P11 注意](https://nlftp.mlit.go.jp/ksj/gml/datalist/KsjTmplt-P11-2022.html)、[N07 注意](https://nlftp.mlit.go.jp/ksj/gml/datalist/KsjTmplt-N07-2022.html) | 2026-11-05 |

### 主な事業者の静的 GTFS と GTFS-JP

表の GitHub は、公開リポジトリへ元データや変換データを置く用途として判定している。
公開ページの時刻表を閲覧できることから、一括取得や再配布への許諾があるとは判断しない。

| 項目 | 内容 | 出典 URL | 確認日 |
|---|---|---|---|
| 大阪シティバス | 静的 GTFS の公開未確認。公式トップは Bus-Vision の時刻表と Osaka Metro の路線図を案内 | [公式案内](https://citybus-osaka.co.jp/) | 2026-11-05 |
| 大阪シティバスの取得条件 | ライセンス、登録、API キー、直接 ZIP は未確認。GitHub 再配布の許諾を確認できず採用保留 | [公式案内](https://citybus-osaka.co.jp/) | 2026-11-05 |
| 京都市バス | ODPT に GTFS-JP を掲載し、基本ライセンスを指定。カタログに `20261029` のリソース表示あり | [京都市営バスのカタログ](https://ckan.odpt.org/dataset/kyoto_municipal_transportation_kyoto_city_bus_gtfs) | 2026-11-05 |
| 京都市バスの取得条件 | 開発者登録が必要で、基本ライセンスの再配布は禁止。直接の無認証 ZIP、現行の特定利用条件、実取得は未確認 | [京都市営バスのカタログ](https://ckan.odpt.org/dataset/kyoto_municipal_transportation_kyoto_city_bus_gtfs)、[国交省の許諾解説](https://www.mlit.go.jp/commmmons/document/007/commmmons_doc_007-02_ver01.pdf#page=7) | 2026-11-05 |
| 神戸市バス | 市交通局が停留所位置とダイヤの GTFS-JP 提供を明記。配布先は公共交通データ HUB で、登録が必要 | [市バスのオープンデータ](https://kotsu.city.kobe.lg.jp/company/overview/open-data/bus-opendata/) | 2026-11-05 |
| 神戸市バスの取得条件 | HUB 独自規約の適用先で、無条件の GitHub 再配布許諾は未確認。登録後の API テスト画面で取得可能だが、キー仕様と実取得は未確認 | [HUB](https://www.ptd-hs.jp/)、[HUB 利用規約](https://www.ptd-hs.jp/static/PTD-HS-UserPolicy.pdf) | 2026-11-05 |
| 阪急バス | 静的 GTFS の公開未確認。公式トップは時刻表、経路検索、路線図を案内 | [公式案内](https://www.hankyubus.co.jp/) | 2026-11-05 |
| 阪急バスの取得条件 | ライセンス、登録、API キー、直接 ZIP は未確認。GitHub 再配布の許諾を確認できず採用保留 | [公式案内](https://www.hankyubus.co.jp/) | 2026-11-05 |
| 京阪バス | 静的 GTFS の公開未確認。公式トップはグループバスナビと運行経路図を案内 | [公式案内](https://www.keihanbus.jp/) | 2026-11-05 |
| 京阪バスの取得条件 | ライセンス、登録、API キー、直接 ZIP は未確認。GitHub 再配布の許諾を確認できず採用保留 | [公式案内](https://www.keihanbus.jp/) | 2026-11-05 |
| 近鉄バス | 静的 GTFS の公開未確認。公式トップは時刻表検索と路線系統図を案内 | [公式案内](https://www.kintetsu-bus.co.jp/) | 2026-11-05 |
| 近鉄バスの取得条件 | ライセンス、登録、API キー、直接 ZIP は未確認。GitHub 再配布の許諾を確認できず採用保留 | [公式案内](https://www.kintetsu-bus.co.jp/) | 2026-11-05 |
| 南海バス | 静的 GTFS の公開未確認。公式トップは路線バスとバスロケーションの案内を掲載 | [公式案内](https://www.nankaibus.jp/) | 2026-11-05 |
| 南海バスの取得条件 | ライセンス、登録、API キー、直接 ZIP は未確認。GitHub 再配布の許諾を確認できず採用保留 | [公式案内](https://www.nankaibus.jp/) | 2026-11-05 |
| 阪神バス | 静的 GTFS の公開未確認。公式トップは時刻表、経路、のりばの検索を案内 | [公式案内](https://www.hanshin-bus.co.jp/) | 2026-11-05 |
| 阪神バスの取得条件 | ライセンス、登録、API キー、直接 ZIP は未確認。GitHub 再配布の許諾を確認できず採用保留 | [公式案内](https://www.hanshin-bus.co.jp/) | 2026-11-05 |
| 京都バス | ODPT に静的 GTFS-JP を掲載し、基本ライセンスを指定。停留所の親子設定版と標柱のみの版を別に提供 | [親子設定版](https://ckan.odpt.org/ja/dataset/kyoto_bus_all_lines)、[標柱版](https://ckan.odpt.org/dataset/kyoto_bus_all_lines_anotherversion) | 2026-11-05 |
| 京都バスの取得条件 | 開発者登録が必要で、基本ライセンスの再配布は禁止。無認証 ZIP、現行の特定利用条件、実取得は未確認 | [京都バスのカタログ](https://ckan.odpt.org/ja/dataset/kyoto_bus_all_lines)、[国交省の許諾解説](https://www.mlit.go.jp/commmmons/document/007/commmmons_doc_007-02_ver01.pdf#page=7) | 2026-11-05 |
| 神姫バス | 静的 GTFS の全社公開は未確認。公式サイトと兵庫県の集約案内を確認した範囲で採用保留 | [公式サイト](https://www.shinkibus.co.jp/)、[兵庫県の集約案内](https://web.pref.hyogo.lg.jp/ks05/gtfs-jp.html) | 2026-11-05 |
| 神姫バスの取得条件 | ライセンス、登録、API キー、直接 ZIP は未確認。自治体の委託便があっても全社分の再配布許諾には一般化しない | [公式サイト](https://www.shinkibus.co.jp/) | 2026-11-05 |
| 奈良交通 | 静的 GTFS の全社公開は未確認。公式トップは時刻・運賃・バス位置の案内を掲載 | [公式案内](https://www.narakotsu.co.jp/) | 2026-11-05 |
| 奈良交通の取得条件 | ライセンス、登録、API キー、直接 ZIP は未確認。GitHub 再配布の許諾を確認できず採用保留 | [公式案内](https://www.narakotsu.co.jp/) | 2026-11-05 |
| 近江鉄道バス・湖国バス | 静的 GTFS の全社公開は未確認。公式サイトは路線図と時刻表の案内を掲載 | [公式案内](https://www.ohmitetudo.co.jp/bus/) | 2026-11-05 |
| 近江鉄道バス・湖国バスの取得条件 | ライセンス、登録、API キー、直接 ZIP は未確認。自治体便の公開を全社分の再配布許諾には一般化しない | [公式案内](https://www.ohmitetudo.co.jp/bus/) | 2026-11-05 |
| 全但バス | 公式トップがタイムアウトし、静的 GTFS の公開は未確認。ライセンス、GitHub 再配布、登録、キー、直接 ZIP も未確認 | [接続できなかった公式サイト](https://www.zentanbus.co.jp/) | 2026-11-05 |
| 和歌山バス | 公式発表は Bus-Vision で静的 GTFS と GTFS-RT の公開を明記。現在の配信 URL とライセンスは未確認 | [公式の導入発表](https://www.wakayamabus.co.jp/news/buslocation_system/) | 2026-11-05 |
| 和歌山バスの取得条件 | GitHub 再配布、登録、API キー、直接 ZIP は未確認。2019 年の公開発表だけで現在の利用許諾を判断しない | [公式の導入発表](https://www.wakayamabus.co.jp/news/buslocation_system/)、[案内先の Bus-Vision](https://loc.bus-vision.jp/wakayama/view/searchStop.html) | 2026-11-05 |
| 南海りんかんバス | 和歌山県が高野山と橋本・林間田園都市の GTFS 配布 URL を掲載。南海バス本体の公開確認とは別扱い | [和歌山県の配布案内](https://www.pref.wakayama.lg.jp/prefg/062500/kotsu/d00217817.html) | 2026-11-05 |
| 南海りんかんバスの取得条件 | 固定 ZIP URL は下記に記載し、実取得と認証要否は未確認。個別ライセンスと GitHub 再配布は詳細画面を読めず未確認 | [和歌山県の配布案内](https://www.pref.wakayama.lg.jp/prefg/062500/kotsu/d00217817.html)、[未確認の詳細画面](https://gtfs-data.jp/search?target_feed=rinkan%2Ahashimoto-rinkandenentoshi) | 2026-11-05 |
| 明光バス・龍神自動車 | 和歌山県が事業者別の固定 GTFS ZIP URL を掲載。現在の有効期間と個別ライセンスは未確認 | [和歌山県の配布案内](https://www.pref.wakayama.lg.jp/prefg/062500/kotsu/d00217817.html) | 2026-11-05 |
| 熊野御坊南海バス・中紀バス | 和歌山県が熊野・御坊別と中紀バスの固定 ZIP URL を掲載。GitHub 再配布、個別ライセンス、認証、実取得は未確認 | [和歌山県の配布案内](https://www.pref.wakayama.lg.jp/prefg/062500/kotsu/d00217817.html) | 2026-11-05 |

公式サイトの検索では、社名に GTFS、GTFS-JP、オープンデータを加えて公開先を調べた。
上表で未確認とした民間各社は、検索結果と公式案内の範囲で配布ページを確認できなかった。

### 全国の集約先と利用規約

| 項目 | 内容 | 出典 URL | 確認日 |
|---|---|---|---|
| GTFS データリポジトリ | AIGID が開発・運営し、日本バス情報協会が協力。固定 URL と API で配信し、個別に CC0 や CC BY を設定 | [運営側の概要資料](https://www.busdata.or.jp/document/20250218_repository.pdf) | 2026-11-05 |
| リポジトリの利用条件 | 運営側資料はオープンデータ用ライセンスを基本と説明。掲載先全体の利用規約と各フィードの許諾本文は未確認 | [運営側の説明会資料](https://www.busdata.or.jp/document/repository_20250218_1.pdf)、[本文未確認のサイト](https://gtfs-data.jp/) | 2026-11-05 |
| リポジトリの今回の確認範囲 | トップ、兵庫県検索、個別画面は JavaScript 案内だけで本文未確認。大阪１件・京都０件は 11-02 の過去記録で、今回の件数確認ではない | [兵庫県検索](https://gtfs-data.jp/search?pref=%E5%85%B5%E5%BA%AB%E7%9C%8C)、[過去の確認記録](../data-sources.md#5-未確定事項) | 2026-11-05 |
| 公共交通データ HUB | ジョルダンが GTFS ZIP と一部 GTFS-RT を提供。登録申請後に仕様書と API テスト画面を利用可能 | [HUB 公式案内](https://www.ptd-hs.jp/) | 2026-11-05 |
| HUB の第三者利用 | 規約第31条１項４号は提供情報を第三者に利用させる行為を禁止。公開 GitHub 配布の許諾は確認できず、別途確認が必要 | [HUB 規約 PDF の７ページ](https://www.ptd-hs.jp/static/PTD-HS-UserPolicy.pdf#page=7) | 2026-11-05 |
| HUB の更新条件 | 別紙Ａは保存期限を無期限とし、最新データの利用努力を要求。会社一覧と改正一覧は１日１回程度、ZIP は未取得の改正時が目安 | [HUB 規約 PDF の13ページ](https://www.ptd-hs.jp/static/PTD-HS-UserPolicy.pdf#page=13) | 2026-11-05 |
| HUB の料金と商用利用 | 神戸市バスの料金と個別契約条件は未確認。共通規約だけでは本アプリの商用利用と一般公開を許諾済みにできない | [HUB 規約 PDF](https://www.ptd-hs.jp/static/PTD-HS-UserPolicy.pdf) | 2026-11-05 |
| ODPT | 基本ライセンスのほか、CC BY 等の異なる許諾で配信。国交省解説は基本ライセンスの登録義務、再配布禁止、更新要求を明記 | [国交省の許諾解説](https://www.mlit.go.jp/commmmons/document/007/commmmons_doc_007-02_ver01.pdf#page=7) | 2026-11-05 |
| ODPT の商用と GitHub | 基本ライセンスは営利利用を許容するが、データの再配布は禁止。アプリの公開とデータの公開リポジトリ収録は別の判定 | [ODPT 自身の説明資料](https://challenge2025.odpt.org/materials/webinar01-01-3.pdf#page=13)、[国交省の許諾解説](https://www.mlit.go.jp/commmmons/document/007/commmmons_doc_007-02_ver01.pdf#page=7) | 2026-11-05 |
| ODPT の本文と認証 | 基本ライセンスの現行本文は JavaScript 描画で未確認。既存調査では ConsumerKey を利用し、今回の発行手順と個別条件は未確認 | [本文未確認の規約](https://developer.odpt.org/terms/data_basic_license.html)、[11-04 の既存調査](../guides/data-license-survey-2026-11-04.html#odpt) | 2026-11-05 |
| 兵庫県の集約 | 定時定路線のバス情報を GTFS-JP として取りまとめ。現在の配布先は GTFS データリポジトリの兵庫県検索 | [兵庫県の一次案内](https://web.pref.hyogo.lg.jp/ks05/gtfs-jp.html) | 2026-11-05 |
| 和歌山県の集約 | 2023 年10月に GTFS データリポジトリへ移行。県の案内ページは各社の固定 ZIP URL を掲載 | [和歌山県の一次案内](https://www.pref.wakayama.lg.jp/prefg/062500/kotsu/d00217817.html) | 2026-11-05 |
| GTFS と静的・動的情報 | 運営側資料は路線・時刻・運賃を静的 GTFS と分類。位置・遅れ・混雑は GTFS リアルタイムとして区別 | [運営側の説明資料の４ページ](https://www.busdata.or.jp/document/repository_20250218_1.pdf#page=4) | 2026-11-05 |

和歌山県が掲載する直接配布先を、取得実装の候補として以下の一覧に転記して保存する。
いずれも ZIP の実取得は行っておらず、無認証での取得成功と現行の有効期間は未確認とする。

| 事業者・範囲 | 固定 ZIP URL |
|---|---|
| 南海りんかんバス 高野山 | https://api.gtfs-data.jp/v2/organizations/rinkan/feeds/koyasan/files/feed.zip |
| 南海りんかんバス 橋本・林間田園都市 | https://api.gtfs-data.jp/v2/organizations/rinkan/feeds/hashimoto-rinkandenentoshi/files/feed.zip |
| 明光バス | https://api.gtfs-data.jp/v2/organizations/meikobus/feeds/meikobus/files/feed.zip |
| 龍神自動車 | https://api.gtfs-data.jp/v2/organizations/ryujinbus/feeds/ryujinbus/files/feed.zip |
| 熊野御坊南海バス 熊野 | https://api.gtfs-data.jp/v2/organizations/kumanogobobus/feeds/kumanogobobus_kumano/files/feed.zip |
| 熊野御坊南海バス 御坊 | https://api.gtfs-data.jp/v2/organizations/kumanogobobus/feeds/kumanogobobus_gobo/files/feed.zip |
| 中紀バス | https://api.gtfs-data.jp/v2/organizations/chukibus/feeds/chukibus/files/feed.zip |

## 使ってよいデータと条件

### 今回の確認だけで採用できる範囲

P11 と N07 の 2022 年度版は、許諾条件を守れば公開 GitHub に再配布できる。
元 ZIP と加工した GeoJSON のいずれにも、配布時に提供元と許諾を追跡できる情報を添える。
旧版には非商用の制限が付くため、ダウンロード設定で対象年度を必ず固定して取り込む。

画面には次の出典文を載せ、データページと CC BY 4.0 へのリンクを同じ場所に用意する。

```text
バス停の位置: 国土交通省「国土数値情報 バス停留所データ」2022年度版を加工して作成。
バスルート: 国土交通省「国土数値情報 バスルートデータ」2022年度版を加工して作成。
ライセンス: CC BY 4.0
```

最小案で N07 を取り込まない場合は、バスルートの出典行も表示対象から外して運用する。
停留所カードには「2022 年の位置情報」と示し、現在の標柱位置は公式案内で確認してもらう。

### 許諾の追加確認後に採用する範囲

時刻表の拡張は、個別の CC BY または CC0 を一次情報で確認できたフィードから開始する。
和歌山県の配布案内だけでは個別許諾を確定できないため、現時点では取り込みを有効にしない。
コミュニティバスも代替に役立つ可能性はあるが、都市部の主要路線の穴を埋めるとはみなさない。

ODPT の基本ライセンスでは、公開するコードと登録後に取得するデータを分けて管理する。
静的配信用 JSON への変換も元情報を復元できるため、許諾未確認のまま公開資産に含めない。
一般利用者への経路結果の表示は、現行条文と特定利用条件を読んで許される範囲を確定する。
サーバー内部で使う場合も更新要件を満たし、トークンを環境変数だけで保持する設計にする。

HUB の神戸市バスは、公開アプリでの利用範囲と GitHub 再配布について契約条件を確認する。
登録しただけで再配布や商用利用が許されるとは扱わず、確認できるまでは採用対象から外す。

ODPT を後日採用する場合の表示案を次に示し、正式な表記要件の確認後に内容を確定する。

```text
バス時刻表: 公共交通オープンデータセンターが提供する京都市交通局のデータを利用。
データの正確性と完全性は保証されません。
このアプリへのお問い合わせは、アプリ開発者の連絡先をご利用ください。
```

HUB の出典文は現行契約の指定を未確認のため、神戸市バスの文言を推測で定型化しない。

## 制約の文言との照合

`CLAUDE.md` の絶対に守る制約２は、次の文言で自動取得の禁止対象を明示している。

> 鉄道事業者の運行情報・列車走行位置を自動取得しない。
> スクレイピング、非公式APIの利用は禁止。

静的なバス時刻表は予定の発着時刻を表すため、現在の鉄道運行情報や列車位置とは異なる。
この文言に照らすと、許諾された静的バス GTFS の公式配布からの取得は禁止対象に当たらない。
これは文言を照合した設計上の判断であり、あらゆるバス情報の取得を許すという解釈ではない。

GTFS-RT は遅れや車両位置を表すため、静的 GTFS を使える根拠だけで取得を追加しない。
バスの動的情報自体は鉄道の禁止対象と異なるが、別途の許諾確認を要するため今回の対象外とする。
公式時刻表ページの自動巡回や非公式 API の利用は、静的な内容でも禁止方針に従い行わない。
データ源の追加前には制約１に従い、許諾を確認した内容を `docs/data-sources.md` に反映する。

## 実装の設計

### 案の比較

| 案 | データと表示 | 判断への使い方 | 採用条件 |
|---|---|---|---|
| 最小案 | P11 の名称・事業者・位置、徒歩の概算、公式案内リンク | 確認先の候補だけを表示し、到着比較と推奨経路には入れない | 2022 年度版の出典と CC BY 4.0 の表示 |
| 位置と形状の拡張 | P11 に N07 の経路形状を重ねて参考表示 | 行き先までつながる便の存在や、乗れる方向を断定しない | N07 の年度と出典を追加 |
| 時刻表の拡張 | 許諾済み GTFS の運行日、停車順序、予定発着時刻を表示 | 有効な便だけで所要時間を計算し、予定に基づく候補として表示 | 個別許諾、現行版、有効期間、停車順序を確認 |
| ODPT・HUB の拡張 | 登録後の取得とサーバー内部の処理 | 公開表示できる結果の範囲を確認後に設計を確定 | 公開リポジトリへのデータ混入防止と個別条件の確認 |

### 触るファイルとモジュール

表の新設ファイルは実装時の案であり、今回の調査では既存のコードやスキーマは変更していない。
共有スキーマの変更は、前処理、判断、画面、リプレイを担当する各 WS へ先に影響を共有する。

| ファイル・モジュール | 最小案での変更 | 時刻表を追加する段階の変更 |
|---|---|---|
| `packages/data/config/sources.ts` | P11 の年度、配布元、許諾、出典を追加 | フィードごとの取得先と許諾確認記録を追加 |
| `packages/data/src/download.ts` | 許諾済み ZIP のキャッシュ取得を再利用 | 登録制の取得先は公開資産の生成経路から分離 |
| 新設 `packages/data/sql/bus/01_stops.sql` | DuckDB の空間拡張で読み込み、対象範囲を抽出 | 許諾済み `stops.txt` の位置と標柱を優先 |
| 新設 `packages/data/sql/bus/02_routes.sql` | N07 を使う段階で参考用の形状を抽出 | `routes`、`trips`、`stop_times` を正規化 |
| 新設 `packages/data/sql/bus/03_services.sql` | 最小案では不要 | 運行日、例外日、時刻を検証し運行便を生成 |
| 新設 `packages/data/src/bus-build.ts` | 取得、SQL 実行、出力だけを組み立てる | 許諾と有効期間の検査に通るフィードのみ出力 |
| `packages/geo/data/` | `bus-stops.geojson` と出典メタ情報を追加 | 再配布できる便だけを別の `bus-services.json` へ出力 |
| `packages/geo/src/types.ts`、`geo-index.ts`、`node.ts`、`index.ts` | 停留所読込と近傍検索を追加 | 静的時刻表の読込を別の索引として追加 |
| 新設 `packages/geo/src/bus-access.ts` | `listWalkAccessBusStops` で候補と徒歩を返す | 駅や目的地への降車後徒歩も探索 |
| `apps/agent/src/alternatives/provider.ts`、`geo-provider.ts` | 到着時刻を持たない確認候補の列を追加 | 運行日と出発可能時刻に合う便を探索 |
| `apps/agent/src/tools/find-alternatives.ts`、`tools/types.ts` | 確認候補をツール結果に追加 | 時刻表に基づく計算値と出典を返す |
| `packages/schema/src/judgment.ts`、`events.ts` | 別の `busChecks` 用 Zod スキーマを追加 | 予定時刻と推定の区別、便と停留所の ID を追加 |
| `packages/core/src/walk.ts`、`params/routing.ts` | 徒歩概算を再利用し、探索上限は設定で管理 | バスアクセスの余裕時間も設定で管理 |
| 新設 `packages/core/src/bus-time.ts`、既存 `arrival.ts`、`time.ts` | バス乗車時間の計算は追加しない | 営業日、深夜時刻、待ち時間、乗車時間を決定論的に計算 |
| `packages/core/src/break-even.ts`、`compare.ts` | 確認候補を比較入力へ渡さない | バス候補の比較可否と推奨条件を明示して検査 |
| `apps/agent/src/prompts/judgment-system.md` | 停留所確認を切替の断定に使わせない | 予定と実績の違いを説明させる |
| `apps/web/src/features/judgment/` | 停留所確認カードと SSE の読込を追加 | 時刻表基準のカードと比較結果を表示 |
| `apps/web/src/app/about/page.tsx`、`apps/web/messages/ja.json`、`en.json` | P11 の出典文と元ページ、許諾リンクを追加 | 採用した形状やフィードの出典だけを追加 |
| `docs/data-sources.md`、`packages/data/README.md`、`docs/architecture.md` | 採用範囲、生成手順、比較対象外の扱いを追記 | 許諾と予定時刻の計算仕様を追記 |

### 最小案のデータの流れと手順

```text
公式 P11 ZIP → git 管理外キャッシュ → DuckDB と SQL
  → 対象地域の停留所 GeoJSON と出典情報
  → packages/geo の近傍検索と core の徒歩概算
  → alternatives の busChecks → SSE → 停留所の確認カード
```

1. `docs/data-sources.md` に採用行を追加してから、2022 年度版の ZIP を取得する。
2. DuckDB の `ST_Read` で GeoJSON を読み、既存の `config/area.geojson` と空間結合する。
3. `P11_001` を名称、`P11_002` を事業者として取り込み、元の名称も保持する。
4. `P11_003_01` から `P11_003_35` は系統候補として保持し、方向の根拠にはしない。
5. 停留所 ID は元データの版とレコードの対応を保存し、別事業者や別道路の同名を統合しない。
6. 座標の範囲、空の名称、重複、府県別件数を検査し、取得元と SHA-256 を記録する。
7. 出力メタ情報には資料年度、取得日、生成日、許諾、元ページ、加工内容をすべて記録する。
8. 近傍停留所の徒歩概算には既存の `estimateWalkMinutes` を使い、画面に概算の表示を付ける。
9. 公式リンクは事業者ごとの確認済み URL を自前で管理し、不明な深いリンクを生成しない。
10. 停留所の位置と徒歩だけを確認カードに表示し、便の存在や目的地への到達を保証しない。

表示文は「〇〇停留所まで徒歩約 N 分でバスを確かめる」とし、公式案内を開く導線を付ける。
現在の位置情報にはない乗り場方向や道路横断の事情を、徒歩時間の計算だけで補完しない。
N07 を足す場合も参考形状として保持し、P11 と近いという理由だけで停車順序を作らない。

`RouteOption` は到着時刻が必須なので、確認候補を無理に同じ形へ変換しない設計にする。
`busChecks` は到着時刻を持たず、停留所名、座標、徒歩分、出典、公式 URL を共有する。
`alternatives_computed` と最終判断の両方に確認候補を載せ、再生成後も画面で参照可能にする。
推奨 ID や分岐点の計算へ確認候補を渡さず、バスが早いという判断をこの段階では返さない。

### 時刻表を使う段階の手順

```text
個別許諾の確認 → 公式静的 GTFS ZIP → DuckDB の CSV 読込
  → 営業日と便の索引 → 出発可能時刻に合う便の探索
  → core の待ち時間・乗車時間・到着計算 → 予定に基づく候補
```

- `read_csv` で ID を文字列として読み、先頭ゼロとフィード間の ID の違いを保持する。
- `agency`、`stops`、`routes`、`trips`、`stop_times` を結び、停止順序の重複を検査する。
- `calendar` と `calendar_dates` を合成し、追加運行と運休の例外を営業日へ適用する。
- 有効期間は `feed_info` と実際の運行日で確認し、期限切れや日付不明の便を候補から外す。
- 24 時を超える時刻は営業日からの秒数として扱い、前営業日の深夜便も探索対象に含める。
- 乗車と降車の制限を確認し、`stop_sequence` が逆になる区間を乗車候補から外す。
- `departureTime` に停留所までの徒歩と乗車余裕を足し、乗車可能な最初の便を探索する。
- 待ち時間は予定発車から停留所到着を引き、乗車時間は予定着から予定発を引いて求める。
- 降車後の徒歩までを `computeArrival` で合計し、待ち時間を別途二重に加算しない。
- `frequencies` の頻度運行は予定便と分けて扱い、対応前は対象から外す設計とする。
- 運賃データの未対応や未収録は `fareYen: null` とし、鉄道の仮の運賃を流用しない。
- 便の時刻を示す段階でも「時刻表上の目安」と明示し、遅延込みの到着予測とは呼ばない。

最初の時刻表探索はバス１乗車と前後の徒歩に限定し、複数バスの乗継探索は後の拡張に分ける。
駅間の車内にいる利用者は、次の駅に着く見込みの `departureTime` から徒歩と便を探索する。
到着の見込みが遅れた場合は乗れる便を探し直し、既に発車した便を候補として残さない設計にする。

現在の `chooseBestAlternative` はタクシー以外を鉄道側にまとめ、到着の早い候補を選んでいる。
バスをそのまま投入すると推奨対象になるため、計算可能という理由だけで比較対象へ追加しない。
初期の時刻表案は参考カードにとどめ、混雑と遅延を扱う根拠が整ってから推奨条件を定義する。
推奨へ広げる際は静的な予定と不確実性を明示し、根拠のない p50 や p80 を作らない設計にする。
乗車余裕や探索上限を追加する場合は仕様値として定数化し、開発者の仮定であることを記録する。

実装時には、営業日例外、24 時超え、乗降制限、期限切れ、乗り遅れの境界を単体試験で確かめる。
最小案では到着不明の候補が比較に入らないことを確かめ、既存の判断フローを E2E でも検証する。

## docs/data-sources.md に足す行の案

第１節の採用表には、最小案で使う P11 を追加し、N07 は形状表示の採用時だけ追加する。

| 用途 | データ | 提供元 | 利用条件 | 状態 |
|---|---|---|---|---|
| バス停の確認先 | 国土数値情報 P11 の 2022 年度版 | 国土交通省 | CC BY 4.0。出典、元ページ、加工した旨を表示し、時刻と運行可否は出さない | 採用候補 |
| バスの参考形状 | 国土数値情報 N07 の 2022 年度版 | 国土交通省 | CC BY 4.0。出典、元ページ、加工した旨を表示し、停車順序や時刻の根拠にはしない | 拡張候補 |

第２節の除外理由には、許諾済みの静的データを別途確認して採用できることを補足する。

| データ | 理由 |
|---|---|
| 各社の時刻表 | 一括の再利用許諾がないものは除外し、個別に許諾した静的 GTFS は確認後に採用表へ追加 |
| ODPT 基本ライセンスのデータ | アプリ利用と再配布は別であり、取得 ZIP と復元可能な変換結果を公開リポジトリに含めない |
| HUB の神戸市バス GTFS-JP | 登録制であり、公開アプリと再配布の許諾範囲が未確認のため採用保留 |

第５節のバスの項目は過去の確認を残し、2026-11-05 の確認結果として次の記述を追加する。

> 国土数値情報の P11 と N07 は 2022 年度版が CC BY 4.0 で、位置と参考形状に利用できる。
> 京都市バスと京都バスは ODPT に静的 GTFS があるが、基本ライセンスでは再配布できない。
> 神戸市バスは登録制の HUB で GTFS-JP を配布し、公開アプリでの利用条件は未確認である。
> GTFS データリポジトリの大阪と京都の件数は今回再確認できず、11-02 の記録と区別する。

出典表示には本書の P11 の文言とリンクを追加し、N07 の文言は形状を採用した時点で追加する。

## リスクと未確認の点

### 判断に関わるリスク

- 鉄道停止時のバスへの集中は想定リスクとし、乗車待ちの追加時間を未検証の数値で補わない。
- 道路渋滞や乗車できない混雑により、静的な予定だけで到着保証ができない点を画面へ明示する。
- P11 と N07 は約４年前の資料なので、廃止、移設、改称、路線再編を反映しない可能性がある。
- P11 の代表点は標柱ごとの位置ではないため、反対側の乗り場へ徒歩案内する危険を残す。
- 現在の対象エリアは既存のポリゴンで切り出し、関西６府県を全域で案内するとは表示しない。
- 未収録の停留所や未許諾の事業者がある地域では、候補なしをバスの不存在と説明しない。
- 一般道の遅延リスクは和歌山バスも公式に説明しており、時刻表だけを高確度の到着予測にしない。

一般道の遅延についての一次情報は、[和歌山バスの公式説明](https://www.wakayamabus.co.jp/news/buslocation_system/)を本書の根拠として参照する。

### 未確認のページと次の確認作業

| 対象 | 今回確認できなかったこと | 次の作業 |
|---|---|---|
| [GTFS データリポジトリ](https://gtfs-data.jp/) | JavaScript 描画の本文、利用規約、現在の府県別件数 | 規約本文と採用するフィードの許諾を取得して記録 |
| [GTFS 一覧 API](https://api.gtfs-data.jp/v2/feeds) | web ツールで接続できず、現在の一覧と個別許諾は未確認 | 公式利用ガイドを確認できる環境で一覧を再確認 |
| [南海りんかんバスの詳細](https://gtfs-data.jp/search?target_feed=rinkan%2Ahashimoto-rinkandenentoshi)、[明光バスの詳細](https://gtfs-data.jp/search?target_feed=meikobus%2Ameikobus) | 画面本文が読めず、各フィードの許諾は未確認 | 原配布者、許諾、現行版と認証要否を確認 |
| [ODPT の規約本文](https://developer.odpt.org/terms/data_basic_license.html) | JavaScript 描画のため現行条文は未確認 | 11-04 の既存調査と現行版を照合 |
| [京都市バスの現行リソース](https://ckan.odpt.org/dataset/kyoto_municipal_transportation_kyoto_city_bus_gtfs/resource/6b564ebd-a957-4ddf-b2d9-6c0aff03637e) | カタログのリンクが 404 となり個別条件は未確認 | カタログから現行リンクを改めて確認 |
| [京都市のデータポータル](https://data.city.kyoto.lg.jp/dataset/00656/) | タイムアウトで本文未確認 | ODPT の一次カタログとポータルを後日照合 |
| [京都市バスの公開発表 PDF](https://www.city.kyoto.lg.jp/kotsu/cmsfiles/contents/0000321/321266/kohoshiryo.pdf) | 接続できず本文未確認 | 検索結果の抜粋を許諾確認の代用にしない |
| [全但バス](https://www.zentanbus.co.jp/) | タイムアウトで公式ページ本文未確認 | 公開先と取得条件を公式情報で再調査 |
| [HUB](https://www.ptd-hs.jp/) | 神戸市バスの個別条件、商用、出典指定、API キー、料金 | 登録後の契約条件で公開表示と再配布を区別して確認 |
| P11 と N07 の ZIP | ファイル本体、実件数、現地との一致は未確認 | 取り込み時に形状、属性、対象範囲を検証 |

検索結果だけに見えた許諾や有効期間は採用根拠にせず、ページ本文の確認が済むまで保留する。
リポジトリの個別画面を開く手段も試したが、利用可能なブラウザーがなく本文は確認できなかった。
今回は登録や許諾の問い合わせを行わず、実装前に確認すべき条件を上表の未確認事項として残す。
