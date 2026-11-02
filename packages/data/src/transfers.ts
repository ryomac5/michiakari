import type { StationNode, TransferEdge } from "@repo/geo";
import { computeDistanceMeters } from "./geometry.ts";

// 乗換候補の抽出
// 別路線の駅で、直線300m以内のもの、または名前が関連し1km以内のものを結ぶ
// 名前の関連: 同名か、一方が他方を含む（梅田と大阪梅田、難波とJR難波など）
// 比べる前に「ノ」「ヶ」「ケ」を除く（三ノ宮と神戸三宮など）

export const NEAR_TRANSFER_METERS = 300;
export const RELATED_NAME_TRANSFER_METERS = 1000;

function normalizeStationName(name: string): string {
  return name
    .normalize("NFKC")
    .replace(/駅$/, "")
    .replace(/[ノヶケ]/g, "");
}

export function isRelatedStationName(a: string, b: string): boolean {
  const x = normalizeStationName(a);
  const y = normalizeStationName(b);
  if (x === y) return true;
  const [shorter, longer] = x.length <= y.length ? [x, y] : [y, x];
  return shorter.length >= 2 && longer.includes(shorter);
}

export function findTransfers(nodes: readonly StationNode[]): TransferEdge[] {
  const transfers: TransferEdge[] = [];
  const sorted = [...nodes].sort((p, q) => p.lonLat[0] - q.lonLat[0]);
  // 経度1度 ≒ 91km（北緯35度）。1km の幅で打ち切る
  const lonWindow = RELATED_NAME_TRANSFER_METERS / 90_000;
  for (let i = 0; i < sorted.length; i++) {
    const a = sorted[i] as StationNode;
    for (let j = i + 1; j < sorted.length; j++) {
      const b = sorted[j] as StationNode;
      if (b.lonLat[0] - a.lonLat[0] > lonWindow) break;
      if (a.lineId === b.lineId) continue;
      const meters = computeDistanceMeters(a.lonLat, b.lonLat);
      const linked =
        meters <= NEAR_TRANSFER_METERS ||
        (meters <= RELATED_NAME_TRANSFER_METERS && isRelatedStationName(a.name, b.name));
      if (!linked) continue;
      const [from, to] = a.stationId < b.stationId ? [a, b] : [b, a];
      transfers.push({ from: from.stationId, to: to.stationId, walkMeters: Math.round(meters) });
    }
  }
  return transfers.sort((p, q) => p.from.localeCompare(q.from) || p.to.localeCompare(q.to));
}
