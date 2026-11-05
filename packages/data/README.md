# @repo/data

国土数値情報から関西の路線・駅・駅間距離のネットワークを作る前処理。
出力は `packages/geo/data/` に置き、`@repo/geo` が読む。

## 手順

```bash
pnpm data:build
```

1. 国土数値情報の鉄道データ N02-25 と駅別乗降客数データ S12-25 の zip を `.cache/` に取得する。取得済みなら再取得しない
2. DuckDB の空間拡張で zip 内の GeoJSON を直接読み、対象エリアの路線を切り出す
3. 事業者名と路線名を正規化し、新幹線・ケーブルカー・観光路線を除く
4. 駅の線データの中点を代表点にし、乗降客数を駅コードで結合する
5. 線路区間の端点をつないだグラフを駅から探索し、隣接駅と駅間距離を求める
6. 隣接関係から路線ごとの駅の並びと累積距離を作る
7. 乗換候補を結び、GeoJSON と JSON を書き出す
8. バス停留所 P11 の 2022 年度版を関西 6 府県ぶん取得し、駅の周りの停留所だけを書き出す

`.cache/` は git 管理外である。
初回は DuckDB が空間拡張をネットワークから取得する。
スクリプトは Node 24 の型除去で TypeScript をそのまま実行する。

## 設定

| ファイル | 内容 |
|---|---|
| `config/area.geojson` | 対象エリアのポリゴン。範囲内に駅がある路線をすべて抽出する |
| `config/operators.ts` | 事業者名の正規化、路線名の付け替え、除外の条件、路線の愛称 |
| `config/line-types.ts` | 路線種別の割り当て表。表にない路線は事業者ごとの既定値になる |
| `config/line-colors.ts` | 各社のラインカラーの値。表にない路線は事業者の代表色か中立色になる |
| `config/station-readings.ts` | 主要駅の読み。ひらがな検索に使う |
| `config/sources.ts` | 元データの URL、版、出典表示の文言 |
| `config/bus-operators.ts` | バスの事業者名の表示と、確認済みの公式の案内の URL |
| `sql/` | DuckDB で実行する SQL。番号順に実行する |

## 出力

| ファイル | 内容 |
|---|---|
| `lines.geojson` | 路線の形。対象エリアで切り出し、約3mの許容誤差で単純化した |
| `stations.geojson` | 路線ごとの駅の代表点 |
| `network.json` | 駅ノード、隣接駅の辺、乗換の辺、路線ごとの駅の並び |
| `meta.json` | 出典の文言、元データの版、生成日時、件数 |
| `bus-stops.geojson` | バス停留所の点。properties は `id`、`name`、`operator` |
| `bus-stops-meta.json` | バス停の出典、許諾、zip の SHA-256、駅からの距離、件数、事業者の案内 |

座標は小数5桁に丸める。
駅 ID は `事業者キー.路線名.駅名` の形で、URL で意味を持つ記号は `_` に置き換える。
乗換の辺は、別路線の駅で直線300m以内のものと、名前が関連し1km以内のものを結ぶ。
名前の関連は、同名か、一方が他方を含む場合とする。
乗換の `walkMeters` は代表点どうしの直線距離である。

## 出典表示

画面には次の文言を表示する。

```
鉄道データ: 「国土数値情報（鉄道データ）」（国土交通省）を加工して作成
駅の乗降客数: 「国土数値情報（駅別乗降客数データ）」（国土交通省）を加工して作成
```

元データは CC BY 4.0 で、加工・再配布ができる。

## バス停

国土数値情報のバス停留所 P11 の 2022 年度版を使う。
2010 年度版は非商用なので使わない。
府県別の SHP 版の zip に入っている UTF-8 の GeoJSON を DuckDB で読む。
SQL は `sql/bus/` にあり、四角の範囲で駅の近くの候補に絞る。
正確な距離は `src/bus-build.ts` が packages/core のハバーシン距離で確かめる。

- 駅からの距離の上限は、確認候補の徒歩の上限 10 分で届く直線距離の約 616m とする
- これより遠い停留所は判断に出ないので、ファイルに収めない
- 収めるのは名前、事業者、位置だけで、系統と時刻は収めない
- P11 にバスの種類の区分が無いため、名前に「高速バス」を含む停留所を外す
- ID は `P11-22_府県コード:元ファイルの並び順` とする

画面には次の文言を表示する。

```
バス停の位置: 国土交通省「国土数値情報 バス停留所データ」2022年度版を加工して作成。ライセンス: CC BY 4.0
```

## 徒歩経路と到達範囲

乗換の徒歩時間と主要駅の到達範囲は、ローカルの Valhalla で事前に計算する。
公開環境では Valhalla を動かさない。
`pnpm data:build` とは別のコマンドで、Valhalla が無くても `data:build` は動く。

```bash
pnpm data:osm      # Geofabrik の関西抽出を .cache/valhalla/ に取得する
docker compose -f infra/valhalla/compose.yaml up -d
pnpm data:walk     # 乗換の経路と到達範囲を求め、packages/geo/data/ に書く
```

Valhalla の起動は `infra/valhalla/README.md` を見る。
`data:walk` は次を書き出す。

| ファイル | 内容 |
|---|---|
| `network.json` | 乗換の辺に `walkMinutes` と `walkMetersRoute` を足す。直線距離の `walkMeters` は残す |
| `isochrones.geojson` | 主要駅の徒歩10分・20分の到達範囲。properties は `stationName`、`minutes`、`stationIds` |
| `meta.json` | `walk` に OSM の日付、Valhalla の版、歩く速さ、件数を記録する |

- 歩く速さは packages/core と同じ 80m/分にそろえ、Valhalla には 4.8km/h を渡す
- `walkMinutes` は Valhalla の所要秒を分に切り上げた値である
- 到達範囲は乗降客数の合計が多い上位300か所で求める
- 200m 以内の駅と 500m 以内の同名の駅は 1 か所にまとめる
- 到達範囲は 10m の許容誤差で単純化し、座標を小数5桁に丸める
- `data:build` で作り直しても、両端の駅と直線距離が同じ乗換は前回の経路を引き継ぐ
- `isochrones.geojson` は `data:build` では消さない

### 所要時間

2026年11月2日に Apple Silicon の Mac と Docker Desktop で測った。

| 処理 | 所要時間 |
|---|---|
| `pnpm data:osm` の取得（約 355MB） | 約14分。回線による |
| Valhalla のタイルの生成 | 約20分。初回だけ |
| `pnpm data:walk`（乗換 508 件、到達範囲 300 か所） | 約30秒 |

### 出典

徒歩経路と到達範囲は OpenStreetMap のデータから Valhalla で計算した。
計算結果は ODbL に従い、画面には次の文言を表示する。

```
徒歩経路・到達範囲: © OpenStreetMap contributors のデータから Valhalla で計算
```

## PMTiles を作らない理由

tippecanoe が開発環境に入っていないため、今回は GeoJSON だけを出力する。
