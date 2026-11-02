import {
  computeDistanceMeters,
  type GeoIndex,
  type LineInfo,
  type LonLat,
  type NetworkGraph,
  normalizeSearchText,
  type StationNode,
} from "@repo/geo";
import type { Place, RouteLeg, RouteOption, Section } from "@repo/schema";

// 地図に重ねる GeoJSON を判断の状態から組み立てる。表示用の純関数だけを置く

// 徒歩の到達範囲の概算。packages/core/params/walk.ts と同じ値（core が公開していないため写している）
export const WALK_SPEED_M_PER_MIN = 80;
export const WALK_DETOUR_FACTOR = 1.3;
export const WALK_REACH_MINUTES = [10, 20] as const;

// RouteLeg に追加予定の駅 ID。型に無い間も、届いていれば使う
export type LegStationRefs = {
  fromStationId?: string | null;
  toStationId?: string | null;
  lineId?: string | null;
};

export type Position = [number, number];
export type Bounds = [Position, Position];

type Feature<G, P> = { type: "Feature"; geometry: G; properties: P };
export type FeatureCollection<G, P> = { type: "FeatureCollection"; features: Feature<G, P>[] };
type LineStringGeometry = { type: "LineString"; coordinates: Position[] };
type PointGeometry = { type: "Point"; coordinates: Position };
type PolygonGeometry = { type: "Polygon"; coordinates: Position[][] };

export type RouteMode = "ride" | "walk" | "taxi";
export type PlaceRole = "origin" | "destination";

export type MapScene = {
  origin: Position | null;
  destination: Position | null;
  blockedLineIds: string[];
  blocked: FeatureCollection<LineStringGeometry, { label: string }>;
  reach: FeatureCollection<PolygonGeometry, { minutes: number }>;
  reachableStations: FeatureCollection<
    PointGeometry,
    { stationId: string; name: string; color: string }
  >;
  route: FeatureCollection<LineStringGeometry, { mode: RouteMode }>;
  transferLineIds: string[];
  places: FeatureCollection<PointGeometry, { role: PlaceRole; label: string }>;
  stationLabels: FeatureCollection<
    PointGeometry,
    { name: string; emphasis: boolean; sortKey: number; passengers: number }
  >;
  bounds: Bounds | null;
};

export type MapSceneInput = {
  origin: Place;
  destination: Place;
  options: RouteOption[];
  recommendedOptionId: string | null;
  blockedSection: Section | null;
  // 止まっている路線の名前。分からなければ選択肢の「待つ」経路から推し量る
  blockedLine?: string | null;
};

export type MapSceneLabels = {
  origin: string;
  destination: string;
  blocked: string;
};

export type MapGeo = {
  index: GeoIndex;
  graph: NetworkGraph;
  nodes: readonly StationNode[];
  lineColors: ReadonlyMap<string, string>;
};

const toPosition = (p: LonLat): Position => [p[0], p[1]];

function buildFeatureCollection<G, P>(features: Feature<G, P>[]): FeatureCollection<G, P> {
  return { type: "FeatureCollection", features };
}

function buildLineFeature<P>(coordinates: Position[], properties: P) {
  return {
    type: "Feature" as const,
    geometry: { type: "LineString" as const, coordinates },
    properties,
  };
}

function buildPointFeature<P>(coordinates: Position, properties: P) {
  return {
    type: "Feature" as const,
    geometry: { type: "Point" as const, coordinates },
    properties,
  };
}

export function computeWalkReachMeters(minutes: number): number {
  return (minutes * WALK_SPEED_M_PER_MIN) / WALK_DETOUR_FACTOR;
}

// 路線名の照合。「JR神戸線」は別名、「阪急神戸線」は事業者名＋路線名で一致させる
export function matchLineName(line: LineInfo, name: string): boolean {
  const query = normalizeSearchText(name);
  if (query.length === 0) return false;
  const keys = [line.lineName, ...line.aliases, `${line.operator}${line.lineName}`].map(
    normalizeSearchText,
  );
  if (keys.includes(query)) return true;
  const lineName = normalizeSearchText(line.lineName);
  if (!query.endsWith(lineName) || query === lineName) return false;
  const prefix = query.slice(0, query.length - lineName.length);
  return normalizeSearchText(line.operator).includes(prefix);
}

export function findLinesByName(index: GeoIndex, name: string | null | undefined): LineInfo[] {
  if (!name) return [];
  return index.listLines().filter((line) => matchLineName(line, name));
}

// 駅名から駅を引く。路線の指定に合う駅、表記が完全に同じ駅、乗降客数の多い駅の順に選ぶ
export function resolveStationByName(
  index: GeoIndex,
  name: string,
  lineIds: readonly string[] = [],
): StationNode | undefined {
  const query = normalizeSearchText(name);
  const candidates = index
    .findStationsByName(name, 200)
    .filter((s) => normalizeSearchText(s.name) === query);
  const score = (s: StationNode) =>
    (lineIds.includes(s.lineId) ? 2 : 0) + (s.name === name.replace(/駅$/, "") ? 1 : 0);
  return candidates
    .map((station, order) => ({ station, order }))
    .sort((a, b) => score(b.station) - score(a.station) || a.order - b.order)[0]?.station;
}

function resolveStation(
  index: GeoIndex,
  id: string | null | undefined,
  name: string,
  lineIds: readonly string[],
): StationNode | undefined {
  return (id ? index.getStation(id) : undefined) ?? resolveStationByName(index, name, lineIds);
}

export function resolvePlacePosition(index: GeoIndex, place: Place): Position | null {
  if (place.kind === "coord") return [place.lon, place.lat];
  const station = resolveStationByName(index, place.name);
  return station ? toPosition(station.lonLat) : null;
}

// 同じ路線の隣り合う駅だけをたどり、2 駅間の駅 ID の並びを返す（距離が最短の並び）
export function findStationPathOnLine(
  graph: NetworkGraph,
  lineId: string,
  fromStationId: string,
  toStationId: string,
): string[] | null {
  const dist = new Map<string, number>([[fromStationId, 0]]);
  const prev = new Map<string, string>();
  const queue = [fromStationId];
  const done = new Set<string>();
  while (queue.length > 0) {
    queue.sort((a, b) => (dist.get(a) ?? 0) - (dist.get(b) ?? 0));
    const current = queue.shift() as string;
    if (done.has(current)) continue;
    done.add(current);
    if (current === toStationId) break;
    for (const link of graph.get(current) ?? []) {
      if (link.kind !== "ride" || link.lineId !== lineId) continue;
      const next = (dist.get(current) ?? 0) + link.distanceKm;
      if (next < (dist.get(link.to) ?? Number.POSITIVE_INFINITY)) {
        dist.set(link.to, next);
        prev.set(link.to, current);
        queue.push(link.to);
      }
    }
  }
  if (!done.has(toStationId)) return null;
  const path = [toStationId];
  while (path[0] !== fromStationId) {
    const before = prev.get(path[0] as string);
    if (before === undefined) return null;
    path.unshift(before);
  }
  return path;
}

function buildPathCoordinates(
  geo: MapGeo,
  lineId: string,
  from: StationNode,
  to: StationNode,
): Position[] {
  const ids = findStationPathOnLine(geo.graph, lineId, from.stationId, to.stationId);
  if (ids === null) return [toPosition(from.lonLat), toPosition(to.lonLat)];
  return buildCoordinates(geo, ids);
}

function buildCoordinates(geo: MapGeo, stationIds: readonly string[]): Position[] {
  return stationIds.flatMap((id) => {
    const node = geo.index.getStation(id);
    return node ? [toPosition(node.lonLat)] : [];
  });
}

type ResolvedSection = { lineId: string; coordinates: Position[] };

// 止まっている区間を、路線の駅の並びに沿った折れ線にする
export function buildBlockedSectionPath(
  geo: MapGeo,
  section: Section,
  lineNames: readonly (string | null | undefined)[],
): ResolvedSection | null {
  const hintedLines = lineNames.flatMap((name) => findLinesByName(geo.index, name));
  for (const line of hintedLines) {
    const from = resolveStationByName(geo.index, section.fromStation, [line.lineId]);
    const to = resolveStationByName(geo.index, section.toStation, [line.lineId]);
    if (from?.lineId !== line.lineId || to?.lineId !== line.lineId) continue;
    const ids = findStationPathOnLine(geo.graph, line.lineId, from.stationId, to.stationId);
    if (ids !== null) return { lineId: line.lineId, coordinates: buildCoordinates(geo, ids) };
  }

  // 路線名で引けなければ、2 駅を直接結ぶ路線のうち最短のものを使う
  const from = resolveStationByName(geo.index, section.fromStation);
  const to = resolveStationByName(geo.index, section.toStation);
  if (!from || !to) return null;
  const between = geo.index.listLinesBetween(from.stationId, to.stationId)[0];
  if (!between) return null;
  return {
    lineId: between.line.lineId,
    coordinates: buildPathCoordinates(geo, between.line.lineId, between.from, between.to),
  };
}

type ResolvedLeg = { mode: RouteMode; lineId: string | null; coordinates: Position[] };

function readLegRefs(leg: RouteLeg): LegStationRefs {
  return leg as RouteLeg & LegStationRefs;
}

// 経路の各区間を折れ線にする。駅 ID があれば優先し、無ければ駅名と路線名から引く
export function resolveRouteLegs(geo: MapGeo, option: RouteOption): ResolvedLeg[] {
  const resolved: ResolvedLeg[] = [];
  let cursor: StationNode | undefined;

  for (const leg of option.legs) {
    if (leg.mode === "wait") continue;
    const refs = readLegRefs(leg);
    const lineIds = refs.lineId
      ? [refs.lineId]
      : findLinesByName(geo.index, leg.line).map((l) => l.lineId);
    const from = resolveStation(geo.index, refs.fromStationId, leg.from, lineIds) ?? cursor;
    const to = resolveStation(geo.index, refs.toStationId, leg.to, lineIds);
    // 行き先が引けない区間（タクシー乗り場など）は飛ばし、次の区間を出発駅から描く
    cursor = to ?? from;
    if (!from || !to) continue;

    if (leg.mode === "ride") {
      // 路線の指定に合う駅を優先して引くので、両端が同じ路線ならその路線に沿わせる
      const lineId = from.lineId === to.lineId ? from.lineId : null;
      const coordinates = lineId
        ? buildPathCoordinates(geo, lineId, from, to)
        : [toPosition(from.lonLat), toPosition(to.lonLat)];
      resolved.push({ mode: "ride", lineId, coordinates });
    } else {
      resolved.push({
        mode: leg.mode,
        lineId: null,
        coordinates: [toPosition(from.lonLat), toPosition(to.lonLat)],
      });
    }
  }
  return resolved.filter((leg) => leg.coordinates.length >= 2);
}

// 振替輸送の経路が乗る路線
export function listTransferServiceLineIds(geo: MapGeo, options: RouteOption[]): string[] {
  const ids = options
    .filter((o) => o.isTransferService)
    .flatMap((o) => resolveRouteLegs(geo, o))
    .flatMap((leg) => (leg.mode === "ride" && leg.lineId ? [leg.lineId] : []));
  return [...new Set(ids)];
}

// 中心から半径 meters の円を多角形で近似する
export function buildCirclePolygon(center: Position, meters: number, steps = 64): Position[] {
  const [lon, lat] = center;
  const metersPerDegLat = 111_320;
  const metersPerDegLon = metersPerDegLat * Math.cos((lat * Math.PI) / 180);
  const ring: Position[] = [];
  for (let i = 0; i <= steps; i++) {
    const angle = (2 * Math.PI * (i % steps)) / steps;
    ring.push([
      lon + (meters * Math.cos(angle)) / metersPerDegLon,
      lat + (meters * Math.sin(angle)) / metersPerDegLat,
    ]);
  }
  return ring;
}

// 到達範囲内にある、止まっていない路線の駅
export function listReachableStations(
  nodes: readonly StationNode[],
  center: Position,
  meters: number,
  excludedLineIds: readonly string[],
): StationNode[] {
  return nodes.filter(
    (n) => !excludedLineIds.includes(n.lineId) && computeDistanceMeters(center, n.lonLat) <= meters,
  );
}

// 駅名ラベル。同じ名前で近い駅（路線違い）は 1 つにまとめ、乗降客数の多い駅を優先する
export function buildStationLabels(
  nodes: readonly StationNode[],
  emphasizedIds: ReadonlySet<string>,
): MapScene["stationLabels"] {
  const groups = new Map<string, StationNode[]>();
  for (const node of nodes) {
    const key = `${node.name}@${node.lonLat[0].toFixed(2)},${node.lonLat[1].toFixed(2)}`;
    groups.set(key, [...(groups.get(key) ?? []), node]);
  }
  const features = [...groups.values()].map((group) => {
    const top = [...group].sort(
      (a, b) => (b.passengers ?? 0) - (a.passengers ?? 0),
    )[0] as StationNode;
    const passengers = top.passengers ?? 0;
    const emphasis = group.some((n) => emphasizedIds.has(n.stationId));
    // 小さい値ほど先に配置される。強調する駅を最優先にする
    const sortKey = emphasis ? -1e9 - passengers : -passengers;
    return buildPointFeature(toPosition(top.lonLat), {
      name: top.name,
      emphasis,
      sortKey,
      passengers,
    });
  });
  return buildFeatureCollection(features);
}

// 全駅の点。枠線を路線の色で描くために色を持たせる
export function buildStationPoints(
  geo: MapGeo,
): FeatureCollection<PointGeometry, { stationId: string; color: string }> {
  return buildFeatureCollection(
    geo.nodes.map((n) =>
      buildPointFeature(toPosition(n.lonLat), {
        stationId: n.stationId,
        color: geo.lineColors.get(n.lineId) ?? "#888888",
      }),
    ),
  );
}

// 全座標を含む矩形。点が 1 つでも幅を持たせる
export function computeFitBounds(points: readonly Position[], minSpanDeg = 0.01): Bounds | null {
  if (points.length === 0) return null;
  let [west, south] = points[0] as Position;
  let [east, north] = points[0] as Position;
  for (const [lon, lat] of points) {
    west = Math.min(west, lon);
    east = Math.max(east, lon);
    south = Math.min(south, lat);
    north = Math.max(north, lat);
  }
  const padLon = Math.max(0, (minSpanDeg - (east - west)) / 2);
  const padLat = Math.max(0, (minSpanDeg - (north - south)) / 2);
  return [
    [west - padLon, south - padLat],
    [east + padLon, north + padLat],
  ];
}

// 止まっている路線名の手がかり。指定があればそれを、無ければ「待つ」経路の乗車区間の路線名を使う
function listBlockedLineHints(input: MapSceneInput): (string | null | undefined)[] {
  const fromWait = input.options
    .filter((o) => o.kind === "wait")
    .flatMap((o) => o.legs.filter((l) => l.mode === "ride").map((l) => l.line));
  return [input.blockedLine, ...fromWait];
}

export function buildMapScene(geo: MapGeo, input: MapSceneInput, labels: MapSceneLabels): MapScene {
  const origin = resolvePlacePosition(geo.index, input.origin);
  const destination = resolvePlacePosition(geo.index, input.destination);

  const blockedPath = input.blockedSection
    ? buildBlockedSectionPath(geo, input.blockedSection, listBlockedLineHints(input))
    : null;
  const blockedLineIds = blockedPath ? [blockedPath.lineId] : [];
  const blockedLabel = input.blockedSection
    ? `${labels.blocked} ${input.blockedSection.fromStation}–${input.blockedSection.toStation}`
    : labels.blocked;

  const maxReach = computeWalkReachMeters(Math.max(...WALK_REACH_MINUTES));
  const reachPolygons = origin
    ? [...WALK_REACH_MINUTES]
        .sort((a, b) => b - a)
        .map((minutes) => ({
          type: "Feature" as const,
          geometry: {
            type: "Polygon" as const,
            coordinates: [buildCirclePolygon(origin, computeWalkReachMeters(minutes))],
          },
          properties: { minutes },
        }))
    : [];
  const reachable = origin
    ? listReachableStations(geo.nodes, origin, maxReach, blockedLineIds)
    : [];

  const recommended = input.options.find((o) => o.id === input.recommendedOptionId);
  const routeLegs = recommended ? resolveRouteLegs(geo, recommended) : [];

  const placeEntries: [Position | null, PlaceRole, string][] = [
    [origin, "origin", labels.origin],
    [destination, "destination", labels.destination],
  ];
  const places = placeEntries.flatMap(([position, role, label]) =>
    position ? [buildPointFeature(position, { role, label })] : [],
  );

  const fitPoints: Position[] = [
    ...(origin ? (reachPolygons[0]?.geometry.coordinates[0] ?? [origin]) : []),
    ...(destination ? [destination] : []),
    ...routeLegs.flatMap((leg) => leg.coordinates),
    ...(blockedPath?.coordinates ?? []),
  ];

  return {
    origin,
    destination,
    blockedLineIds,
    blocked: buildFeatureCollection(
      blockedPath ? [buildLineFeature(blockedPath.coordinates, { label: blockedLabel })] : [],
    ),
    reach: buildFeatureCollection(reachPolygons),
    reachableStations: buildFeatureCollection(
      reachable.map((n) =>
        buildPointFeature(toPosition(n.lonLat), {
          stationId: n.stationId,
          name: n.name,
          color: geo.lineColors.get(n.lineId) ?? "#888888",
        }),
      ),
    ),
    route: buildFeatureCollection(
      routeLegs.map((leg) => buildLineFeature(leg.coordinates, { mode: leg.mode })),
    ),
    transferLineIds: listTransferServiceLineIds(geo, input.options),
    places: buildFeatureCollection(places),
    stationLabels: buildStationLabels(geo.nodes, new Set(reachable.map((n) => n.stationId))),
    bounds: computeFitBounds(fitPoints),
  };
}
