import type { DurationDist, TrainsAheadCount, TrainType } from "@repo/schema";
import {
  DEFAULT_STATION_PLATFORM,
  DEFAULT_TRAIN_QUEUE_PARAMS,
  OPERATION_PATTERNS,
  type OperationPattern,
  STATION_PLATFORMS_BY_LINE,
  type StationPlatform,
  TRAIN_QUEUE_PARAMS_BY_OPERATOR,
  TRAINS_AHEAD_COUNT,
  type TrainQueueParams,
} from "../params/train-queue.ts";
import { addMinutesToIso } from "./time.ts";

// 駅間に止まった列車が、ホームに着ける駅に着く時刻の見込み
// 詰める事業者では、止まっている間に前の列車から順に前の駅へ進める動きを追う
// 前の列車は順番を追い越せず、その種別が着けるホームのある駅にしか入れない

export type ConcreteTrainType = Exclude<TrainType, "unknown">;

// 自分の前の駅。次の駅から順に並べる
export type StationAhead = {
  name: string;
  // 1 つ前の駅からの走行時間（分）。先頭はいまの駅間の走行時間
  rideMinutesFromPrevious: number;
  platform: StationPlatform;
};

export type TrainQueueInput = {
  now: string;
  // 運転再開までの残り（分）。初列車待ちを含まない。分からなければ null
  untilResume: DurationDist | null;
  ownTrainType: TrainType | null;
  // 前に止まっている列車の種別。近い順。空なら前に列車はいない。並びが分からなければ null
  trainsAhead: readonly TrainType[] | null;
  // 並びが分からないときの本数の目安
  trainsAheadCount: TrainsAheadCount | null;
  stationsAhead: readonly StationAhead[];
  params: TrainQueueParams;
};

// 遅れる理由。前の列車がその駅に入れない、自分の種別がその駅に止まれない、その駅のホームがふさがっている
export type TrainQueueDelay =
  | { kind: "ahead_cannot_enter"; trainType: ConcreteTrainType; station: string }
  | { kind: "own_cannot_stop"; station: string }
  | { kind: "station_full"; station: string };

export type TrainQueueOutcome = {
  // 自分の列車がホームに着けて降りられる駅
  alightStation: string;
  // その駅に着く時刻。再開の見込みも詰める動きも無ければ null
  arrival: { p50: string; p80: string } | null;
  // 再開の前に、詰める動きでその駅に着けるか
  beforeResume: boolean;
  trainsAheadCount: number;
  delays: TrainQueueDelay[];
};

// 種別が分からない列車は普通として控えめに扱う
export function normalizeTrainType(type: TrainType | null): ConcreteTrainType {
  return type === null || type === "unknown" ? "local" : type;
}

// 路線と先の駅の並びから、その方面の運転パターンを引く。無ければ null
export function findOperationPattern(
  lineId: string | null,
  stationsAheadNames: readonly string[],
): OperationPattern | null {
  if (lineId === null) return null;
  const found = OPERATION_PATTERNS.find(
    (p) => p.lineId === lineId && p.towardStations.some((s) => stationsAheadNames.includes(s)),
  );
  return found?.daytime ?? null;
}

// その路線と方面でいちばん多い種別。パターンが無ければ普通
export function inferDefaultOwnTrainType(pattern: OperationPattern | null): ConcreteTrainType {
  if (!pattern) return "local";
  const counts = new Map<ConcreteTrainType, number>();
  for (const type of pattern.sequence) counts.set(type, (counts.get(type) ?? 0) + 1);
  let best: ConcreteTrainType = "local";
  let bestCount = counts.get("local") ?? 0;
  for (const [type, count] of counts) {
    if (count > bestCount) {
      best = type;
      bestCount = count;
    }
  }
  return best;
}

const isLocalGroup = (type: ConcreteTrainType) => type === "local";

// 運転パターンから、自分の前を走る列車の種別を近い順に並べる
// 複々線では同じ線路の列車だけを数える。パターンが無いか、自分の種別がパターンに無ければ null
export function inferTrainsAheadFromPattern(
  pattern: OperationPattern | null,
  ownTrainType: TrainType | null,
  limit = 3,
): ConcreteTrainType[] | null {
  if (!pattern) return null;
  const own = normalizeTrainType(ownTrainType);
  const sequence = pattern.separateTracks
    ? pattern.sequence.filter((t) => isLocalGroup(t) === isLocalGroup(own))
    : pattern.sequence;
  const index = sequence.indexOf(own);
  if (index < 0 || sequence.length === 0) return null;
  const ahead: ConcreteTrainType[] = [];
  for (let k = 1; k <= limit; k++) {
    const type = sequence[(((index - k) % sequence.length) + sequence.length) % sequence.length];
    if (type) ahead.push(type);
  }
  return ahead;
}

export function resolveTrainQueueParams(operator: string | null): TrainQueueParams {
  const override = operator ? TRAIN_QUEUE_PARAMS_BY_OPERATOR[operator] : undefined;
  return { ...DEFAULT_TRAIN_QUEUE_PARAMS, ...override };
}

// 駅の「着けるホーム」。表に無い路線や駅は既定を使う
export function resolveStationPlatform(
  lineId: string | null,
  stationName: string,
): StationPlatform {
  const table = lineId ? STATION_PLATFORMS_BY_LINE[lineId] : undefined;
  return table?.[stationName] ?? DEFAULT_STATION_PLATFORM;
}

// 前に詰まっている本数。並びがあればその長さ、無ければ目安から置く
export function countTrainsAhead(
  trainsAhead: readonly TrainType[] | null,
  count: TrainsAheadCount | null,
): number {
  if (trainsAhead !== null) return trainsAhead.length;
  return count === null ? 0 : TRAINS_AHEAD_COUNT[count];
}

function canStop(platform: StationPlatform, type: ConcreteTrainType): boolean {
  return platform.accepts.includes(type);
}

// 自分の種別がホームに着ける最初の駅。無ければ次の駅に置く
function findAlightIndex(stations: readonly StationAhead[], type: ConcreteTrainType): number {
  const index = stations.findIndex((s) => canStop(s.platform, type));
  return index < 0 ? 0 : index;
}

function sumRideMinutes(stations: readonly StationAhead[], toIndex: number): number {
  return stations.slice(0, toIndex + 1).reduce((sum, s) => sum + s.rideMinutesFromPrevious, 0);
}

type CloseUpResult = {
  // 自分の列車が再開前に着ける駅の位置。着けなければ null
  ownIndex: number | null;
  // 前の駅へ進めた列車の本数
  movedCount: number;
  delays: TrainQueueDelay[];
};

// 詰める動きを順に追う。遠い列車から前の駅へ入れ、同じ線路の上では追い越さない
function simulateCloseUp(
  stations: readonly StationAhead[],
  trainsAhead: readonly TrainType[],
  ownType: ConcreteTrainType,
  alightIndex: number,
): CloseUpResult {
  const occupancy = stations.map(() => 0);
  const delays: TrainQueueDelay[] = [];
  // 前の列車が止まった駅より先へは進めない。先頭は一覧の最後の駅まで進める
  let frontLimit = stations.length - 1;
  let movedCount = 0;
  const findSlot = (type: ConcreteTrainType, from: number) => {
    for (let i = from; i <= frontLimit; i++) {
      const station = stations[i];
      if (!station) break;
      if (canStop(station.platform, type) && occupancy[i] !== undefined) {
        if ((occupancy[i] ?? 0) < station.platform.platformsPerDirection) return i;
      }
    }
    return null;
  };
  const nameBlockedStation = (type: ConcreteTrainType): string => {
    const acceptable = stations.slice(0, frontLimit + 1).find((s) => canStop(s.platform, type));
    return acceptable?.name ?? stations[0]?.name ?? "";
  };
  for (let j = trainsAhead.length - 1; j >= 0; j--) {
    const type = normalizeTrainType(trainsAhead[j] ?? null);
    const slot = frontLimit < 0 ? null : findSlot(type, 0);
    if (slot === null) {
      delays.push({
        kind: "ahead_cannot_enter",
        trainType: type,
        station: nameBlockedStation(type),
      });
      return { ownIndex: null, movedCount, delays };
    }
    occupancy[slot] = (occupancy[slot] ?? 0) + 1;
    frontLimit = slot;
    movedCount += 1;
  }
  const ownIndex = frontLimit < alightIndex ? null : findSlot(ownType, alightIndex);
  if (ownIndex === null) {
    const station = stations[Math.min(Math.max(frontLimit, alightIndex), stations.length - 1)];
    if (station) delays.push({ kind: "station_full", station: station.name });
  }
  return { ownIndex, movedCount, delays };
}

function toArrival(now: string, minutes: DurationDist): { p50: string; p80: string } {
  return {
    p50: addMinutesToIso(now, Math.round(minutes.p50)),
    p80: addMinutesToIso(now, Math.round(minutes.p80)),
  };
}

// 自分の列車がホームに着ける駅と、その時刻の見込み
export function estimateTrainQueueArrival(input: TrainQueueInput): TrainQueueOutcome {
  const { stationsAhead: stations, params } = input;
  if (stations.length === 0) throw new RangeError("前の駅が 1 つも無い");
  const ownType = normalizeTrainType(input.ownTrainType);
  const alightIndex = findAlightIndex(stations, ownType);
  const trainsAheadCount = countTrainsAhead(input.trainsAhead, input.trainsAheadCount);
  const delays: TrainQueueDelay[] = [];
  const firstStation = stations[0];
  if (alightIndex > 0 && firstStation) {
    delays.push({ kind: "own_cannot_stop", station: firstStation.name });
  }

  // 再開を待つ経路。前の列車が順に動いたあとに、降りられる駅まで走る
  const resumePath = input.untilResume
    ? {
        p50:
          input.untilResume.p50 +
          trainsAheadCount * params.minutesPerTrainAhead +
          sumRideMinutes(stations, alightIndex),
        p80:
          input.untilResume.p80 +
          trainsAheadCount * params.minutesPerTrainAhead +
          sumRideMinutes(stations, alightIndex),
      }
    : null;

  // 詰める経路。並びが分からなければ、本数ぶんの普通が前にいるとみなす
  const sequence =
    input.trainsAhead ?? Array.from({ length: trainsAheadCount }, (): TrainType => "unknown");
  const closeUp = params.closesUp
    ? simulateCloseUp(stations, sequence, ownType, alightIndex)
    : null;
  const closeUpPath =
    closeUp && closeUp.ownIndex !== null
      ? {
          index: closeUp.ownIndex,
          p50:
            params.closeUpLeadMinutes.p50 +
            closeUp.movedCount * params.minutesPerTrainAhead +
            sumRideMinutes(stations, closeUp.ownIndex),
          p80:
            params.closeUpLeadMinutes.p80 +
            closeUp.movedCount * params.minutesPerTrainAhead +
            sumRideMinutes(stations, closeUp.ownIndex),
        }
      : null;
  if (closeUp) delays.push(...closeUp.delays);

  const alightStationName = (index: number) => stations[index]?.name ?? "";
  const useCloseUp =
    closeUpPath !== null && (resumePath === null || closeUpPath.p50 < resumePath.p50);
  if (useCloseUp && closeUpPath) {
    return {
      alightStation: alightStationName(closeUpPath.index),
      arrival: toArrival(input.now, closeUpPath),
      beforeResume: true,
      trainsAheadCount,
      delays,
    };
  }
  return {
    alightStation: alightStationName(alightIndex),
    arrival: resumePath ? toArrival(input.now, resumePath) : null,
    beforeResume: false,
    trainsAheadCount,
    delays,
  };
}
