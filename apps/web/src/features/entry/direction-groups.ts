import { type DirectionStop, type EntryDirection, listDirectionCandidates } from "./directions";
import { ROUTE_STOP_LIMIT } from "./map-pick";

// 行き先の候補を方面ごとにまとめる。上りと下りの駅を混ぜずに見せるための純粋な計算

export type DirectionGroup = { direction: EntryDirection; stops: DirectionStop[] };

// 駅を、出発の駅から駅の数が少ない方面に振り分ける。同じ数なら directions の先の方面にする
// 環状線では同じ駅が両方の方面の先にあるので、近い側の方面にだけ置く
function assignStops(
  directions: readonly EntryDirection[],
  pickStops: (direction: EntryDirection) => DirectionStop[],
): DirectionGroup[] {
  const order = (direction: EntryDirection, stop: DirectionStop) =>
    direction.stops.findIndex((s) => s.choice.id === stop.choice.id);
  const owner = new Map<string, { key: string; index: number }>();
  directions.forEach((direction) => {
    for (const stop of pickStops(direction)) {
      const index = order(direction, stop);
      const current = owner.get(stop.choice.id);
      if (!current || index < current.index)
        owner.set(stop.choice.id, { key: direction.key, index });
    }
  });
  return directions
    .map((direction) => ({
      direction,
      stops: pickStops(direction)
        .filter((stop) => owner.get(stop.choice.id)?.key === direction.key)
        .sort((a, b) => order(direction, a) - order(direction, b)),
    }))
    .filter((group) => group.stops.length > 0);
}

// 先に路線を選んだ人に見せる、方面ごとの路線の駅。地図に印を出す駅と同じ数にそろえる
export function groupLineStops(
  directions: readonly EntryDirection[],
  limit = ROUTE_STOP_LIMIT,
): DirectionGroup[] {
  return assignStops(directions, (direction) => direction.stops.slice(0, limit));
}

// 方面を決める前の行き先の候補を、方面ごとに近い順で並べる
export function groupDirectionCandidates(directions: readonly EntryDirection[]): DirectionGroup[] {
  return assignStops(directions, (direction) => listDirectionCandidates(direction));
}

// 押した駅を含むまとまりの方面
export function findGroupDirection(
  groups: readonly DirectionGroup[],
  stationId: string,
): EntryDirection | null {
  return groups.find((g) => g.stops.some((s) => s.choice.id === stationId))?.direction ?? null;
}
