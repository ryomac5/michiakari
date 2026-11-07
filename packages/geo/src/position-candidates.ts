import { computeDistanceMeters } from "./distance.ts";
import type { LineInfo, LonLat, StationNode } from "./types.ts";

// 端末の位置と精度から、いる駅か、乗っている路線の駅の間を推定する。位置は端末の中だけで使う

// どの値も GPS の誤差から決めた値で、規制値や社内の数値ではない
export const POSITION_THRESHOLDS = {
  // 駅にいるとみなす駅の代表点からの距離（m）。ホームの長さと GPS の誤差を見込む
  stationMeters: 200,
  // 線の上にいるとみなす線からの距離（m）。駅を結ぶ直線と線路のずれと GPS の誤差を見込む
  lineMeters: 150,
  // 精度の値はしきい値に足す。これより粗い位置は候補を出さない
  maxAccuracyMeters: 1000,
} as const;

export type PositionQuery = {
  lonLat: LonLat;
  // 端末が返す精度（m）。位置がこの半径のどこかにある
  accuracyMeters: number;
};

export type StationPositionCandidate = {
  kind: "station";
  station: StationNode;
  distanceMeters: number;
};

// from と to は路線の駅の並びの順。進む向きはここでは決めない
export type BetweenPositionCandidate = {
  kind: "between";
  line: LineInfo;
  from: StationNode;
  to: StationNode;
  // 2 駅を結ぶ直線までの距離（m）
  distanceMeters: number;
};

export type PositionCandidate = StationPositionCandidate | BetweenPositionCandidate;

export type PositionNetwork = {
  nodes: readonly StationNode[];
  lines: readonly LineInfo[];
};

const METERS_PER_DEGREE = 111_320;

// 問い合わせ点を原点にした平面の座標（m）。駅の間の長さなら十分な近似
function projectMeters(origin: LonLat, point: LonLat): [number, number] {
  const scale = Math.cos((origin[1] * Math.PI) / 180);
  return [
    (point[0] - origin[0]) * METERS_PER_DEGREE * scale,
    (point[1] - origin[1]) * METERS_PER_DEGREE,
  ];
}

// 原点から線分 a-b への最短距離
function measureToSegment(origin: LonLat, a: LonLat, b: LonLat): number {
  const [ax, ay] = projectMeters(origin, a);
  const [bx, by] = projectMeters(origin, b);
  const dx = bx - ax;
  const dy = by - ay;
  const length = Math.hypot(dx, dy);
  const t = length === 0 ? 0 : Math.min(1, Math.max(0, -(ax * dx + ay * dy) / length ** 2));
  return Math.hypot(ax + t * dx, ay + t * dy);
}

// 路線の隣り合う駅の組。環状の区間は末尾から先頭へも結ぶ
function listAdjacentPairs(line: LineInfo): [string, string][] {
  return line.segments.flatMap((segment) => {
    const ids = segment.stationIds;
    const pairs = ids.slice(1).map((id, i): [string, string] => [ids[i] as string, id]);
    const first = ids[0];
    const last = ids.at(-1);
    if (segment.loop && first && last && first !== last) pairs.push([last, first]);
    return pairs;
  });
}

// 2 駅だけの区間で、同じ名前の 2 駅を別の路線の 3 駅以上の区間が隣り合わせに結んでいるものを外す
// 梅田の地下を通る線は、旅客の駅を持たないのに東海道線の大阪〜福島の区間として入っている。駅の間はもう一方の路線で答える
export function removeDuplicatedStubs(
  lines: readonly LineInfo[],
  nodes: readonly StationNode[],
): LineInfo[] {
  const nameById = new Map(nodes.map((n) => [n.stationId, n.name]));
  const keyOf = (a: string, b: string) =>
    [nameById.get(a) ?? a, nameById.get(b) ?? b].sort().join("|");
  const isStub = (segment: LineInfo["segments"][number]) =>
    !segment.loop && segment.stationIds.length === 2;
  // 3 駅以上の区間が結ぶ隣り合う駅の名前の組と、その路線
  const ridden = new Map<string, Set<string>>();
  for (const line of lines) {
    const full = { ...line, segments: line.segments.filter((s) => !isStub(s)) };
    for (const [a, b] of listAdjacentPairs(full)) {
      const key = keyOf(a, b);
      ridden.set(key, (ridden.get(key) ?? new Set()).add(line.lineId));
    }
  }
  return lines.map((line) => ({
    ...line,
    segments: line.segments.filter((segment) => {
      if (!isStub(segment)) return true;
      const [a, b] = segment.stationIds as [string, string];
      const others = [...(ridden.get(keyOf(a, b)) ?? [])].filter((id) => id !== line.lineId);
      return others.length === 0;
    }),
  }));
}

// 駅の候補。同じ名前の駅は最も近い 1 つにまとめる
function listStationCandidates(
  nodes: readonly StationNode[],
  lonLat: LonLat,
  radius: number,
): StationPositionCandidate[] {
  const byName = new Map<string, StationPositionCandidate>();
  for (const station of nodes) {
    const distanceMeters = computeDistanceMeters(lonLat, station.lonLat);
    if (distanceMeters > radius) continue;
    const known = byName.get(station.name);
    if (!known || distanceMeters < known.distanceMeters)
      byName.set(station.name, { kind: "station", station, distanceMeters });
  }
  return [...byName.values()];
}

// 駅の間の候補。線分までの距離だけで決め、駅の近くでも残す
function listBetweenCandidates(
  network: PositionNetwork,
  lonLat: LonLat,
  radius: number,
): BetweenPositionCandidate[] {
  return listBetweenCandidatesWithin(network, lonLat, () => radius);
}

// 2 駅を結ぶ直線までの距離が、駅の間ごとの半径の内にある駅の間を返す
// 地図で線を押したときのように、駅の間の長さや線の曲がりで探す幅を変えたいときに使う。GPS の精度の上限は掛けない
export function listBetweenCandidatesWithin(
  network: PositionNetwork,
  lonLat: LonLat,
  radiusOf: (from: StationNode, to: StationNode) => number,
): BetweenPositionCandidate[] {
  const stationById = new Map(network.nodes.map((n) => [n.stationId, n]));
  const found = new Map<string, BetweenPositionCandidate>();
  for (const line of network.lines) {
    for (const [fromId, toId] of listAdjacentPairs(line)) {
      const from = stationById.get(fromId);
      const to = stationById.get(toId);
      if (!from || !to) continue;
      const distance = measureToSegment(lonLat, from.lonLat, to.lonLat);
      if (distance > radiusOf(from, to)) continue;
      const key = `${line.lineId}|${[fromId, toId].sort().join("|")}`;
      const known = found.get(key);
      if (!known || distance < known.distanceMeters)
        found.set(key, { kind: "between", line, from, to, distanceMeters: distance });
    }
  }
  return [...found.values()];
}

// 位置から、いる駅と駅の間の候補を近い順に返す。距離が同じなら駅を先にする
// 精度が粗いほど広く拾う。当たらなければ空
export function findPositionCandidates(
  network: PositionNetwork,
  query: PositionQuery,
): PositionCandidate[] {
  const accuracy = Number.isFinite(query.accuracyMeters) ? Math.max(0, query.accuracyMeters) : 0;
  if (accuracy > POSITION_THRESHOLDS.maxAccuracyMeters) return [];
  const stations = listStationCandidates(
    network.nodes,
    query.lonLat,
    POSITION_THRESHOLDS.stationMeters + accuracy,
  );
  const between = listBetweenCandidates(
    { nodes: network.nodes, lines: removeDuplicatedStubs(network.lines, network.nodes) },
    query.lonLat,
    POSITION_THRESHOLDS.lineMeters + accuracy,
  );
  return [...stations, ...between].sort(
    (a, b) =>
      a.distanceMeters - b.distanceMeters ||
      Number(a.kind === "between") - Number(b.kind === "between"),
  );
}
