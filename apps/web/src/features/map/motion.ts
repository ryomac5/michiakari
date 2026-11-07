import { computeDistanceMeters, type StationNode } from "@repo/geo";
import type { AfterAlightStep, Place } from "@repo/schema";
import {
  buildPathCoordinates,
  findLinesByName,
  type MapGeo,
  type Position,
  resolvePlacePosition,
  resolveStationByName,
} from "./scene";
import { sliceTrackBetween } from "./track-shape";

// 車内の人の判断を地図で動かして見せるための道筋。表示用の純関数だけを置く
// 列車が次の駅まで動き、そこで降り、その先の経路が光る順に見せる

export type MotionPhase = "idle" | "ride" | "alight" | "route" | "done";

export type InCarMotion = {
  // いまの位置から降りる駅までの線路の上の道筋
  ride: Position[];
  // 降りた後の経路。乗り換え先の路線か、乗ったまま行き先へ向かう路線
  after: Position[][];
  // 列車が走る路線と、降りた後に乗る路線。地図で路線色に塗る
  lineIds: string[];
};

export type InCarMotionInput = {
  here: Position;
  alight: Position;
  // 乗っている路線
  lineId: string | null;
  alightStation: string;
  destination: Place;
  afterAlight: AfterAlightStep | null;
  // 行き先まで乗り続けるか。乗り続けるなら列車は次の駅で止まらず、行き先まで線路に沿って進む
  stay: boolean;
};

// 段ごとの長さ。単位は ms。列車が動き、降りる印が出て、経路が伸びる
export const MOTION_TIMING = { ride: 1800, alight: 500, route: 1400 } as const;
// 流れる模様を動かし続ける長さ。単位は ms。止めた後は矢印で向きを示す
export const FLOW_DURATION_MS = 9000;

// 折れ線の長さ。単位は m
export function measurePathMeters(path: readonly Position[]): number {
  let total = 0;
  for (let i = 1; i < path.length; i++) {
    total += computeDistanceMeters(path[i - 1] as Position, path[i] as Position);
  }
  return total;
}

// 折れ線の始まりから、長さの割合 fraction までの部分
export function slicePathToFraction(path: readonly Position[], fraction: number): Position[] {
  if (path.length < 2) return [...path];
  const f = Math.min(1, Math.max(0, fraction));
  const target = measurePathMeters(path) * f;
  const out: Position[] = [path[0] as Position];
  let walked = 0;
  for (let i = 1; i < path.length; i++) {
    const a = path[i - 1] as Position;
    const b = path[i] as Position;
    const step = computeDistanceMeters(a, b);
    if (walked + step >= target) {
      const t = step > 0 ? (target - walked) / step : 0;
      out.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]);
      return out;
    }
    out.push(b);
    walked += step;
  }
  return out;
}

// 折れ線の上で、長さの割合 fraction の点
export function findPointAtFraction(path: readonly Position[], fraction: number): Position | null {
  if (path.length === 0) return null;
  return slicePathToFraction(path, fraction).at(-1) ?? null;
}

// いまの位置から降りる駅までを、乗っている路線の線路の形から切り出す。切り出せなければ直線にする
function buildRidePath(geo: MapGeo, input: InCarMotionInput): Position[] {
  const parts = input.lineId ? geo.trackShapes?.get(input.lineId) : undefined;
  const sliced = parts ? sliceTrackBetween(parts, input.here, input.alight) : null;
  return sliced && sliced.length >= 2 ? sliced : [input.here, input.alight];
}

// 行き先の駅とみなす、その路線の駅までの距離の上限。単位は m。三ノ宮と神戸三宮のような別の名前の駅を拾う
const NEAR_DESTINATION_METERS = 1500;

// 路線の上で行き先に当たる駅。同じ名前の駅が無ければ、行き先にいちばん近い駅を近ければ使う
function findDestinationOnLine(
  geo: MapGeo,
  lineId: string,
  destination: Place,
): StationNode | undefined {
  const named =
    destination.kind === "station"
      ? resolveStationByName(geo.index, destination.name, [lineId])
      : undefined;
  if (named?.lineId === lineId) return named;
  const target = resolvePlacePosition(geo.index, destination);
  if (!target) return undefined;
  const nearest = geo.nodes
    .filter((n) => n.lineId === lineId)
    .map((node) => ({ node, meters: computeDistanceMeters(node.lonLat, target) }))
    .sort((a, b) => a.meters - b.meters)[0];
  return nearest && nearest.meters <= NEAR_DESTINATION_METERS ? nearest.node : undefined;
}

// 1 つの路線で、乗る駅から行き先までの線路の上の道筋。行き先がその路線に無ければ null
function buildLineToDestination(
  geo: MapGeo,
  lineIds: readonly string[],
  boardStation: string,
  destination: Place,
): { lineId: string; path: Position[] } | null {
  for (const lineId of lineIds) {
    const from = resolveStationByName(geo.index, boardStation, [lineId]);
    const to = findDestinationOnLine(geo, lineId, destination);
    if (from?.lineId !== lineId || to?.lineId !== lineId) continue;
    if (from.stationId === to.stationId) return null;
    const path = buildPathCoordinates(geo, lineId, from, to);
    if (path.length >= 2) return { lineId, path };
  }
  return null;
}

// 降りた後の経路。乗り換えなら乗り換え先の路線で、次の一手が無ければ乗っている路線で行き先まで
// タクシーと徒歩は道を知らないので描かない。駅への直線の点線も引かない
function buildAfterPaths(
  geo: MapGeo,
  input: InCarMotionInput,
): { lineId: string; path: Position[] } | null {
  const step = input.afterAlight;
  if (step === null) {
    return input.lineId
      ? buildLineToDestination(geo, [input.lineId], input.alightStation, input.destination)
      : null;
  }
  if (step.kind !== "transfer" || !step.line) return null;
  const lineIds = findLinesByName(geo.index, step.line).map((l) => l.lineId);
  return buildLineToDestination(
    geo,
    lineIds,
    step.boardStation ?? input.alightStation,
    input.destination,
  );
}

export function buildInCarMotion(geo: MapGeo, input: InCarMotionInput): InCarMotion {
  const after = buildAfterPaths(geo, input);
  const ride = buildRidePath(geo, input);
  // 乗り続けるときは、次の駅から先も同じ列車の道筋としてつなぐ
  if (input.stay) {
    return {
      ride: after ? [...ride, ...after.path.slice(1)] : ride,
      after: [],
      lineIds: [
        ...new Set([...(input.lineId ? [input.lineId] : []), ...(after ? [after.lineId] : [])]),
      ],
    };
  }
  return {
    ride,
    after: after ? [after.path] : [],
    lineIds: [
      ...new Set([...(input.lineId ? [input.lineId] : []), ...(after ? [after.lineId] : [])]),
    ],
  };
}

// 再生を始めてからの時間で、いまの段と段の中の進み具合を 0〜1 で返す
export function selectMotionPhase(elapsedMs: number): { phase: MotionPhase; progress: number } {
  const { ride, alight, route } = MOTION_TIMING;
  if (elapsedMs < ride) return { phase: "ride", progress: easeInOut(elapsedMs / ride) };
  if (elapsedMs < ride + alight) return { phase: "alight", progress: (elapsedMs - ride) / alight };
  if (elapsedMs < ride + alight + route)
    return { phase: "route", progress: easeInOut((elapsedMs - ride - alight) / route) };
  return { phase: "done", progress: 1 };
}

function easeInOut(t: number): number {
  const x = Math.min(1, Math.max(0, t));
  return x < 0.5 ? 2 * x * x : 1 - (-2 * x + 2) ** 2 / 2;
}

// 線を流れて見せる破線の並び。MapLibre の line-dasharray を順に差し替える
export const FLOW_DASH_FRAMES: readonly (readonly number[])[] = [
  [0, 4, 3],
  [0.5, 4, 2.5],
  [1, 4, 2],
  [1.5, 4, 1.5],
  [2, 4, 1],
  [2.5, 4, 0.5],
  [3, 4, 0],
  [0, 0.5, 3, 3.5],
  [0, 1, 3, 3],
  [0, 1.5, 3, 2.5],
  [0, 2, 3, 2],
  [0, 2.5, 3, 1.5],
  [0, 3, 3, 1],
  [0, 3.5, 3, 0.5],
];
