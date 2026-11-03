import type { Map as MapLibreMap } from "maplibre-gl";
import { sourceIds } from "./layers";

// 地図の準備ができたかの判定。下地の地理院タイルの読み込みは待たない
// スタイルと自前のレイヤーが描けて、視点の動きが止まったら準備ができたとみなす

const ownSourceIds = Object.values(sourceIds).filter((id) => id !== sourceIds.gsi);

function checkOwnSourcesLoaded(map: MapLibreMap): boolean {
  return ownSourceIds.every((id) => map.getSource(id) === undefined || map.isSourceLoaded(id));
}

// 描画のたびに確かめ、満たしたら一度だけ知らせる。返す関数で待つのをやめる
export function waitForOwnLayersDrawn(map: MapLibreMap, onReady: () => void): () => void {
  const check = () => {
    if (map.isMoving() || !checkOwnSourcesLoaded(map)) return;
    map.off("render", check);
    onReady();
  };
  map.on("render", check);
  return () => {
    map.off("render", check);
  };
}
