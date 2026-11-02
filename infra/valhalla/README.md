# Valhalla

乗換の徒歩経路と主要駅の到達範囲を事前に計算するための Valhalla。
公開環境では動かさない。結果は `packages/geo/data/` に入れてコミットする。

## 構成

| 項目 | 内容 |
|---|---|
| イメージ | `ghcr.io/valhalla/valhalla-scripted`。版は compose.yaml の digest で固定する |
| 元データ | Geofabrik が配布する OpenStreetMap の関西抽出 |
| 置き場所 | `packages/data/.cache/valhalla/`。pbf とタイルを置く。git 管理外 |
| ポート | 8002 |

## 手順

リポジトリの直下で実行する。

```bash
# 1. 関西の pbf を取得する。約 355MB
pnpm data:osm

# 2. タイルを作り、8002 番で起動する。初回はタイルの生成を待つ
docker compose -f infra/valhalla/compose.yaml up -d
docker compose -f infra/valhalla/compose.yaml logs -f valhalla

# 3. 起動を確かめる
curl http://localhost:8002/status

# 4. 徒歩経路と到達範囲を計算し、packages/geo/data/ に書く
pnpm data:walk

# 5. 止める。タイルは残るので、次回はすぐ起動する
docker compose -f infra/valhalla/compose.yaml down
```

ログに `Found config file. Starting valhalla service!` が出たら使える。

## 所要時間

2026年11月2日に Apple Silicon の Mac と Docker Desktop で測った。

| 処理 | 所要時間 |
|---|---|
| pbf の取得 | 約14分。回線による |
| タイルの生成 | 約20分。初回だけ |
| `pnpm data:walk` | 約30秒 |

## OSM を新しくするとき

```bash
pnpm data:osm --force
docker compose -f infra/valhalla/compose.yaml run --rm -e force_rebuild=True -e serve_tiles=False valhalla
```

タイルを作り直したら手順 2 から進める。

## 資格情報ヘルパーが止まるとき

`docker pull` が資格情報ヘルパーで止まる場合は、空の設定ディレクトリを一時的に指定する。

```bash
DOCKER_CONFIG=$(mktemp -d) docker compose -f infra/valhalla/compose.yaml up -d
```

## 出典

計算結果は OpenStreetMap のデータから作るので、ODbL に従う。
画面には「© OpenStreetMap contributors」と、Valhalla で計算した旨を表示する。
