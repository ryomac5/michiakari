import type { DurationDist, TrainsAheadCount, TrainType } from "@repo/schema";
import {
  DEFAULT_STATION_PLATFORM,
  DEFAULT_TRAIN_QUEUE_PARAMS,
  OPERATION_PATTERNS,
  OPERATOR_KEY_ALIASES,
  type OperationPattern,
  STATION_PLATFORMS_BY_LINE,
  type StationPlatform,
  TRAIN_QUEUE_PARAMS_BY_OPERATOR,
  TRAINS_AHEAD_COUNT,
  type TrainQueueParams,
} from "../params/train-queue.ts";
import { addMinutesToIso } from "./time.ts";

// 駅間に止まった列車が、ホームに着ける駅に着く時刻の見込み
// 詰める事業者では、線路の安全が確かめられた後に、前の列車から順に前の駅へ進める動きを追う
// 駅の間では信号機と信号機の間に 1 本ずつ列車が詰まる。前の列車は 1 本ずつ信号の区間を空けて進む
// 前の列車は順番を追い越せず、その種別が着けるホームのある駅にしか入れない
// 前の列車は、利用者が押した並びなら目の前に詰まっているとみなし、
// 運転パターンから推し量った並びなら、ふだんの間隔をあけて先を走っていたとみなす

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
  // 並びを運転パターンから推し量ったときの、同じ線路の運転間隔（分）
  // 値があれば、前の列車はこの間隔をあけて先を走っていたとみなす。null なら目の前に詰まっているとみなす
  trainsAheadHeadwayMinutes: number | null;
  stationsAhead: readonly StationAhead[];
  params: TrainQueueParams;
  // 線路の安全が確かめられたか。再開に向けた放送か、再開の見込みの時刻が出たら true。false なら詰める動きを使わない
  closeUpCleared: boolean;
  // 安全を確かめた区間を次の駅まで進むと案内されたか。true なら事業者を問わず、再開の前に詰める動きで駅へ進む
  // 出典: docs/research/rail-operations/04-weather-regulation.md と 06-stopped-between-stations.md
  proceedToStation?: boolean;
};

// 遅れる理由
// ahead_cannot_stop: 前の列車の種別がその駅に止まれず、駅の手前で動けない
// platform_occupied: その駅のホームに前の列車が止まっていて、入れる場所が無い
// own_cannot_stop: 自分の種別がその駅に止まれず、降りられる駅が先になる
export type TrainQueueDelay =
  | { kind: "ahead_cannot_stop"; trainType: ConcreteTrainType; station: string }
  | { kind: "platform_occupied"; station: string; occupiedBy: ConcreteTrainType }
  | { kind: "own_cannot_stop"; station: string };

export type TrainQueueOutcome = {
  // 自分の列車がホームに着けて降りられる駅
  alightStation: string;
  // その駅に着く時刻。再開の見込みも詰める動きも無ければ null
  arrival: { p50: string; p80: string } | null;
  // 自分の列車が動き出す時刻。着く時刻から、その駅までの走行時間を引いたもの。arrival が null なら null
  departure: { p50: string; p80: string } | null;
  // 再開の前に、詰める動きでその駅に着けるか
  beforeResume: boolean;
  trainsAheadCount: number;
  // 自分の行く手にいて、先に発車するのを待つ前の列車の本数
  blockingCount: number;
  // その本数ぶんの遅れ（分）の中央。乗ったまま待つ場合の到着にも足す
  departureDelayMinutes: number;
  // 前の列車をふだんの間隔で先を走っていたとみなしたか
  spacedByHeadway: boolean;
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

// 複々線では同じ線路の列車だけを数える。自分と同じ線路を走る種別の並びに絞る
function selectSameTrackSequence(
  pattern: OperationPattern,
  own: ConcreteTrainType,
): readonly ConcreteTrainType[] {
  return pattern.separateTracks
    ? pattern.sequence.filter((t) => isLocalGroup(t) === isLocalGroup(own))
    : pattern.sequence;
}

// 運転パターンから、自分の前を走る列車の種別を近い順に並べる
// パターンが無いか、自分の種別がパターンに無ければ null
export function inferTrainsAheadFromPattern(
  pattern: OperationPattern | null,
  ownTrainType: TrainType | null,
  limit = 3,
): ConcreteTrainType[] | null {
  if (!pattern) return null;
  const own = normalizeTrainType(ownTrainType);
  const sequence = selectSameTrackSequence(pattern, own);
  const index = sequence.indexOf(own);
  if (index < 0 || sequence.length === 0) return null;
  const ahead: ConcreteTrainType[] = [];
  for (let k = 1; k <= limit; k++) {
    const type = sequence[(((index - k) % sequence.length) + sequence.length) % sequence.length];
    if (type) ahead.push(type);
  }
  return ahead;
}

// 運転パターンから、自分と同じ線路の列車どうしのふだんの間隔（分）。パターンに無い種別なら null
export function computeTrackHeadwayMinutes(
  pattern: OperationPattern | null,
  ownTrainType: TrainType | null,
): number | null {
  if (!pattern) return null;
  const sequence = selectSameTrackSequence(pattern, normalizeTrainType(ownTrainType));
  if (sequence.length === 0) return null;
  return pattern.cycleMinutes / sequence.length;
}

function simplifyOperatorName(name: string): string {
  return name
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[\s\-_・]/g, "");
}

// 事業者名か事業者キーを、路線 ID の先頭と同じ事業者キーにそろえる。表に無ければ null
export function normalizeOperatorKey(operator: string | null): string | null {
  if (!operator) return null;
  const simple = simplifyOperatorName(operator);
  const found = Object.entries(OPERATOR_KEY_ALIASES).find(([, aliases]) =>
    aliases.some((a) => simplifyOperatorName(a) === simple),
  );
  return found?.[0] ?? null;
}

// 路線 ID「jr-west.東海道線」から事業者キーを引く
export function findLineOperatorKey(lineId: string | null): string | null {
  if (!lineId) return null;
  const key = lineId.slice(0, lineId.indexOf("."));
  return key.length > 0 ? key : null;
}

// 事業者名か事業者キーから、詰める動きの値を引く
export function resolveTrainQueueParams(operator: string | null): TrainQueueParams {
  const key = normalizeOperatorKey(operator) ?? operator;
  const override = key ? TRAIN_QUEUE_PARAMS_BY_OPERATOR[key] : undefined;
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
  return Math.max(0, index);
}

function sumRideMinutes(stations: readonly StationAhead[], toIndex: number): number {
  return stations.slice(0, toIndex + 1).reduce((sum, s) => sum + s.rideMinutesFromPrevious, 0);
}

// 前の列車 1 本。minIndex は、その列車が詰めるときに入れる最初の駅の位置
// 目の前に詰まっている列車は 0。ふだんの間隔で先を走っていた列車は、間隔ぶん走った先の駅
type QueuedTrain = { type: ConcreteTrainType; minIndex: number };

// 前の列車を線路の上に置く。近い順
// 間隔があれば、近い順に k 本目は k × 間隔の分だけ先にいたとみなし、走行時間の積み上げでどの駅の手前かに直す
// 一覧の先より遠い列車は、自分の行く手にいないので外す
function placeTrainsAhead(
  trainsAhead: readonly TrainType[],
  headwayMinutes: number | null,
  stations: readonly StationAhead[],
): QueuedTrain[] {
  const placed: QueuedTrain[] = [];
  trainsAhead.forEach((raw, index) => {
    const type = normalizeTrainType(raw);
    if (headwayMinutes === null) {
      placed.push({ type, minIndex: 0 });
      return;
    }
    const distance = (index + 1) * headwayMinutes;
    const minIndex = stations.findIndex((_, i) => sumRideMinutes(stations, i) >= distance);
    if (minIndex >= 0) placed.push({ type, minIndex });
  });
  return placed;
}

type CloseUpResult = {
  // 自分の列車が再開前に着ける駅の位置。着けなければ null
  ownIndex: number | null;
  // 目の前に詰まっていて、自分より先に前の駅へ進めた列車の本数
  movedBlockingCount: number;
  delays: TrainQueueDelay[];
};

// 詰める動きを順に追う。遠い列車から前の駅へ入れ、同じ線路の上では追い越さない
function simulateCloseUp(
  stations: readonly StationAhead[],
  queue: readonly QueuedTrain[],
  ownType: ConcreteTrainType,
  alightIndex: number,
): CloseUpResult {
  const occupants: ConcreteTrainType[][] = stations.map(() => []);
  const delays: TrainQueueDelay[] = [];
  // 前の列車が止まった駅より先へは進めない。先頭は一覧の最後の駅まで進める
  let frontLimit = stations.length - 1;
  let movedBlockingCount = 0;
  const findSlot = (type: ConcreteTrainType, from: number): number | null => {
    for (let i = from; i <= frontLimit; i++) {
      const station = stations[i];
      const held = occupants[i];
      if (!station || !held) break;
      if (canStop(station.platform, type) && held.length < station.platform.platformsPerDirection) {
        return i;
      }
    }
    return null;
  };
  // 入れなかった理由。入れる種別の駅が範囲に無ければ止まれない、あればホームがふさがっている
  const explainBlocked = (type: ConcreteTrainType, from: number): TrainQueueDelay | null => {
    const nextStation = stations[Math.min(from, stations.length - 1)];
    if (!nextStation) return null;
    const acceptableIndex = stations.findIndex(
      (s, i) => i >= from && i <= frontLimit && canStop(s.platform, type),
    );
    if (acceptableIndex < 0) {
      return { kind: "ahead_cannot_stop", trainType: type, station: nextStation.name };
    }
    const station = stations[acceptableIndex];
    const occupiedBy = occupants[acceptableIndex]?.[0];
    return station && occupiedBy
      ? { kind: "platform_occupied", station: station.name, occupiedBy }
      : null;
  };
  for (let j = queue.length - 1; j >= 0; j--) {
    const train = queue[j];
    if (!train) continue;
    // 先の列車がつかえていて動けない。理由は先の列車のものに含まれている
    if (frontLimit < train.minIndex) continue;
    const slot = findSlot(train.type, train.minIndex);
    if (slot === null) {
      const reason = explainBlocked(train.type, train.minIndex);
      if (reason) delays.push(reason);
      // 入れなかった列車はその駅の手前に残る。より近い列車と自分は、その手前の駅までしか進めない
      frontLimit = train.minIndex - 1;
      continue;
    }
    occupants[slot]?.push(train.type);
    frontLimit = slot;
    if (train.minIndex === 0) movedBlockingCount += 1;
  }
  if (frontLimit < alightIndex) {
    // 降りたい駅より手前で前の列車が止まっている。その駅のホームがふさがっていて先へ進めない
    const station = stations[frontLimit];
    const occupiedBy = occupants[frontLimit]?.[0];
    if (frontLimit >= 0 && station && occupiedBy) {
      delays.push({ kind: "platform_occupied", station: station.name, occupiedBy });
    }
    return { ownIndex: null, movedBlockingCount, delays };
  }
  const ownIndex = findSlot(ownType, alightIndex);
  if (ownIndex !== null) {
    // 再開前に着けるなら、先の列車の事情は自分の遅れにならない
    return { ownIndex, movedBlockingCount, delays: [] };
  }
  const reason = explainBlocked(ownType, alightIndex);
  if (reason) delays.push(reason);
  return { ownIndex: null, movedBlockingCount, delays };
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
  const spacedByHeadway = input.trainsAhead !== null && input.trainsAheadHeadwayMinutes !== null;
  const delays: TrainQueueDelay[] = [];
  const firstStation = stations[0];
  if (alightIndex > 0 && firstStation) {
    delays.push({ kind: "own_cannot_stop", station: firstStation.name });
  }

  // 前の列車を線路の上に置く。並びが分からなければ、本数ぶんの普通が目の前に詰まっているとみなす
  const sequence =
    input.trainsAhead ?? Array.from({ length: trainsAheadCount }, (): TrainType => "unknown");
  const queue = placeTrainsAhead(
    sequence,
    spacedByHeadway ? input.trainsAheadHeadwayMinutes : null,
    stations,
  );
  // 自分の行く手にいて、先に発車するのを待つ列車。降りる駅かその手前にいる列車を数える
  const blockingCount = queue.filter((t) => t.minIndex <= alightIndex).length;
  const perTrain = params.minutesPerTrainAhead;
  const departureDelayMinutes = blockingCount * perTrain.p50;

  // 再開を待つ経路。行く手の列車が順に発車したあとに、降りられる駅まで走る
  const resumePath = input.untilResume
    ? {
        p50:
          input.untilResume.p50 +
          blockingCount * perTrain.p50 +
          sumRideMinutes(stations, alightIndex),
        p80:
          input.untilResume.p80 +
          blockingCount * perTrain.p80 +
          sumRideMinutes(stations, alightIndex),
      }
    : null;

  // 詰める経路。安全が確かめられたいまから、目の前に詰まっていた列車が前の駅へ進んだあとに、自分も進む
  const closeUp =
    (params.closesUp && input.closeUpCleared) || input.proceedToStation === true
      ? simulateCloseUp(stations, queue, ownType, alightIndex)
      : null;
  const closeUpPath =
    closeUp && closeUp.ownIndex !== null
      ? {
          index: closeUp.ownIndex,
          p50:
            closeUp.movedBlockingCount * perTrain.p50 + sumRideMinutes(stations, closeUp.ownIndex),
          p80:
            closeUp.movedBlockingCount * perTrain.p80 + sumRideMinutes(stations, closeUp.ownIndex),
        }
      : null;
  if (closeUp) delays.push(...closeUp.delays);

  const alightStationName = (index: number) => stations[index]?.name ?? "";
  const useCloseUp =
    closeUpPath !== null && (resumePath === null || closeUpPath.p50 < resumePath.p50);
  if (useCloseUp && closeUpPath) {
    const ride = sumRideMinutes(stations, closeUpPath.index);
    return {
      alightStation: alightStationName(closeUpPath.index),
      arrival: toArrival(input.now, closeUpPath),
      departure: toArrival(input.now, {
        p50: closeUpPath.p50 - ride,
        p80: closeUpPath.p80 - ride,
      }),
      beforeResume: true,
      trainsAheadCount,
      blockingCount,
      departureDelayMinutes,
      spacedByHeadway,
      delays,
    };
  }
  return {
    alightStation: alightStationName(alightIndex),
    arrival: resumePath ? toArrival(input.now, resumePath) : null,
    departure: resumePath
      ? toArrival(input.now, {
          p50: resumePath.p50 - sumRideMinutes(stations, alightIndex),
          p80: resumePath.p80 - sumRideMinutes(stations, alightIndex),
        })
      : null,
    beforeResume: false,
    trainsAheadCount,
    blockingCount,
    departureDelayMinutes,
    spacedByHeadway,
    delays,
  };
}
