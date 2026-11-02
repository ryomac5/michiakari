import {
  computeDistanceMeters,
  type GeoIndex,
  type IsochroneGeometry,
  isPointInGeometry,
  type LineInfo,
  type LonLat,
  type NetworkGraph,
  normalizeSearchText,
  type StationNode,
} from "@repo/geo";
import type { Place, RouteLeg, RouteOption, Section } from "@repo/schema";
import type { ReachArea } from "./reach";

// 地図に重ねる GeoJSON を判断の状態から組み立てる。表示用の純関数だけを置く

// 徒歩の到達範囲。Valhalla の事前計算が無い駅は円で概算する
// 概算の値は packages/core/params/walk.ts と同じ（core が公開していないため写している）
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

export type RouteMode = "ride" | "walk" | "taxi";
// valhalla は事前計算の到達範囲、circle は円の概算
export type ReachSource = "valhalla" | "circle";
export type PlaceRole = "origin" | "destination";
// 地図に名前を出す駅の役割。ほかの駅は名前を出さない
export type KeyStationRole = PlaceRole | "transfer" | "blocked-end";

export type MapScene = {
  origin: Position | null;
  destination: Position | null;
  blockedLineIds: string[];
  blocked: FeatureCollection<LineStringGeometry, { label: string }>;
  reach: FeatureCollection<IsochroneGeometry, { minutes: number }>;
  // 現在地が引けず範囲を描かないときは null
  reachSource: ReachSource | null;
  reachableStations: FeatureCollection<
    PointGeometry,
    { stationId: string; name: string; color: string }
  >;
  // label は乗る路線の名前。線の上に 1 か所だけ出すので、最も長い乗車区間にだけ付ける
  route: FeatureCollection<LineStringGeometry, { mode: RouteMode; label: string }>;
  // 路線名を置く点。線の中ほどに 1 つだけ置く（タイルごとに重ならないよう点にする）
  routeLabel: FeatureCollection<PointGeometry, { label: string }>;
  // 推奨以外の選択肢の経路。淡く細く描く
  alternatives: FeatureCollection<LineStringGeometry, { optionId: string; mode: RouteMode }>;
  // 名前を出す駅: 出発、行き先、推奨経路の乗換駅、止まっている区間の端
  keyStations: FeatureCollection<PointGeometry, { name: string; role: KeyStationRole }>;
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
  // 現在地の駅の到達範囲（Valhalla）。10 分と 20 分がそろわなければ円で概算する
  reachAreas?: readonly ReachArea[];
};

export type MapSceneLabels = {
  origin: string;
  destination: string;
  blocked: string;
  // 英語表示。駅名に英語名があればそちらを使う
  english?: boolean;
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

type ResolvedLeg = {
  mode: RouteMode;
  lineId: string | null;
  coordinates: Position[];
  // 区間の両端の駅と、乗る路線の名前（観測の表記）
  from?: StationNode;
  to?: StationNode;
  line?: string | null;
};

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
      resolved.push({ mode: "ride", lineId, coordinates, from, to, line: leg.line ?? null });
    } else {
      resolved.push({
        mode: leg.mode,
        lineId: null,
        coordinates: [toPosition(from.lonLat), toPosition(to.lonLat)],
        from,
        to,
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

type ReachFeature = Feature<IsochroneGeometry, { minutes: number }>;

// 到達範囲を広い順に並べる。事前計算が 10 分と 20 分そろっていればそれを、無ければ円を使う
export function buildReachFeatures(
  origin: Position,
  areas: readonly ReachArea[] = [],
): { source: ReachSource; features: ReachFeature[] } {
  const byMinutes = new Map<number, IsochroneGeometry>(areas.map((a) => [a.minutes, a.geometry]));
  const source: ReachSource = WALK_REACH_MINUTES.every((m) => byMinutes.has(m))
    ? "valhalla"
    : "circle";
  const features = [...WALK_REACH_MINUTES]
    .sort((a, b) => b - a)
    .map(
      (minutes): ReachFeature => ({
        type: "Feature",
        geometry:
          source === "valhalla"
            ? (byMinutes.get(minutes) as IsochroneGeometry)
            : {
                type: "Polygon",
                coordinates: [buildCirclePolygon(origin, computeWalkReachMeters(minutes))],
              },
        properties: { minutes },
      }),
    );
  return { source, features };
}

// 多角形の外周の頂点。地図を寄せる範囲に使う
function listOuterPositions(geometry: IsochroneGeometry): Position[] {
  const polygons = geometry.type === "Polygon" ? [geometry.coordinates] : geometry.coordinates;
  return polygons.flatMap((polygon) => (polygon[0] ?? []).map(toPosition));
}

// 到達範囲内にある、止まっていない路線の駅
export function listReachableStations(
  nodes: readonly StationNode[],
  area: IsochroneGeometry,
  excludedLineIds: readonly string[],
): StationNode[] {
  return nodes.filter(
    (n) => !excludedLineIds.includes(n.lineId) && isPointInGeometry(n.lonLat, area),
  );
}

// この距離以内にある同じ名前の駅は、ラベルを 1 つにまとめる
export const STATION_LABEL_MERGE_METERS = 500;

// 同じ名前の駅を、互いに近いものどうしで連結してまとめる
function groupNearbySameName(nodes: readonly StationNode[], mergeMeters: number): StationNode[][] {
  const byName = new Map<string, StationNode[]>();
  for (const node of nodes) byName.set(node.name, [...(byName.get(node.name) ?? []), node]);

  const groups: StationNode[][] = [];
  for (const sameName of byName.values()) {
    const parent = sameName.map((_, i) => i);
    const findRoot = (i: number): number => {
      while (parent[i] !== i) i = parent[i] as number;
      return i;
    };
    for (let i = 0; i < sameName.length; i++) {
      for (let j = i + 1; j < sameName.length; j++) {
        const a = sameName[i] as StationNode;
        const b = sameName[j] as StationNode;
        if (computeDistanceMeters(a.lonLat, b.lonLat) <= mergeMeters) {
          parent[findRoot(j)] = findRoot(i);
        }
      }
    }
    const clusters = new Map<number, StationNode[]>();
    sameName.forEach((node, i) => {
      const root = findRoot(i);
      clusters.set(root, [...(clusters.get(root) ?? []), node]);
    });
    groups.push(...clusters.values());
  }
  return groups;
}

// 駅名ラベル。同じ名前で近い駅（路線違い）は 1 つにまとめ、乗降客数の多い駅を優先する
export function buildStationLabels(
  nodes: readonly StationNode[],
  emphasizedIds: ReadonlySet<string>,
  mergeMeters = STATION_LABEL_MERGE_METERS,
): MapScene["stationLabels"] {
  const features = groupNearbySameName(nodes, mergeMeters).map((group) => {
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

function pickNodeName(node: StationNode, english: boolean): string {
  return english && node.nameEn ? node.nameEn : node.name;
}

// 折れ線の長さ（度のまま）。ラベルを置く区間を選ぶのに使う
function measurePathLength(coordinates: readonly Position[]): number {
  let total = 0;
  for (let i = 1; i < coordinates.length; i++) {
    const [ax, ay] = coordinates[i - 1] as Position;
    const [bx, by] = coordinates[i] as Position;
    total += Math.hypot(bx - ax, by - ay);
  }
  return total;
}

// 推奨経路の折れ線。最も長い乗車区間にだけ路線名を付ける
export function buildRouteFeatures(legs: readonly ResolvedLeg[]): MapScene["route"] {
  const rides = legs.filter((leg) => leg.mode === "ride" && leg.line);
  const longest = rides.reduce<ResolvedLeg | null>(
    (best, leg) =>
      best === null || measurePathLength(leg.coordinates) > measurePathLength(best.coordinates)
        ? leg
        : best,
    null,
  );
  return buildFeatureCollection(
    legs.map((leg) =>
      buildLineFeature(leg.coordinates, {
        mode: leg.mode,
        label: leg === longest ? (leg.line ?? "") : "",
      }),
    ),
  );
}

// 乗換駅の名前は、出発・行き先からこの距離より離れているときだけ出す
export const KEY_TRANSFER_MIN_METERS = 2500;
// 名前どうしがこの距離より近いときは、先に挙げた方だけを出す
export const KEY_LABEL_MIN_METERS = 400;

// 折れ線の長さの中ほどの点
export function findPathMidpoint(coordinates: readonly Position[]): Position | null {
  if (coordinates.length === 0) return null;
  const half = measurePathLength(coordinates) / 2;
  let walked = 0;
  for (let i = 1; i < coordinates.length; i++) {
    const a = coordinates[i - 1] as Position;
    const b = coordinates[i] as Position;
    const step = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (walked + step >= half && step > 0) {
      const t = (half - walked) / step;
      return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
    }
    walked += step;
  }
  return coordinates[0] as Position;
}

export function buildRouteLabel(route: MapScene["route"]): MapScene["routeLabel"] {
  return buildFeatureCollection(
    route.features.flatMap((f) => {
      const point = f.properties.label ? findPathMidpoint(f.geometry.coordinates) : null;
      return point ? [buildPointFeature(point, { label: f.properties.label })] : [];
    }),
  );
}

// 名前を出す駅。同じ名前や近すぎる名前は、先に挙げた役割を優先して 1 つにまとめる
export function buildKeyStations(
  entries: readonly { position: Position | null; name: string; role: KeyStationRole }[],
): MapScene["keyStations"] {
  const placed: { position: Position; name: string; role: KeyStationRole }[] = [];
  const ends = entries.filter((e) => e.role === "origin" || e.role === "destination");
  for (const { position, name, role } of entries) {
    if (position === null || name === "" || placed.some((p) => p.name === name)) continue;
    const near = (others: readonly { position: Position | null }[], meters: number) =>
      others.some(
        (o) => o.position !== null && computeDistanceMeters(o.position, position) < meters,
      );
    if (role === "transfer" && near(ends, KEY_TRANSFER_MIN_METERS)) continue;
    if (near(placed, KEY_LABEL_MIN_METERS)) continue;
    placed.push({ position, name, role });
  }
  return buildFeatureCollection(
    placed.map(({ position, name, role }) => buildPointFeature(position, { name, role })),
  );
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

  const reach = origin ? buildReachFeatures(origin, input.reachAreas) : null;
  const widestReach = reach?.features[0]?.geometry;
  const reachable = widestReach
    ? listReachableStations(geo.nodes, widestReach, blockedLineIds)
    : [];

  const recommended = input.options.find((o) => o.id === input.recommendedOptionId);
  const routeLegs = recommended ? resolveRouteLegs(geo, recommended) : [];
  const alternativeLegs = input.options
    .filter((o) => o.id !== input.recommendedOptionId)
    .flatMap((o) =>
      resolveRouteLegs(geo, o)
        .filter((leg) => leg.mode === "ride")
        .map((leg) => ({ optionId: o.id, leg })),
    );

  const route = buildRouteFeatures(routeLegs);
  const english = labels.english === true;
  const originNode =
    input.origin.kind === "station"
      ? resolveStationByName(geo.index, input.origin.name)
      : undefined;
  const destinationNode =
    input.destination.kind === "station"
      ? resolveStationByName(geo.index, input.destination.name)
      : undefined;
  const transferNodes = routeLegs
    .filter((leg) => leg.mode === "ride")
    .flatMap((leg) => [leg.from, leg.to])
    .filter((node): node is StationNode => node !== undefined);
  const blockedEnds = blockedPath
    ? [blockedPath.coordinates[0], blockedPath.coordinates.at(-1)]
    : [];
  const blockedEndNames = input.blockedSection
    ? [input.blockedSection.fromStation, input.blockedSection.toStation]
    : [];
  const keyStations = buildKeyStations([
    {
      position: origin,
      name: originNode ? pickNodeName(originNode, english) : labels.origin,
      role: "origin",
    },
    {
      position: destination,
      name: destinationNode ? pickNodeName(destinationNode, english) : labels.destination,
      role: "destination",
    },
    ...transferNodes.map((node) => ({
      position: toPosition(node.lonLat),
      name: pickNodeName(node, english),
      role: "transfer" as const,
    })),
    ...blockedEnds.map((position, i) => {
      const name = blockedEndNames[i] ?? "";
      const node = name ? resolveStationByName(geo.index, name, blockedLineIds) : undefined;
      return {
        position: position ?? null,
        name: node ? pickNodeName(node, english) : name,
        role: "blocked-end" as const,
      };
    }),
  ]);

  const placeEntries: [Position | null, PlaceRole, string][] = [
    [origin, "origin", labels.origin],
    [destination, "destination", labels.destination],
  ];
  const places = placeEntries.flatMap(([position, role, label]) =>
    position ? [buildPointFeature(position, { role, label })] : [],
  );

  const fitPoints: Position[] = [
    ...(origin ? (widestReach ? listOuterPositions(widestReach) : [origin]) : []),
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
    reach: buildFeatureCollection(reach?.features ?? []),
    reachSource: reach?.source ?? null,
    reachableStations: buildFeatureCollection(
      reachable.map((n) =>
        buildPointFeature(toPosition(n.lonLat), {
          stationId: n.stationId,
          name: n.name,
          color: geo.lineColors.get(n.lineId) ?? "#888888",
        }),
      ),
    ),
    route,
    routeLabel: buildRouteLabel(route),
    alternatives: buildFeatureCollection(
      alternativeLegs.map(({ optionId, leg }) =>
        buildLineFeature(leg.coordinates, { optionId, mode: leg.mode }),
      ),
    ),
    keyStations,
    transferLineIds: listTransferServiceLineIds(geo, input.options),
    places: buildFeatureCollection(places),
    stationLabels: buildStationLabels(geo.nodes, new Set(reachable.map((n) => n.stationId))),
    bounds: computeFitBounds(fitPoints),
  };
}
