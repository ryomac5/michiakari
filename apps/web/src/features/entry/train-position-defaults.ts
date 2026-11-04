import {
  computeTrackHeadwayMinutes,
  findOperationPattern,
  inferDefaultOwnTrainType,
  inferTrainsAheadFromPattern,
} from "@repo/core";
import type { TrainPosition, TrainsAheadCount, TrainType } from "@repo/schema";
import type { OriginLine } from "@/features/judgment/session";
import type { EntryDirection } from "./directions";

// 駅と駅の間にいる人の既定値。入口では問わずに進み、判断の画面のチップで直せる
// 既定値はここ 1 か所にまとめる

// 前の列車の並びを運転パターンから推し量れないときの、本数の目安の既定
export const DEFAULT_TRAINS_AHEAD_COUNT: TrainsAheadCount = "unknown";

// 判断の画面で次の駅の候補に出す駅の数
export const NEXT_STATION_CANDIDATE_LIMIT = 4;

export type TrainsAheadDefault = {
  trainsAhead: TrainType[] | null;
  trainsAheadCount: TrainsAheadCount | null;
  // 並びを推し量ったときの、同じ線路のふだんの間隔（分）。前の列車はこの間隔で先を走っていたとみなす
  headwayMinutes: number | null;
  // 運転パターンから推し量った並びか
  fromPattern: boolean;
};

// 前の列車の既定の並び。路線と方面の運転パターンから、自分の種別の前を走る列車を近い順に 3 本置く
// パターンが無ければ「分からない」とし、本数の既定の扱いにする
export function inferTrainsAheadDefault(
  lineId: string,
  directionStopNames: readonly string[],
  ownTrainType: TrainType | null,
): TrainsAheadDefault {
  const pattern = findOperationPattern(lineId, directionStopNames);
  const ahead = inferTrainsAheadFromPattern(pattern, ownTrainType);
  return {
    trainsAhead: ahead,
    trainsAheadCount: ahead ? null : DEFAULT_TRAINS_AHEAD_COUNT,
    headwayMinutes: ahead ? computeTrackHeadwayMinutes(pattern, ownTrainType) : null,
    fromPattern: ahead !== null,
  };
}

// 自分の種別の既定。その路線と方面でいちばん多い種別。パターンが無ければ普通
export function inferOwnTrainTypeDefault(
  lineId: string,
  directionStopNames: readonly string[],
): TrainType {
  return inferDefaultOwnTrainType(findOperationPattern(lineId, directionStopNames));
}

export type BetweenStationsDefaults = {
  position: TrainPosition;
  trainsAheadFromPattern: boolean;
};

// 駅と駅の間を選んだときの既定値。次の駅は選んだ駅から方面の向きに 1 つ先の駅
export function buildDefaultBetweenPosition(
  line: Pick<OriginLine, "lineId" | "stationName">,
  direction: EntryDirection,
): BetweenStationsDefaults | null {
  const next = direction.stops[0];
  if (!next) return null;
  const names = direction.stops.map((s) => s.choice.name);
  const ownTrainType = inferOwnTrainTypeDefault(line.lineId, names);
  const ahead = inferTrainsAheadDefault(line.lineId, names, ownTrainType);
  return {
    position: {
      kind: "between_stations",
      nextStation: next.choice.name,
      previousStation: line.stationName,
      trainsAhead: ahead.trainsAhead,
      trainsAheadCount: ahead.trainsAheadCount,
      ownTrainType,
      trainsAheadHeadwayMinutes: ahead.headwayMinutes,
    },
    trainsAheadFromPattern: ahead.fromPattern,
  };
}

// 駅にいる人と、駅に止まっている車内の人の位置
export function buildStationPosition(kind: "at_station" | "on_train_at_station"): TrainPosition {
  return {
    kind,
    nextStation: null,
    previousStation: null,
    trainsAhead: null,
    trainsAheadCount: null,
    ownTrainType: null,
  };
}
