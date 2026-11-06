import {
  type BetweenPositionCandidate,
  findPositionCandidates,
  type LonLat,
  POSITION_THRESHOLDS,
  type PositionCandidate,
  type StationNode,
} from "@repo/geo";
import type { OriginLine } from "@/features/judgment/session";
import type { StationChoice, StationGroup } from "@/features/stations/catalog";
import {
  type EntryDirection,
  listEntryDirections,
  listNearbyStops,
  pickFallbackStop,
} from "./directions";
import { type EntryData, type EntryLine, listGroupLines } from "./entry-places";

// 現在地から読み取った候補を、入口で 1 回押せば確定できる形にする。位置は端末の外へ出さない

// 画面に並べる候補の上限
export const GPS_CHOICE_LIMIT = 3;

// 駅の間の 2 駅。路線の駅の並びの順で、進む向きはまだ決めない
export type GpsSegment = { from: string; to: string };

export type GpsChoice =
  | { kind: "station"; key: string; choice: StationChoice; distanceMeters: number }
  | {
      kind: "between";
      key: string;
      // from の駅から見た路線
      line: EntryLine;
      from: StationChoice;
      to: StationChoice;
      distanceMeters: number;
    };

export type GpsPoint = { lat: number; lon: number; accuracy: number };

// 進む向きを決めた駅の間。line は手前の駅から見た路線で、direction の先頭が次の駅
export type SegmentTravel = { line: OriginLine; direction: EntryDirection };

// 2 駅の両方に通る、同じ路線の呼び名。JR の通称は境目の駅で 2 つ出るので、両側で共通のものを選ぶ
function pickSegmentLine(
  data: EntryData,
  lineId: string,
  from: StationNode,
  to: StationNode,
): EntryLine | null {
  const lineOf = (node: StationNode) => {
    const group = findGroup(data, node);
    return group ? listGroupLines(data, group).filter((l) => l.lineId === lineId) : [];
  };
  const fromLines = lineOf(from);
  const toNames = new Set(lineOf(to).map((l) => l.observedName));
  return fromLines.find((l) => toNames.has(l.observedName)) ?? fromLines[0] ?? null;
}

function findGroup(data: EntryData, node: StationNode): StationGroup | undefined {
  const id = data.catalog.groupIdByStationId.get(node.stationId);
  return id ? data.catalog.groupById.get(id) : undefined;
}

// 位置と精度から、近い順に最大 GPS_CHOICE_LIMIT 個の候補を返す
export function listGpsChoices(
  data: EntryData,
  nodes: readonly StationNode[],
  point: GpsPoint,
  limit = GPS_CHOICE_LIMIT,
): GpsChoice[] {
  return convertCandidates(data, findCandidates(data, nodes, point)).slice(0, limit);
}

// 描いた線は駅を結ぶ直線から離れて曲がる。塚本〜尼崎で約650m 離れるので、押した線の駅の間はこの幅で探す
const TRACK_GAP_METERS = 800;

// 最初の地図で線を押したときの候補。駅は印が受け持つので、押した線の駅の間だけを近い順に返す
// lineIds は指の下に描かれていた路線で、描いた線が近い順。reachMeters は押せる大きさ 44px を地図の距離に直した値
// 路線ごとに一番近い駅の間を 1 つ出す
export function listLineTapChoices(
  data: EntryData,
  nodes: readonly StationNode[],
  point: { lat: number; lon: number },
  reachMeters: number,
  lineIds: readonly string[],
  limit = GPS_CHOICE_LIMIT,
): GpsChoice[] {
  const lines = data.index.listLines().filter((l) => lineIds.includes(l.lineId));
  const accuracy = Math.min(
    Math.max(reachMeters, TRACK_GAP_METERS),
    POSITION_THRESHOLDS.maxAccuracyMeters,
  );
  const between = findPositionCandidates(
    { nodes, lines },
    { lonLat: [point.lon, point.lat], accuracyMeters: accuracy },
  ).filter((c): c is BetweenPositionCandidate => c.kind === "between");
  // 並べる順は、描いた線が押した点に近い順。駅を結ぶ直線は描いた線から離れるので、順には使わない
  const nearestPerLine = between
    .filter((c, i) => between.findIndex((o) => o.line.lineId === c.line.lineId) === i)
    .sort((a, b) => lineIds.indexOf(a.line.lineId) - lineIds.indexOf(b.line.lineId));
  return convertCandidates(data, nearestPerLine).slice(0, limit);
}

// 2 つの駅名で選ぶときに並べる候補の上限
export const STATION_PAIR_LIMIT = 8;

// 区間の中で、first の駅から second の駅までの駅の並び。環状なら短い回り方にする。通らなければ null
function traceStationPath(
  ids: readonly string[],
  loop: boolean,
  groupOf: (id: string) => string | undefined,
  first: string,
  second: string,
): string[] | null {
  const n = ids.length;
  const walk = (i: number, step: number, count: number) =>
    Array.from({ length: count + 1 }, (_, k) => ids[(((i + k * step) % n) + n) % n] as string);
  let best: string[] | null = null;
  for (let i = 0; i < n; i++) {
    if (groupOf(ids[i] as string) !== first) continue;
    for (let j = 0; j < n; j++) {
      if (i === j || groupOf(ids[j] as string) !== second) continue;
      const step = i < j ? 1 : -1;
      const gap = Math.abs(j - i);
      const options = loop ? [walk(i, step, gap), walk(i, -step, n - gap)] : [walk(i, step, gap)];
      for (const path of options) if (!best || path.length < best.length) best = path;
    }
  }
  return best;
}

// 2 つの駅名から駅の間の候補を出す。隣り合う路線を先に並べ、間に駅があればその並びを出す
// 並走する路線はどれも出して選ばせる。from は 1 つ目の駅の側にする
export function listStationPairChoices(
  data: EntryData,
  nodes: readonly StationNode[],
  first: StationChoice,
  second: StationChoice,
  limit = STATION_PAIR_LIMIT,
): GpsChoice[] {
  if (first.id === second.id) return [];
  const nodeById = new Map(nodes.map((n) => [n.stationId, n]));
  const groupOf = (id: string) => data.catalog.groupIdByStationId.get(id);
  const paths = data.index.listLines().flatMap((line) => {
    const found = line.segments
      .map((segment) =>
        traceStationPath(segment.stationIds, segment.loop, groupOf, first.id, second.id),
      )
      .filter((path): path is string[] => path !== null)
      .sort((a, b) => a.length - b.length);
    return found[0] ? [{ line, path: found[0] }] : [];
  });
  paths.sort((a, b) => a.path.length - b.path.length);
  const candidates: BetweenPositionCandidate[] = paths.flatMap(({ line, path }) =>
    path.slice(1).flatMap((toId, i) => {
      const from = nodeById.get(path[i] as string);
      const to = nodeById.get(toId);
      return from && to ? [{ kind: "between" as const, line, from, to, distanceMeters: 0 }] : [];
    }),
  );
  return convertCandidates(data, candidates).slice(0, limit);
}

function findCandidates(
  data: EntryData,
  nodes: readonly StationNode[],
  point: GpsPoint,
): PositionCandidate[] {
  const lonLat: LonLat = [point.lon, point.lat];
  return findPositionCandidates(
    { nodes, lines: data.index.listLines() },
    { lonLat, accuracyMeters: point.accuracy },
  );
}

// 位置の候補を、1 回押せば確定できる形にする。同じ候補は 1 つにまとめる
function convertCandidates(data: EntryData, candidates: PositionCandidate[]): GpsChoice[] {
  const choices: GpsChoice[] = [];
  for (const c of candidates) {
    if (c.kind === "station") {
      const choice = findGroup(data, c.station)?.choice;
      if (choice)
        choices.push({
          kind: "station",
          key: `station:${choice.id}`,
          choice,
          distanceMeters: c.distanceMeters,
        });
      continue;
    }
    const from = findGroup(data, c.from)?.choice;
    const to = findGroup(data, c.to)?.choice;
    const line = pickSegmentLine(data, c.line.lineId, c.from, c.to);
    if (from && to && line)
      choices.push({
        kind: "between",
        key: `between:${line.lineId}:${from.id}:${to.id}`,
        line,
        from,
        to,
        distanceMeters: c.distanceMeters,
      });
  }
  return choices.filter((c, i) => choices.findIndex((other) => other.key === c.key) === i);
}

// 駅の名前の位置に置いた路線
function placeLine(data: EntryData, line: OriginLine, name: string): OriginLine | null {
  const choice = data.catalog.groupById.get(name)?.choice;
  if (!choice) return null;
  const placed = { ...line, stationName: choice.name, stationNameEn: choice.nameEn };
  return placed;
}

// 次の駅で路線が分かれるなら、分かれた先ごとに方面を足す。手前の駅からの方面が通る先は足さない
function listBranchDirections(
  data: EntryData,
  aheadLine: OriginLine,
  main: EntryDirection[],
  behind: string,
): EntryDirection[] {
  const aheadDirections = listEntryDirections(data, aheadLine);
  const [first] = aheadDirections;
  const here = first
    ? listNearbyStops(data, aheadLine, aheadDirections, first).find(
        (s) => s.choice.name === aheadLine.stationName,
      )
    : undefined;
  if (!here) return [];
  return aheadDirections.flatMap((d) => {
    const next = d.stops[0];
    if (!next || next.choice.name === behind) return [];
    if (main.some((m) => m.stops[1]?.choice.id === next.choice.id)) return [];
    const stops = [here, ...d.stops];
    const fallback = pickFallbackStop(stops);
    return fallback ? [{ ...d, stops, fallback }] : [];
  });
}

// 駅の間を通る向きと方面の組をすべて返す。line は手前の駅に置き、方面の先頭が次の駅
export function listSegmentTravels(
  data: EntryData,
  line: OriginLine,
  segment: GpsSegment,
): SegmentTravel[] {
  const orientations: [string, string][] = [
    [segment.from, segment.to],
    [segment.to, segment.from],
  ];
  return orientations.flatMap(([behind, ahead]) => {
    const behindLine = placeLine(data, line, behind);
    const aheadLine = placeLine(data, line, ahead);
    if (!behindLine || !aheadLine) return [];
    const main = listEntryDirections(data, behindLine).filter(
      (d) => d.stops[0]?.choice.name === ahead,
    );
    return [...main, ...listBranchDirections(data, aheadLine, main, behind)].map((direction) => ({
      line: behindLine,
      direction,
    }));
  });
}

// 方面の段に出す方面。駅の間の両端から、その駅の間を通る向きだけを出す
export function listSegmentDirections(
  data: EntryData,
  line: OriginLine,
  segment: GpsSegment,
): EntryDirection[] {
  return listSegmentTravels(data, line, segment).map((t) => t.direction);
}

// 行き先から進む向きを決める。行き先が一方の向きの先にだけあるときに決まる
// 同じ向きの方面が複数当たっても駅の間の位置は同じなので、最初の方面で決める
export function inferSegmentTravel(
  travels: SegmentTravel[],
  destination: StationChoice,
): SegmentTravel | null {
  const matching = travels.filter((t) =>
    t.direction.stops.some((s) => s.choice.id === destination.id),
  );
  const [first] = matching;
  return first && matching.every((t) => t.line.stationName === first.line.stationName)
    ? first
    : null;
}

// 方面の段で選んだ方面を、駅の間を通る向きに対応づける。通らない方面なら null
export function resolveSegmentTravel(
  travels: SegmentTravel[],
  chosen: EntryDirection,
): SegmentTravel | null {
  return (
    travels.find((t) => t.direction === chosen) ??
    travels.find(
      (t) =>
        t.direction.key === chosen.key &&
        t.direction.stops[0]?.choice.id === chosen.stops[0]?.choice.id,
    ) ??
    null
  );
}
