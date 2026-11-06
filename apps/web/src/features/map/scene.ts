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
import { sliceTrackBetween, type TrackParts } from "./track-shape";

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
  // 止まっている路線。発表の区間が無いときも、利用者のいる路線を薄く示し、代わりの手段の駅から外すのに使う
  blockedLineIds: string[];
  // 止まっている区間。発表で区間が分かったときだけ、線路の形に沿って描く
  blocked: FeatureCollection<LineStringGeometry, { label: string }>;
  // 区間を描けず、発表で確かめるよう添えるとき true。その列車だけが止まる事象では false
  sectionUnconfirmed: boolean;
  // 止まった列車が走っていた線路の路線と道筋。その列車だけが止まるときも、現在地の印を置くのに使う
  trackLineIds: string[];
  trackPath: Position[] | null;
  reach: FeatureCollection<IsochroneGeometry, { minutes: number }>;
  // 現在地が引けず範囲を描かないときは null
  reachSource: ReachSource | null;
  reachableStations: FeatureCollection<
    PointGeometry,
    { stationId: string; name: string; color: string }
  >;
  // label は乗る路線の名前。線の上に 1 か所だけ出すので、最も長い乗車区間にだけ付ける
  // offset は止まっている区間と並走するときに横へずらす向き（1 は右、-1 は左、0 はずらさない）
  route: FeatureCollection<LineStringGeometry, { mode: RouteMode; label: string; offset: number }>;
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
  // 一覧で選んだ選択肢。あればこの経路を描き、推奨はそのまま保つ
  selectedOptionId?: string | null;
  blockedSection: Section | null;
  // 止まっている路線の名前。分からなければ選択肢の「待つ」経路から推し量る
  blockedLine?: string | null;
  // 現在地の駅の到達範囲（Valhalla）。10 分と 20 分がそろわなければ円で概算する
  reachAreas?: readonly ReachArea[];
  // 入口で選んだ路線と方面。発表に区間が無いとき、利用者のいる路線として薄く示す。区間としては描かない
  // 運行の状態は利用者の申告だけから出す
  blockedDirection?: BlockedDirection | null;
  // その列車だけが止まる事象。区間の運転見合わせではないので、止まった区間の線と札を描かない
  trainOnly?: boolean;
  // 徒歩の範囲を描かない。駅間の車内の人は降りられないため
  hideReach?: boolean;
};

export type BlockedDirection = { lineId: string; terminalId: string };

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
  // 路線ごとの線路の形。地図で路線を描く形と同じもの。無ければ駅の並びで代える
  trackShapes?: ReadonlyMap<string, TrackParts>;
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

// 路線名を英語にする。英字だけならそのまま、正式名に英語名があればそれを使う
// 「JR神戸線」のような通称は英語名の対応が無いので null を返し、日本語を混ぜない
export function translateLineName(index: GeoIndex, name: string | null | undefined): string | null {
  if (!name) return null;
  if (/^[\x20-\x7e]+$/.test(name)) return name;
  const query = normalizeSearchText(name);
  const exact = index
    .listLines()
    .find(
      (line) =>
        normalizeSearchText(line.lineName) === query ||
        normalizeSearchText(`${line.operator}${line.lineName}`) === query,
    );
  return exact?.nameEn ?? null;
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

// 隣り合う 2 駅の間を、地図で路線を描く線路の形から切り出す。形が無いか切り出せなければ 2 駅を結ぶ
function buildAdjacentTrack(
  geo: MapGeo,
  lineId: string,
  from: StationNode,
  to: StationNode,
): Position[] {
  const parts = geo.trackShapes?.get(lineId);
  const sliced = parts
    ? sliceTrackBetween(parts, toPosition(from.lonLat), toPosition(to.lonLat))
    : null;
  return sliced && sliced.length >= 2 ? sliced : [toPosition(from.lonLat), toPosition(to.lonLat)];
}

// 駅の並びを順に通る線を、隣り合う駅ごとに線路の形から切り出してつなぐ
// 両端だけで切り出すと、環状線や分岐で駅の並びと違う側を通り得るため
function buildTrackThroughStations(
  geo: MapGeo,
  lineId: string,
  stationIds: readonly string[],
): Position[] {
  const nodes = stationIds.flatMap((id) => {
    const node = geo.index.getStation(id);
    return node ? [node] : [];
  });
  if (nodes.length === 1) return [toPosition((nodes[0] as StationNode).lonLat)];
  return nodes.slice(1).flatMap((next, i) => {
    const piece = buildAdjacentTrack(geo, lineId, nodes[i] as StationNode, next);
    // 次の区間の始まりと重ならないよう、最後の区間のほかは終わりの点を除く
    return i === nodes.length - 2 ? piece : piece.slice(0, -1);
  });
}

// 止まっている区間を、線路の形に沿った線にする
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
    if (ids !== null) {
      return { lineId: line.lineId, coordinates: buildTrackThroughStations(geo, line.lineId, ids) };
    }
  }

  // 路線名で引けなければ、2 駅を直接結ぶ路線のうち最短のものを使う
  const from = resolveStationByName(geo.index, section.fromStation);
  const to = resolveStationByName(geo.index, section.toStation);
  if (!from || !to) return null;
  const between = geo.index.listLinesBetween(from.stationId, to.stationId)[0];
  if (!between) return null;
  const lineId = between.line.lineId;
  const ids = findStationPathOnLine(
    geo.graph,
    lineId,
    between.from.stationId,
    between.to.stationId,
  );
  return {
    lineId,
    coordinates: ids
      ? buildTrackThroughStations(geo, lineId, ids)
      : [toPosition(between.from.lonLat), toPosition(between.to.lonLat)],
  };
}

// 入口で選んだ方面の道筋。来た側の隣の駅から、行き先（方面の先にあれば）か方面の終わりの駅まで
// 止まっている区間の根拠ではないので描かない。路線を薄く示すことと、駅間の現在地を置くことにだけ使う
export function buildDirectionBlockedPath(
  geo: MapGeo,
  origin: Place,
  destination: Place,
  direction: BlockedDirection,
): (ResolvedSection & { stationIds: string[] }) | null {
  if (origin.kind !== "station") return null;
  const from = resolveStationByName(geo.index, origin.name, [direction.lineId]);
  if (from?.lineId !== direction.lineId) return null;
  const ahead = findStationPathOnLine(
    geo.graph,
    direction.lineId,
    from.stationId,
    direction.terminalId,
  );
  if (ahead === null || ahead.length < 2) return null;
  const goal =
    destination.kind === "station"
      ? resolveStationByName(geo.index, destination.name, [direction.lineId])
      : undefined;
  const goalIndex = goal ? ahead.indexOf(goal.stationId) : -1;
  const forward = goalIndex > 0 ? ahead.slice(0, goalIndex + 1) : ahead;
  // 現在地を線が通り抜けて見えるよう、来た側の隣の駅を 1 つ足す
  const behind = (geo.graph.get(from.stationId) ?? []).find(
    (link) => link.kind === "ride" && link.lineId === direction.lineId && link.to !== forward[1],
  )?.to;
  const stationIds = behind ? [behind, ...forward] : forward;
  return {
    lineId: direction.lineId,
    coordinates: buildTrackThroughStations(geo, direction.lineId, stationIds),
    stationIds,
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

// 駅の表示名。英語では同じ名前の駅のどれかが持つ英語名を使い、無ければ fallback にする
// 英語の画面に日本語の駅名を混ぜないため
function pickNodeName(
  nodes: readonly StationNode[],
  node: StationNode,
  english: boolean,
  fallback = "",
): string {
  if (!english) return node.name;
  return node.nameEn ?? nodes.find((n) => n.name === node.name && n.nameEn)?.nameEn ?? fallback;
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

// 推奨経路の折れ線。最も長い乗車区間にだけ路線名を付ける。名前は nameLine で表示用にする
export function buildRouteFeatures(
  legs: readonly ResolvedLeg[],
  nameLine: (line: string) => string | null = (line) => line,
  offsets: readonly number[] = [],
): MapScene["route"] {
  const rides = legs.filter((leg) => leg.mode === "ride" && leg.line && nameLine(leg.line));
  const longest = rides.reduce<ResolvedLeg | null>(
    (best, leg) =>
      best === null || measurePathLength(leg.coordinates) > measurePathLength(best.coordinates)
        ? leg
        : best,
    null,
  );
  return buildFeatureCollection(
    legs.map((leg, i) =>
      buildLineFeature(leg.coordinates, {
        mode: leg.mode,
        label: leg === longest && leg.line ? (nameLine(leg.line) ?? "") : "",
        offset: offsets[i] ?? 0,
      }),
    ),
  );
}

// 止まっている区間からこの距離以内の点が多い区間は、並走しているとみなす
export const PARALLEL_METERS = 2500;
const parallelShare = 0.3;

function measureNearestMeters(point: Position, path: readonly Position[]): number {
  return path.reduce((best, p) => Math.min(best, computeDistanceMeters(point, p)), Infinity);
}

// 止まっている区間と並走する区間を、区間と反対の側へずらす向き。並走しなければ 0
// 1 は進む向きの右、-1 は左（MapLibre の line-offset の向き）
export function computeParallelOffset(
  coordinates: readonly Position[],
  blocked: readonly Position[],
): number {
  if (blocked.length < 2 || coordinates.length < 2) return 0;
  const near = coordinates.filter((p) => measureNearestMeters(p, blocked) <= PARALLEL_METERS);
  if (near.length / coordinates.length < parallelShare) return 0;
  // 区間の各点について、止まっている区間の最寄り点が進む向きの左右どちらにあるかを数える
  let side = 0;
  for (let i = 1; i < coordinates.length; i++) {
    const a = coordinates[i - 1] as Position;
    const b = coordinates[i] as Position;
    const mid: Position = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
    const nearest = blocked.reduce((best, p) =>
      computeDistanceMeters(mid, p) < computeDistanceMeters(mid, best) ? p : best,
    );
    const cross = (b[0] - a[0]) * (nearest[1] - a[1]) - (b[1] - a[1]) * (nearest[0] - a[0]);
    side += Math.sign(cross);
  }
  // 外積が正なら区間は左にある。経路は右へずらす
  return side >= 0 ? 1 : -1;
}

// 止まっている区間と並走する割合が高いか
export function isParallelTo(
  coordinates: readonly Position[],
  blocked: readonly Position[],
): boolean {
  return computeParallelOffset(coordinates, blocked) !== 0;
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

// 止まっている区間の札。「見合わせ 大阪〜京都」の形にする。英語は駅の英語名が無ければ駅名を出さない
function buildBlockedLabel(
  geo: MapGeo,
  section: Section,
  lineId: string,
  labels: MapSceneLabels,
): string {
  if (labels.english !== true) {
    return `${labels.blocked} ${section.fromStation}〜${section.toStation}`;
  }
  const names = [section.fromStation, section.toStation].map((name) => {
    const node = resolveStationByName(geo.index, name, [lineId]);
    return node ? pickNodeName(geo.nodes, node, true) : "";
  });
  return names.every((name) => name !== "")
    ? `${labels.blocked} ${names[0]}–${names[1]}`
    : labels.blocked;
}

// 画面の上で名前どうしがこの距離（px）より近いときは、先に挙げた方だけを出す
export const KEY_LABEL_MIN_PX = 44;

// 名前を出す駅を、いまの拡大率の画面で間引く。buildKeyStations と同じく先に挙げた役割を優先する
// 出発と行き先は地図の上の印でも示すので、その近くの名前も印と重ならないよう外す
export function thinKeyStationsOnScreen(
  keyStations: MapScene["keyStations"],
  project: (position: Position) => { x: number; y: number },
  minPx = KEY_LABEL_MIN_PX,
): MapScene["keyStations"] {
  const kept: { x: number; y: number }[] = [];
  const features = keyStations.features.filter((f) => {
    const point = project(f.geometry.coordinates);
    if (kept.some((k) => Math.hypot(k.x - point.x, k.y - point.y) < minPx)) return false;
    kept.push(point);
    return true;
  });
  return buildFeatureCollection(features);
}

export function buildMapScene(geo: MapGeo, input: MapSceneInput, labels: MapSceneLabels): MapScene {
  const origin = resolvePlacePosition(geo.index, input.origin);
  const destination = resolvePlacePosition(geo.index, input.destination);

  const sectionPath = input.blockedSection
    ? buildBlockedSectionPath(geo, input.blockedSection, listBlockedLineHints(input))
    : null;
  const directionPath =
    sectionPath === null && input.blockedDirection
      ? buildDirectionBlockedPath(geo, input.origin, input.destination, input.blockedDirection)
      : null;
  const trackPath = sectionPath ?? directionPath;
  // 止まっている区間として描くのは、発表で区間が分かったときだけ。その列車だけが止まるときは描かない
  const blockedPath = input.trainOnly ? null : sectionPath;
  // 発表に区間が無くても、利用者のいる路線は止まっている路線として薄く示し、代わりの手段の駅から外す
  const stoppedLinePath = input.trainOnly ? null : trackPath;
  const blockedLineIds = stoppedLinePath ? [stoppedLinePath.lineId] : [];
  const english = labels.english === true;
  const blockedLabel =
    blockedPath && input.blockedSection
      ? buildBlockedLabel(geo, input.blockedSection, blockedPath.lineId, labels)
      : labels.blocked;

  const reach = origin && !input.hideReach ? buildReachFeatures(origin, input.reachAreas) : null;
  const widestReach = reach?.features[0]?.geometry;
  const reachable = widestReach
    ? listReachableStations(geo.nodes, widestReach, blockedLineIds)
    : [];

  const routeOptionId = input.selectedOptionId ?? input.recommendedOptionId;
  const routeOption = input.options.find((o) => o.id === routeOptionId);
  const routeLegs = routeOption ? resolveRouteLegs(geo, routeOption) : [];
  const blockedCoordinates = blockedPath?.coordinates ?? [];
  // 代替経路は乗車区間だけ。止まっている区間と並走するものは推奨経路と重なってうるさいので出さない
  const alternativeLegs = input.options
    .filter((o) => o.id !== routeOptionId)
    .flatMap((o) =>
      resolveRouteLegs(geo, o)
        .filter((leg) => leg.mode === "ride" && !isParallelTo(leg.coordinates, blockedCoordinates))
        .map((leg) => ({ optionId: o.id, leg })),
    );

  const route = buildRouteFeatures(
    routeLegs,
    (line) => (english ? translateLineName(geo.index, line) : line),
    routeLegs.map((leg) =>
      leg.mode === "walk" ? 0 : computeParallelOffset(leg.coordinates, blockedCoordinates),
    ),
  );
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
  const blockedEndNames =
    blockedPath && input.blockedSection
      ? [input.blockedSection.fromStation, input.blockedSection.toStation]
      : [];
  const keyStations = buildKeyStations([
    {
      position: origin,
      name: originNode
        ? pickNodeName(geo.nodes, originNode, english, labels.origin)
        : labels.origin,
      role: "origin",
    },
    {
      position: destination,
      name: destinationNode
        ? pickNodeName(geo.nodes, destinationNode, english, labels.destination)
        : labels.destination,
      role: "destination",
    },
    ...transferNodes.map((node) => ({
      position: toPosition(node.lonLat),
      name: pickNodeName(geo.nodes, node, english),
      role: "transfer" as const,
    })),
    ...blockedEnds.map((position, i) => {
      const name = blockedEndNames[i] ?? "";
      const node = name ? resolveStationByName(geo.index, name, blockedLineIds) : undefined;
      return {
        position: position ?? null,
        name: node ? pickNodeName(geo.nodes, node, english) : english ? "" : name,
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
    trackLineIds: trackPath ? [trackPath.lineId] : [],
    trackPath: trackPath?.coordinates ?? null,
    blocked: buildFeatureCollection(
      blockedPath ? [buildLineFeature(blockedPath.coordinates, { label: blockedLabel })] : [],
    ),
    sectionUnconfirmed: !input.trainOnly && blockedPath === null,
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
