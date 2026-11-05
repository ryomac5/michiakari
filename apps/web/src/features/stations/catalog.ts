import type { GeoIndex, LineInfo, StationNode } from "@repo/geo";
import { computeDistanceMeters } from "@repo/geo";
import { z } from "zod";

// 駅検索の候補。国土数値情報の駅（路線ごと）を、同じ名前で近くにある駅どうし 1 つにまとめる
// 英語名は @repo/geo のデータが持つもの（主要駅と全路線・全事業者）を使う

export const StationChoiceSchema = z.object({
  // 検索結果の安定した識別子。同名で離れた駅が無ければ駅名そのもの
  id: z.string().min(1),
  // 判断の要求に送る駅名（日本語）
  name: z.string().min(1),
  nameEn: z.string().nullable(),
  operators: z.array(
    z.object({
      name: z.string(),
      nameEn: z.string(),
      lines: z.array(z.string()),
      linesEn: z.array(z.string()),
    }),
  ),
  lat: z.number(),
  lon: z.number(),
});
export type StationChoice = z.infer<typeof StationChoiceSchema>;

export const StationSearchResponseSchema = z.object({ stations: z.array(StationChoiceSchema) });

export const NearestStationSchema = z.object({
  station: StationChoiceSchema,
  meters: z.number().nonnegative(),
});
export type NearestStationChoice = z.infer<typeof NearestStationSchema>;

export const NearestResponseSchema = z.object({ nearest: z.array(NearestStationSchema) });

// 現在地。日本の範囲外は受け付けない
export const LocationRequestSchema = z.object({
  lat: z.number().min(20).max(46),
  lon: z.number().min(122).max(154),
});

// 同じ名前でもこの距離より離れた駅は別の駅として扱う（例: 神戸と東大阪の「長田」）
const samePlaceMeters = 1000;

export type StationGroup = {
  choice: StationChoice;
  stationIds: string[];
  passengers: number;
};

export type StationCatalog = {
  groups: StationGroup[];
  groupIdByStationId: Map<string, string>;
  groupById: Map<string, StationGroup>;
};

function clusterByPlace(nodes: StationNode[]): StationNode[][] {
  const clusters: StationNode[][] = [];
  const sorted = [...nodes].sort((a, b) => (b.passengers ?? 0) - (a.passengers ?? 0));
  for (const node of sorted) {
    const cluster = clusters.find(
      (c) => computeDistanceMeters((c[0] as StationNode).lonLat, node.lonLat) <= samePlaceMeters,
    );
    if (cluster) cluster.push(node);
    else clusters.push([node]);
  }
  return clusters;
}

function summarizeOperators(
  nodes: StationNode[],
  lineById: Map<string, LineInfo>,
): StationChoice["operators"] {
  const byOperator = new Map<string, StationChoice["operators"][number]>();
  for (const node of nodes) {
    const line = lineById.get(node.lineId);
    const key = line?.operatorKey ?? node.operator;
    const entry = byOperator.get(key) ?? {
      name: node.operator,
      nameEn: line?.operatorEn ?? node.operator,
      lines: [],
      linesEn: [],
    };
    const lineName = line?.lineName ?? node.lineId;
    if (!entry.lines.includes(lineName)) {
      entry.lines.push(lineName);
      entry.linesEn.push(line?.nameEn ?? lineName);
    }
    byOperator.set(key, entry);
  }
  return [...byOperator.values()];
}

function buildGroup(
  id: string,
  nodes: StationNode[],
  lineById: Map<string, LineInfo>,
): StationGroup {
  const [main] = nodes as [StationNode, ...StationNode[]];
  return {
    choice: {
      id,
      name: main.name,
      nameEn: nodes.find((n) => n.nameEn)?.nameEn ?? null,
      operators: summarizeOperators(nodes, lineById),
      lat: main.lonLat[1],
      lon: main.lonLat[0],
    },
    stationIds: nodes.map((n) => n.stationId),
    passengers: nodes.reduce((sum, n) => sum + (n.passengers ?? 0), 0),
  };
}

export function buildStationCatalog(nodes: StationNode[], lines: LineInfo[]): StationCatalog {
  const lineById = new Map(lines.map((l) => [l.lineId, l]));
  const byName = new Map<string, StationNode[]>();
  for (const node of nodes) byName.set(node.name, [...(byName.get(node.name) ?? []), node]);

  const groups: StationGroup[] = [];
  for (const [name, sameName] of byName) {
    clusterByPlace(sameName).forEach((cluster, i) => {
      groups.push(buildGroup(i === 0 ? name : `${name}-${i + 1}`, cluster, lineById));
    });
  }
  const groupIdByStationId = new Map<string, string>();
  for (const group of groups) {
    for (const id of group.stationIds) groupIdByStationId.set(id, group.choice.id);
  }
  return { groups, groupIdByStationId, groupById: new Map(groups.map((g) => [g.choice.id, g])) };
}

// 一致の度合いと乗降客数の順に並んだ駅を、まとめた駅の順に置き換える
function collectGroups(
  catalog: StationCatalog,
  stationIds: string[],
  limit: number,
): StationGroup[] {
  const seen = new Set<string>();
  const result: StationGroup[] = [];
  for (const stationId of stationIds) {
    const groupId = catalog.groupIdByStationId.get(stationId);
    const group = groupId ? catalog.groupById.get(groupId) : undefined;
    if (!group || seen.has(group.choice.id)) continue;
    seen.add(group.choice.id);
    result.push(group);
    if (result.length >= limit) break;
  }
  return result;
}

function normalizeRoman(text: string): string {
  return text.toLowerCase().replace(/[^a-z]/g, "");
}

// 英字の入力はローマ字の駅名で探す（完全一致 → 前方一致 → 部分一致、同順位は乗降客数の多い順）
function searchByRoman(catalog: StationCatalog, query: string, limit: number): StationChoice[] {
  const q = normalizeRoman(query);
  if (q === "") return [];
  return catalog.groups
    .flatMap((group) => {
      const key = group.choice.nameEn ? normalizeRoman(group.choice.nameEn) : "";
      const rank = key === q ? 0 : key.startsWith(q) ? 1 : key.includes(q) ? 2 : -1;
      return rank < 0 ? [] : [{ group, rank }];
    })
    .sort((a, b) => a.rank - b.rank || b.group.passengers - a.group.passengers)
    .slice(0, limit)
    .map((r) => r.group.choice);
}

export function searchStationChoices(
  index: GeoIndex,
  catalog: StationCatalog,
  query: string,
  limit = 8,
): StationChoice[] {
  if (/^[\x20-\x7e]+$/.test(query.trim()) && /[a-z]/i.test(query)) {
    return searchByRoman(catalog, query, limit);
  }
  const nodes = index.findStationsByName(query, 400);
  return collectGroups(
    catalog,
    nodes.map((n) => n.stationId),
    limit,
  ).map((g) => g.choice);
}

export function findNearestChoices(
  index: GeoIndex,
  catalog: StationCatalog,
  point: { lat: number; lon: number },
  limit = 3,
): NearestStationChoice[] {
  const nearest = index.findNearestStations([point.lon, point.lat], 40);
  const meters = new Map<string, number>();
  for (const n of nearest) {
    const groupId = catalog.groupIdByStationId.get(n.station.stationId);
    if (groupId && !meters.has(groupId)) meters.set(groupId, n.distanceMeters);
  }
  return collectGroups(
    catalog,
    nearest.map((n) => n.station.stationId),
    limit,
  ).map((g) => ({ station: g.choice, meters: Math.round(meters.get(g.choice.id) ?? 0) }));
}

// 駅名から英語の表示名を引く。シナリオの駅など、検索を通らない駅名に使う
export function describeStationNames(
  catalog: StationCatalog,
  names: string[],
): Record<string, string | null> {
  return Object.fromEntries(
    names.map((name) => [name, catalog.groupById.get(name)?.choice.nameEn ?? null]),
  );
}
