import type { LineInfo, RideEdge, StationNode } from "@repo/geo";
import {
  resolveLineAliases,
  resolveLineColor,
  resolveLineType,
  resolveStationReading,
} from "./attributes.ts";
import { type Coord, computeDistanceMeters, extractLines, roundTo } from "./geometry.ts";
import { buildLineId, buildStationId } from "./ids.ts";
import { buildSegments } from "./segments.ts";
import { findAdjacentStations, removeBypassEdges } from "./topology.ts";

// 駅と線路区間から、路線・駅ノード・隣接辺を組み立てる

export type StationRow = {
  operator_key: string;
  operator_name: string;
  line_name: string;
  code: string;
  name: string;
  lon: number;
  lat: number;
  in_area: boolean;
  passengers: number | null;
  features: string[];
};

export type SectionRow = {
  operator_key: string;
  line_name: string;
  geometry: string;
};

export type LineNetwork = {
  lines: LineInfo[];
  nodes: StationNode[];
  edges: RideEdge[];
  issues: { lineId: string; messages: string[] }[];
};

// 区間の向きは大阪駅に近い端から始める
const REFERENCE_POINT: Coord = [135.4959, 34.7025];

const buildGroupKey = (operatorKey: string, lineName: string) => `${operatorKey}\u0000${lineName}`;

function groupBy<T>(rows: readonly T[], keyOf: (row: T) => string): Map<string, T[]> {
  const groups = new Map<string, T[]>();
  for (const row of rows) {
    const key = keyOf(row);
    const list = groups.get(key) ?? [];
    list.push(row);
    groups.set(key, list);
  }
  return groups;
}

function parseLines(geojson: string): Coord[][] {
  return extractLines(JSON.parse(geojson));
}

function buildLineNetwork(stations: StationRow[], sections: SectionRow[]) {
  const first = stations[0] as StationRow;
  const { operator_key: operatorKey, operator_name: operator, line_name: lineName } = first;
  const lineId = buildLineId(operatorKey, lineName);
  const lineType = resolveLineType(operatorKey, lineName);

  const adjacency = removeBypassEdges(
    findAdjacentStations(
      sections.flatMap((s) => parseLines(s.geometry)),
      stations.map((s) => ({ code: s.code, features: s.features.flatMap(parseLines) })),
    ),
  );

  // ID は路線と駅名から作る。同じ路線に同名の駅があれば駅コードを足す
  const inArea = stations.filter((s) => s.in_area);
  const nameCount = groupBy(inArea, (s) => s.name);
  const idByCode = new Map<string, string>();
  const nodes: StationNode[] = inArea.map((s) => {
    const base = buildStationId(lineId, s.name);
    const stationId = (nameCount.get(s.name)?.length ?? 0) > 1 ? `${base}-${s.code}` : base;
    idByCode.set(s.code, stationId);
    const reading = resolveStationReading(s.name);
    return {
      stationId,
      name: s.name,
      ...(reading ? { reading } : {}),
      operator,
      lineId,
      lonLat: [roundTo(s.lon, 5), roundTo(s.lat, 5)],
      passengers: s.passengers,
    };
  });

  const inAreaAdjacency = adjacency.flatMap((e) => {
    const a = idByCode.get(e.a);
    const b = idByCode.get(e.b);
    return a && b ? [{ a, b, distanceKm: roundTo(e.distanceKm, 2) }] : [];
  });
  const edges: RideEdge[] = inAreaAdjacency.map((e) => ({
    from: e.a,
    to: e.b,
    lineId,
    lineType,
    distanceKm: e.distanceKm,
  }));

  const nodeById = new Map(nodes.map((n) => [n.stationId, n]));
  const rankStart = (id: string) => {
    const node = nodeById.get(id);
    return node ? computeDistanceMeters(node.lonLat, REFERENCE_POINT) : Number.POSITIVE_INFINITY;
  };
  const { segments, issues } = buildSegments(
    nodes.map((n) => n.stationId),
    inAreaAdjacency,
    rankStart,
  );

  const line: LineInfo = {
    lineId,
    operator,
    operatorKey,
    lineName,
    aliases: resolveLineAliases(operatorKey, lineName),
    lineType,
    color: resolveLineColor(operatorKey, lineName),
    segments,
  };
  return { line, nodes, edges, issues };
}

export function buildNetwork(stations: StationRow[], sections: SectionRow[]): LineNetwork {
  const sectionsByLine = groupBy(sections, (s) => buildGroupKey(s.operator_key, s.line_name));
  const stationsByLine = groupBy(stations, (s) => buildGroupKey(s.operator_key, s.line_name));
  const result: LineNetwork = { lines: [], nodes: [], edges: [], issues: [] };
  for (const [key, lineStations] of stationsByLine) {
    if (!lineStations.some((s) => s.in_area)) continue;
    const built = buildLineNetwork(lineStations, sectionsByLine.get(key) ?? []);
    result.lines.push(built.line);
    result.nodes.push(...built.nodes);
    result.edges.push(...built.edges);
    if (built.issues.length > 0) {
      result.issues.push({ lineId: built.line.lineId, messages: built.issues });
    }
  }
  result.lines.sort((a, b) => a.lineId.localeCompare(b.lineId));
  result.nodes.sort((a, b) => a.stationId.localeCompare(b.stationId));
  result.edges.sort((a, b) => a.from.localeCompare(b.from) || a.to.localeCompare(b.to));
  return result;
}
