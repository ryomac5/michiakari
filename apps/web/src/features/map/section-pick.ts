import { computeDistanceMeters, type StationNode } from "@repo/geo";
import { type Bounds, computeFitBounds, type Position } from "./scene";

// 止まっている区間の両端を地図で選ぶ。利用者のいる路線の駅だけを押せる印にする

// 選んでいる間に地図へ渡す値。first は先に押した駅の名前
export type MapSectionPick = {
  lineId: string;
  first: string | null;
  onPick: (stationName: string) => void;
  onCancel: () => void;
};

export type PickStation = { name: string; position: Position };

// 選び始めに見せる、現在地からの半径。両端が入る程度に引き、隣の駅の印が重ならない程度に寄せる
export const pickFitRadiusMeters = 8_000;

// 路線の駅を、同じ名前を 1 つにまとめて並べる
export function listPickStations(nodes: readonly StationNode[], lineId: string): PickStation[] {
  const seen = new Set<string>();
  return nodes.flatMap((n) => {
    if (n.lineId !== lineId || seen.has(n.name)) return [];
    seen.add(n.name);
    return [{ name: n.name, position: [n.lonLat[0], n.lonLat[1]] as Position }];
  });
}

// 選び始めに寄せる範囲。現在地から半径の中の駅を収める。現在地が分からなければ路線の全体
export function selectPickBounds(
  stations: readonly PickStation[],
  here: Position | null,
  radiusMeters = pickFitRadiusMeters,
): Bounds | null {
  const near = here
    ? stations.filter((s) => computeDistanceMeters(here, s.position) <= radiusMeters)
    : stations;
  return computeFitBounds((near.length >= 2 ? near : stations).map((s) => s.position));
}
