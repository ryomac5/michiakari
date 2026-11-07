import type { RouteOption } from "@repo/schema";
import { type Bounds, computeFitBounds, type Position } from "./scene";
import type { StationGuide } from "./station-guide";

// 地図に出す印を、勧める経路と今いる位置と行き先にしぼる。表示用の純関数だけを置く
// ほかの駅の候補はシートの一覧に残し、地図からは消す

// 駅の印と名前が読める拡大率の下限。今いる位置と行き先を収めるとこれより引くなら、近くの駅を優先する
export const READABLE_FOCUS_ZOOM = 11.5;

// 寄せる範囲の最小の幅。単位は度。点が 1 つでも寄りすぎない
const minSpanDeg = 0.004;

export type RouteGuide = StationGuide & {
  // 今いる位置と行き先と経路の駅を収める範囲。行き先が分からなければ null
  wideBounds: Bounds | null;
};

// 地図に描く経路が歩きを含むか。含むときだけ徒歩の範囲の円を出す
export function checkRouteWalks(option: RouteOption | undefined): boolean {
  return option?.legs.some((leg) => leg.mode === "walk" && leg.minutes > 0) ?? false;
}

// 案内を、地図に描く経路の駅だけにしぼる。路線色に塗る路線も経路と乗っている路線だけにする
export function selectRouteGuide(
  guide: StationGuide,
  lineIds: readonly string[],
  destination: Position | null,
  // 印は出さないが、寄せる範囲に含める点。乗り続けるときの次の駅など
  extraPoints: readonly Position[] = [],
): RouteGuide {
  const stations = guide.stations.filter((s) => s.recommended);
  const keys = new Set(stations.map((s) => s.key));
  const near = [
    guide.here.position,
    ...(guide.alight ? [guide.alight.position] : []),
    ...stations.map((s) => s.position),
    ...extraPoints,
  ];
  return {
    ...guide,
    stations,
    walkPaths: {
      ...guide.walkPaths,
      features: guide.walkPaths.features.filter((f) => keys.has(f.properties.key)),
    },
    walkLabels: {
      ...guide.walkLabels,
      features: guide.walkLabels.features.filter((f) => keys.has(f.properties.key)),
    },
    relevantLineIds: [...new Set(lineIds)],
    bounds: computeFitBounds(near, minSpanDeg),
    wideBounds: destination ? computeFitBounds([...near, destination], minSpanDeg) : null,
  };
}

// 寄せる範囲を選ぶ。今いる位置と行き先がぎりぎり入る範囲を先に試し、駅の印が読めないほど引くなら近くの範囲にする
// zoomFor は範囲を余白込みで収める拡大率。地図が求める
export function chooseFocusBounds(
  guide: RouteGuide,
  zoomFor: (bounds: Bounds) => number | undefined,
): { bounds: Bounds | null; includesDestination: boolean } {
  if (guide.wideBounds) {
    const zoom = zoomFor(guide.wideBounds);
    if (zoom !== undefined && zoom >= READABLE_FOCUS_ZOOM)
      return { bounds: guide.wideBounds, includesDestination: true };
  }
  return { bounds: guide.bounds, includesDestination: false };
}
