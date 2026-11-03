import type { LineInfo, NetworkData, RideEdge, StationNode, TransferEdge } from "./types.ts";

// 網を組む段で足す補正。国土数値情報の形は書き換えず、列車の実際の走り方に合わせる

// 路線データでは途中駅から始まるが、列車は手前の始発駅から出ている路線
// 始発駅の駅は別の路線の駅を写し、写した駅から合流駅まで 1 本の乗車の辺を張る
export type TerminalExtension = {
  lineId: string;
  // 写す元の駅（同じ事業者の別の路線の駅）
  sourceStationId: string;
  // 路線データでの路線の起点
  joinStationId: string;
  // 始発駅から合流駅までの距離を測る路線
  viaLineId: string;
};

export const TERMINAL_EXTENSIONS: readonly TerminalExtension[] = [
  // 阪急京都線の列車は大阪梅田から出るが、国土数値情報では京都線が十三から始まるため補う
  {
    lineId: "hankyu.京都線",
    sourceStationId: "hankyu.神戸線.大阪梅田",
    joinStationId: "hankyu.京都線.十三",
    viaLineId: "hankyu.神戸線",
  },
];

// 写した駅の ID。路線の ID と駅名から作る
export function buildExtendedStationId(lineId: string, source: StationNode): string {
  return `${lineId}.${source.name}`;
}

// 同じ路線の辺だけをたどり、2 駅の間の距離（km）を求める。たどれなければ null
function measureLineDistance(
  edges: readonly RideEdge[],
  lineId: string,
  fromId: string,
  toId: string,
): number | null {
  const adjacent = new Map<string, { to: string; km: number }[]>();
  for (const e of edges) {
    if (e.lineId !== lineId) continue;
    adjacent.set(e.from, [...(adjacent.get(e.from) ?? []), { to: e.to, km: e.distanceKm }]);
    adjacent.set(e.to, [...(adjacent.get(e.to) ?? []), { to: e.from, km: e.distanceKm }]);
  }
  const dist = new Map<string, number>([[fromId, 0]]);
  const queue = [fromId];
  while (queue.length > 0) {
    queue.sort((a, b) => (dist.get(a) ?? 0) - (dist.get(b) ?? 0));
    const current = queue.shift() as string;
    if (current === toId) return Math.round((dist.get(current) ?? 0) * 100) / 100;
    for (const next of adjacent.get(current) ?? []) {
      const d = (dist.get(current) ?? 0) + next.km;
      if (d < (dist.get(next.to) ?? Number.POSITIVE_INFINITY)) {
        dist.set(next.to, d);
        queue.push(next.to);
      }
    }
  }
  return null;
}

function extendSegments(line: LineInfo, newId: string, joinId: string, km: number): LineInfo {
  return {
    ...line,
    segments: line.segments.map((seg) =>
      seg.stationIds[0] === joinId && !seg.loop
        ? {
            ...seg,
            stationIds: [newId, ...seg.stationIds],
            cumulativeKm: [0, ...seg.cumulativeKm.map((c) => Math.round((c + km) * 100) / 100)],
            lengthKm: Math.round((seg.lengthKm + km) * 100) / 100,
          }
        : seg,
    ),
  };
}

// 乗換の辺を写す。写した元の駅を新しい駅に置き換え、元の駅との乗換も足す
function copyTransfers(
  transfers: readonly TransferEdge[],
  sourceId: string,
  newId: string,
): TransferEdge[] {
  const copied = transfers.flatMap((t): TransferEdge[] => {
    if (t.from === sourceId) return [{ ...t, from: newId }];
    if (t.to === sourceId) return [{ ...t, to: newId }];
    return [];
  });
  // 同じ駅の路線違い。ホームが並ぶので乗換は 1 分とする
  return [
    ...copied,
    { from: newId, to: sourceId, walkMeters: 0, walkMinutes: 1, walkMetersRoute: 0 },
  ];
}

const corrected = new WeakMap<NetworkData, NetworkData>();

// 補正を足した網を返す。同じ網には 1 度だけ足し、結果を使い回す
export function applyNetworkCorrections(
  network: NetworkData,
  extensions: readonly TerminalExtension[] = TERMINAL_EXTENSIONS,
): NetworkData {
  const cached = corrected.get(network);
  if (cached && extensions === TERMINAL_EXTENSIONS) return cached;

  let next = network;
  for (const ext of extensions) {
    const source = next.nodes.find((n) => n.stationId === ext.sourceStationId);
    const join = next.nodes.find((n) => n.stationId === ext.joinStationId);
    const line = next.lines.find((l) => l.lineId === ext.lineId);
    if (!source || !join || !line) continue;
    const newId = buildExtendedStationId(ext.lineId, source);
    // すでに路線データに駅があれば足さない
    if (next.nodes.some((n) => n.stationId === newId)) continue;
    const viaJoin = next.nodes.find((n) => n.lineId === ext.viaLineId && n.name === join.name);
    const km = viaJoin
      ? measureLineDistance(next.edges, ext.viaLineId, ext.sourceStationId, viaJoin.stationId)
      : null;
    if (km === null) continue;

    next = {
      ...next,
      nodes: [...next.nodes, { ...source, stationId: newId, lineId: ext.lineId }],
      lines: next.lines.map((l) =>
        l.lineId === ext.lineId ? extendSegments(l, newId, ext.joinStationId, km) : l,
      ),
      edges: [
        ...next.edges,
        {
          from: newId,
          to: ext.joinStationId,
          lineId: ext.lineId,
          lineType: line.lineType,
          distanceKm: km,
        },
      ],
      transfers: [...next.transfers, ...copyTransfers(next.transfers, ext.sourceStationId, newId)],
    };
  }
  if (extensions === TERMINAL_EXTENSIONS) {
    corrected.set(network, next);
    corrected.set(next, next);
  }
  return next;
}

// 補正で写した駅と、写した元の駅の対応。到達範囲など駅 ID で引くデータを共有するのに使う
export function listExtendedStationAliases(
  network: NetworkData,
  extensions: readonly TerminalExtension[] = TERMINAL_EXTENSIONS,
): { stationId: string; sourceStationId: string }[] {
  return extensions.flatMap((ext) => {
    const source = network.nodes.find((n) => n.stationId === ext.sourceStationId);
    return source
      ? [
          {
            stationId: buildExtendedStationId(ext.lineId, source),
            sourceStationId: source.stationId,
          },
        ]
      : [];
  });
}
