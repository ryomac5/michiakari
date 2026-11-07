import type { Router } from "@repo/geo";
import type { RouteLeg } from "@repo/schema";
import type { FeatureCollection, LineStringGeometry } from "@/features/map/scene";
import type { TrackParts } from "@/features/map/track-shape";
import type { StationChoice } from "@/features/stations/catalog";
import type { EntryDirection } from "./directions";
import type { EntryData, EntryLine, Position } from "./entry-places";
import { buildSegmentPath } from "./map-pick";

// 今いる所から行き先までを、乗る区間ごとに線路の形で切り出して光らせるための純粋な計算
// 線は進む向きに並べる。地図は線の始まりから終わりへ光を流し、向きを見せる

// 乗る区間。points は通る駅の点を進む順に並べたもの
export type RideSpan = { lineId: string; points: Position[] };

export type RouteGlow = FeatureCollection<LineStringGeometry, { key: string; color: string }>;

// 駅の通る路線。同じ名前の駅がまとめた駅の路線をすべて返す
function listStationLines(data: EntryData, choiceId: string): string[] {
  const group = data.catalog.groupById.get(choiceId);
  return (group?.stationIds ?? []).flatMap((id) => {
    const lineId = data.index.getStation(id)?.lineId;
    return lineId ? [lineId] : [];
  });
}

// 路線の上の駅の位置。路線に無ければ null
function findLinePosition(data: EntryData, lineId: string, choiceId: string): Position | null {
  const group = data.catalog.groupById.get(choiceId);
  const node = (group?.stationIds ?? [])
    .map((id) => data.index.getStation(id))
    .find((n) => n?.lineId === lineId);
  return node ? [node.lonLat[0], node.lonLat[1]] : null;
}

// 選んだ方面の先に行き先があれば、出発の駅から行き先までの駅を路線ごとの区間に分ける
// 直通先の駅に入ったら、そこからは直通先の路線の区間にする。行き先が方面の先に無ければ null
export function planDirectionSpans(
  data: EntryData,
  lineId: string,
  origin: StationChoice,
  direction: EntryDirection,
  destinationId: string,
): RideSpan[] | null {
  const end = direction.stops.findIndex((s) => s.choice.id === destinationId);
  if (end < 0) return null;
  const stations = [
    { id: origin.id, position: [origin.lon, origin.lat] as Position },
    ...direction.stops.slice(0, end + 1).map((s) => ({ id: s.choice.id, position: s.position })),
  ];
  const spans: RideSpan[] = [];
  for (let i = 1; i < stations.length; i++) {
    const from = stations[i - 1];
    const to = stations[i];
    if (!from || !to) continue;
    const shared = listStationLines(data, from.id).filter((id) =>
      listStationLines(data, to.id).includes(id),
    );
    const current = spans.at(-1);
    const pairLine =
      [current?.lineId, lineId].find((id) => id && shared.includes(id)) ??
      shared[0] ??
      current?.lineId ??
      lineId;
    // 同じ名前の駅をまとめた位置ではなく、乗る路線の駅の位置で切る。千里線の吹田は JR の吹田とずれる
    const at = (station: { id: string; position: Position }) =>
      findLinePosition(data, pairLine, station.id) ?? station.position;
    if (current && current.lineId === pairLine) current.points.push(at(to));
    else spans.push({ lineId: pairLine, points: [at(from), at(to)] });
  }
  return spans;
}

// 経路探索の乗る区間を、光らせる区間に直す。歩く区間は光らせない
export function planLegSpans(data: EntryData, legs: readonly RouteLeg[]): RideSpan[] {
  return legs.flatMap((leg) => {
    if (leg.mode !== "ride" || !leg.lineId || !leg.fromStationId || !leg.toStationId) return [];
    const from = data.index.getStation(leg.fromStationId);
    const to = data.index.getStation(leg.toStationId);
    if (!from || !to) return [];
    return [{ lineId: leg.lineId, points: [from.lonLat, to.lonLat] as Position[] }];
  });
}

// 線の長さ（m）。関西の範囲での近似
export function measurePathMeters(path: readonly Position[]): number {
  let total = 0;
  for (let i = 1; i < path.length; i++) {
    const a = path[i - 1];
    const b = path[i];
    if (!a || !b) continue;
    const lat = ((a[1] + b[1]) / 2) * (Math.PI / 180);
    total += Math.hypot((b[0] - a[0]) * 111_320 * Math.cos(lat), (b[1] - a[1]) * 111_320);
  }
  return total;
}

// 線を長さの半分の点で切り、後ろの半分を返す。駅の間にいる人の光は、駅の間の中ほどから始める
export function sliceSecondHalf(path: readonly Position[]): Position[] {
  const half = measurePathMeters(path) / 2;
  let walked = 0;
  for (let i = 1; i < path.length; i++) {
    const a = path[i - 1];
    const b = path[i];
    if (!a || !b) continue;
    const step = measurePathMeters([a, b]);
    if (walked + step >= half) {
      const t = step === 0 ? 0 : (half - walked) / step;
      const middle: Position = [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
      return [middle, ...path.slice(i)];
    }
    walked += step;
  }
  return [...path];
}

// 区間の駅の点を、駅の間ごとに線路の形で切り出してつなぐ
function traceSpan(points: readonly Position[], parts: TrackParts | undefined): Position[] {
  const path: Position[] = [];
  for (let i = 1; i < points.length; i++) {
    const from = points[i - 1];
    const to = points[i];
    if (!from || !to) continue;
    const piece = buildSegmentPath(parts, from, to);
    path.push(...(path.length > 0 ? piece.slice(1) : piece));
  }
  return path;
}

// 乗る区間ごとに、光らせる線を作る。startMidway なら最初の駅の間の中ほどから始める
export function buildRouteGlow(
  spans: readonly RideSpan[],
  trackShapes: ReadonlyMap<string, TrackParts> | undefined,
  lineColors: ReadonlyMap<string, string>,
  startMidway = false,
): RouteGlow {
  const features = spans.flatMap((span, i) => {
    const traced = traceSpan(span.points, trackShapes?.get(span.lineId));
    if (i === 0 && startMidway && span.points.length >= 2) {
      const [first, second] = span.points as [Position, Position];
      const head = sliceSecondHalf(buildSegmentPath(trackShapes?.get(span.lineId), first, second));
      const rest = traceSpan(span.points.slice(1), trackShapes?.get(span.lineId));
      traced.splice(0, traced.length, ...head, ...rest.slice(1));
    }
    if (traced.length < 2) return [];
    return [
      {
        type: "Feature" as const,
        geometry: { type: "LineString" as const, coordinates: traced },
        properties: { key: `ride-${i}`, color: lineColors.get(span.lineId) ?? "#626264" },
      },
    ];
  });
  return { type: "FeatureCollection", features };
}

// 光らせる線の始まりと終わり。e2e が今いる所と行き先に合うかを確かめる
export function readRouteEnds(glow: RouteGlow): { start: Position; end: Position } | null {
  const start = glow.features[0]?.geometry.coordinates[0];
  const end = glow.features.at(-1)?.geometry.coordinates.at(-1);
  return start && end ? { start, end } : null;
}

// 環状線の方面は反対側の端で切れている。切れた先は、もう一方の方面の駅を逆にたどってつなぐ
export function extendLoopDirection(
  direction: EntryDirection,
  others: readonly EntryDirection[],
): EntryDirection {
  const other = others.find((d) => d.key !== direction.key);
  if (!other) return direction;
  const seen = new Set(direction.stops.map((s) => s.choice.id));
  const rest = [...other.stops].reverse().filter((s) => !seen.has(s.choice.id));
  return { ...direction, stops: [...direction.stops, ...rest] };
}

// 入口で答えた路線・方面・行き先から、乗る区間を決める
// 行き先が選んだ方面の先にあれば、その方面の駅を順にたどる。環状線では選んだ向きのまま回る
// 無ければ乗り換えを含む経路を探し、選んだ路線に先に乗る経路の乗る区間を使う
export function planEntrySpans(input: {
  data: EntryData;
  router: Router | null;
  line: Pick<EntryLine, "lineId" | "stationName">;
  direction: EntryDirection | null;
  // 環状線なら、選んだ路線のすべての方面
  loopDirections?: readonly EntryDirection[];
  destination: StationChoice;
  departureTime: string;
}): { spans: RideSpan[]; onDirection: boolean } {
  const { data, router, line, destination } = input;
  const direction =
    input.direction && input.loopDirections?.length
      ? extendLoopDirection(input.direction, input.loopDirections)
      : input.direction;
  const origin = data.catalog.groupById.get(line.stationName)?.choice;
  if (!origin || origin.id === destination.id) return { spans: [], onDirection: false };
  const along = direction
    ? planDirectionSpans(data, line.lineId, origin, direction, destination.id)
    : null;
  if (along) return { spans: along, onDirection: true };
  const originId = data.index
    .listStationsOnLine(line.lineId)
    .find((n) => n.name === line.stationName)?.stationId;
  const destinationId = router?.resolveStationId(destination.name) ?? null;
  if (!router || !originId || !destinationId) return { spans: [], onDirection: false };
  const route = router.computeWaitRouteMinutes({
    originStationId: originId,
    destinationStationId: destinationId,
    lineId: line.lineId,
    departureTime: input.departureTime,
  });
  return { spans: route ? planLegSpans(data, route.legs) : [], onDirection: false };
}
