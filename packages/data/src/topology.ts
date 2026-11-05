import { type Coord, computeDistanceMeters, computePolylineKm } from "./geometry.ts";

// 線路のつながりから隣接駅を求める
// 国土数値情報の線路区間は駅の端点で区切られているので、区間の端点を頂点とするグラフを作り、
// 各駅から最短路で探索して最初に当たった別の駅を隣接駅とする。分岐や駅間の分岐点も扱える

export type TrackStation = {
  code: string;
  features: Coord[][];
};

export type StationAdjacency = {
  a: string;
  b: string;
  distanceKm: number;
};

type GraphEdge = { to: number; km: number };

// 端点の一致判定の格子（約1m）。端点がわずかにずれたデータを同じ頂点にまとめる
const SNAP_DIGITS = 5;
const SNAP_RADIUS_M = 3;
const MAX_SEARCH_KM = 40;

function buildVertexKey(coord: Coord): string {
  return `${coord[0].toFixed(SNAP_DIGITS)},${coord[1].toFixed(SNAP_DIGITS)}`;
}

class VertexIndex {
  readonly coords: Coord[] = [];
  private readonly byKey = new Map<string, number>();

  resolve(coord: Coord): number {
    const key = buildVertexKey(coord);
    const found = this.byKey.get(key);
    if (found !== undefined) return found;
    const nearby = this.findNearby(coord);
    const id = nearby ?? this.coords.length;
    if (nearby === undefined) this.coords.push(coord);
    this.byKey.set(key, id);
    return id;
  }

  // 近傍の格子を見て、半径内の既存頂点を探す
  private findNearby(coord: Coord): number | undefined {
    const step = 10 ** -SNAP_DIGITS;
    for (const dx of [-step, 0, step]) {
      for (const dy of [-step, 0, step]) {
        const id = this.byKey.get(buildVertexKey([coord[0] + dx, coord[1] + dy]));
        const other = id === undefined ? undefined : this.coords[id];
        if (id !== undefined && other && computeDistanceMeters(coord, other) <= SNAP_RADIUS_M) {
          return id;
        }
      }
    }
    return undefined;
  }
}

class MinHeap {
  private readonly items: [number, number][] = [];

  get size(): number {
    return this.items.length;
  }

  push(priority: number, value: number): void {
    const items = this.items;
    items.push([priority, value]);
    let i = items.length - 1;
    while (i > 0) {
      const parent = (i - 1) >> 1;
      const p = items[parent];
      const c = items[i];
      if (!p || !c || p[0] <= c[0]) break;
      items[parent] = c;
      items[i] = p;
      i = parent;
    }
  }

  pop(): [number, number] | undefined {
    const items = this.items;
    const top = items[0];
    const last = items.pop();
    if (!top || !last || items.length === 0) return top;
    items[0] = last;
    let i = 0;
    for (;;) {
      const l = 2 * i + 1;
      const r = l + 1;
      let smallest = i;
      const s = items[smallest];
      const li = items[l];
      const ri = items[r];
      if (li && s && li[0] < s[0]) smallest = l;
      const s2 = items[smallest];
      if (ri && s2 && ri[0] < s2[0]) smallest = r;
      if (smallest === i) break;
      const a = items[i];
      const b = items[smallest];
      if (!a || !b) break;
      items[i] = b;
      items[smallest] = a;
      i = smallest;
    }
    return top;
  }
}

function addEdge(graph: Map<number, GraphEdge[]>, from: number, to: number, km: number): void {
  const list = graph.get(from) ?? [];
  list.push({ to, km });
  graph.set(from, list);
}

// 駅から最短路で探索し、別の駅の頂点に当たったらそこで止めて隣接駅とする
function searchNeighbors(
  start: number[],
  graph: Map<number, GraphEdge[]>,
  owner: Map<number, number>,
  self: number,
): Map<number, number> {
  const dist = new Map<number, number>();
  const heap = new MinHeap();
  for (const v of start) {
    dist.set(v, 0);
    heap.push(0, v);
  }
  const found = new Map<number, number>();
  while (heap.size > 0) {
    const item = heap.pop();
    if (!item) break;
    const [d, v] = item;
    if (d > (dist.get(v) ?? Number.POSITIVE_INFINITY) || d > MAX_SEARCH_KM) continue;
    const o = owner.get(v);
    if (o !== undefined && o !== self) {
      if (!found.has(o)) found.set(o, d);
      continue;
    }
    for (const e of graph.get(v) ?? []) {
      const nd = d + e.km;
      if (nd < (dist.get(e.to) ?? Number.POSITIVE_INFINITY)) {
        dist.set(e.to, nd);
        heap.push(nd, e.to);
      }
    }
  }
  return found;
}

// 駅の中心どうしの距離 = 端点間の最短路 + 両駅の線データの長さの半分
export function findAdjacentStations(
  sections: readonly Coord[][],
  stations: readonly TrackStation[],
): StationAdjacency[] {
  const index = new VertexIndex();
  const graph = new Map<number, GraphEdge[]>();
  const addLine = (coords: Coord[]) => {
    const first = coords[0];
    const last = coords[coords.length - 1];
    if (!first || !last) return;
    const a = index.resolve(first);
    const b = index.resolve(last);
    const km = computePolylineKm(coords);
    addEdge(graph, a, b, km);
    addEdge(graph, b, a, km);
  };
  for (const s of sections) addLine(s);

  const owner = new Map<number, number>();
  const startVertices: number[][] = [];
  const halfKm: number[] = [];
  stations.forEach((station, i) => {
    const vertices = new Set<number>();
    let totalKm = 0;
    for (const f of station.features) {
      addLine(f);
      const first = f[0];
      const last = f[f.length - 1];
      if (first) vertices.add(index.resolve(first));
      if (last) vertices.add(index.resolve(last));
      totalKm += computePolylineKm(f);
    }
    for (const v of vertices) if (!owner.has(v)) owner.set(v, i);
    startVertices.push([...vertices]);
    halfKm.push(station.features.length > 0 ? totalKm / station.features.length / 2 : 0);
  });

  const best = new Map<string, StationAdjacency>();
  stations.forEach((station, i) => {
    const found = searchNeighbors(startVertices[i] ?? [], graph, owner, i);
    for (const [j, d] of found) {
      const other = stations[j];
      if (!other) continue;
      const km = d + (halfKm[i] ?? 0) + (halfKm[j] ?? 0);
      const [a, b] =
        station.code < other.code ? [station.code, other.code] : [other.code, station.code];
      const key = `${a}|${b}`;
      const prev = best.get(key);
      if (!prev || km < prev.distanceKm) best.set(key, { a, b, distanceKm: km });
    }
  });
  return [...best.values()];
}

// 迂回の辺を除く。A-C の距離が A-B-C の経由とほぼ同じなら、A-C は B を通り越す線路なので除く
export function removeBypassEdges(edges: readonly StationAdjacency[]): StationAdjacency[] {
  const neighbors = new Map<string, Map<string, number>>();
  const link = (a: string, b: string, km: number) => {
    const m = neighbors.get(a) ?? new Map<string, number>();
    m.set(b, km);
    neighbors.set(a, m);
  };
  for (const e of edges) {
    link(e.a, e.b, e.distanceKm);
    link(e.b, e.a, e.distanceKm);
  }
  return edges.filter((e) => {
    const fromA = neighbors.get(e.a);
    const fromB = neighbors.get(e.b);
    if (!fromA || !fromB) return true;
    for (const [mid, kmA] of fromA) {
      if (mid === e.b) continue;
      const kmB = fromB.get(mid);
      if (kmB !== undefined && kmA + kmB <= e.distanceKm * 1.1 + 0.2) return false;
    }
    return true;
  });
}
