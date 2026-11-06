// 路線の線路の形から、2 点の間を切り出す。地図で路線を描く形と同じ線にそろえるための純関数

export type TrackPosition = [number, number];
export type TrackParts = readonly (readonly TrackPosition[])[];
export type TrackGeometry =
  | { type: "LineString"; coordinates: TrackPosition[] }
  | { type: "MultiLineString"; coordinates: TrackPosition[][] };

// 駅の点から線路までこの距離より離れていれば、その線路の上の駅とみなさない
export const TRACK_SNAP_MAX_METERS = 600;
// 線路の部品の端どうしがこの距離以内なら、つながっているとみなす
export const TRACK_JOIN_METERS = 60;

const METERS_PER_DEG_LAT = 111_320;

type Graph = {
  points: TrackPosition[];
  edges: Map<number, { to: number; meters: number }[]>;
  // 線路の各区間の両端の点の番号
  segments: [number, number][];
};

// 短い距離の近似。関西の範囲では十分に正確
function measureMeters(a: TrackPosition, b: TrackPosition): number {
  const lat = ((a[1] + b[1]) / 2) * (Math.PI / 180);
  const dx = (b[0] - a[0]) * METERS_PER_DEG_LAT * Math.cos(lat);
  const dy = (b[1] - a[1]) * METERS_PER_DEG_LAT;
  return Math.hypot(dx, dy);
}

export function listTrackParts(geometry: TrackGeometry): TrackPosition[][] {
  return geometry.type === "LineString" ? [geometry.coordinates] : geometry.coordinates;
}

function addEdge(graph: Graph, a: number, b: number, meters: number): void {
  if (a === b) return;
  graph.edges.set(a, [...(graph.edges.get(a) ?? []), { to: b, meters }]);
  graph.edges.set(b, [...(graph.edges.get(b) ?? []), { to: a, meters }]);
}

// 部品の頂点を共有の点にまとめ、隣り合う頂点と、近い部品の端どうしを結ぶ
function buildTrackGraph(parts: TrackParts): Graph {
  const graph: Graph = { points: [], edges: new Map(), segments: [] };
  const byKey = new Map<string, number>();
  const indexOf = (p: TrackPosition) => {
    const key = `${p[0].toFixed(6)},${p[1].toFixed(6)}`;
    const found = byKey.get(key);
    if (found !== undefined) return found;
    graph.points.push([p[0], p[1]]);
    byKey.set(key, graph.points.length - 1);
    return graph.points.length - 1;
  };
  const ends: number[] = [];
  for (const part of parts) {
    if (part.length === 0) continue;
    const ids = part.map(indexOf);
    for (let i = 1; i < ids.length; i++) {
      const a = ids[i - 1] as number;
      const b = ids[i] as number;
      if (a === b) continue;
      addEdge(
        graph,
        a,
        b,
        measureMeters(graph.points[a] as TrackPosition, graph.points[b] as TrackPosition),
      );
      graph.segments.push([a, b]);
    }
    ends.push(ids[0] as number, ids.at(-1) as number);
  }
  for (let i = 0; i < ends.length; i++) {
    for (let j = i + 1; j < ends.length; j++) {
      const a = ends[i] as number;
      const b = ends[j] as number;
      const meters = measureMeters(
        graph.points[a] as TrackPosition,
        graph.points[b] as TrackPosition,
      );
      if (a !== b && meters <= TRACK_JOIN_METERS) addEdge(graph, a, b, meters);
    }
  }
  return graph;
}

const graphCache = new WeakMap<TrackParts, Graph>();

function loadTrackGraph(parts: TrackParts): Graph {
  const cached = graphCache.get(parts);
  if (cached) return cached;
  const graph = buildTrackGraph(parts);
  graphCache.set(parts, graph);
  return graph;
}

type Projection = { segment: [number, number]; point: TrackPosition; meters: number };

// 点を線路の最も近い区間へ下ろす
function projectOntoTrack(graph: Graph, p: TrackPosition): Projection | null {
  let best: Projection | null = null;
  const cos = Math.cos(p[1] * (Math.PI / 180));
  for (const segment of graph.segments) {
    const a = graph.points[segment[0]] as TrackPosition;
    const b = graph.points[segment[1]] as TrackPosition;
    // 経度を縮めた平面で射影する
    const ax = (a[0] - p[0]) * cos;
    const ay = a[1] - p[1];
    const bx = (b[0] - p[0]) * cos;
    const by = b[1] - p[1];
    const dx = bx - ax;
    const dy = by - ay;
    const length = dx * dx + dy * dy;
    const t = length === 0 ? 0 : Math.max(0, Math.min(1, -(ax * dx + ay * dy) / length));
    const point: TrackPosition = [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
    const meters = measureMeters(p, point);
    if (best === null || meters < best.meters) best = { segment, point, meters };
  }
  return best;
}

// 小さな二分ヒープ。距離の短い順に取り出す
function createQueue() {
  const heap: [number, number][] = [];
  return {
    size: () => heap.length,
    push(item: [number, number]) {
      heap.push(item);
      let i = heap.length - 1;
      while (i > 0) {
        const parent = (i - 1) >> 1;
        if ((heap[parent] as [number, number])[0] <= item[0]) break;
        heap[i] = heap[parent] as [number, number];
        i = parent;
      }
      heap[i] = item;
    },
    pop(): [number, number] {
      const top = heap[0] as [number, number];
      const last = heap.pop() as [number, number];
      if (heap.length > 0) {
        let i = 0;
        for (;;) {
          const left = 2 * i + 1;
          const right = left + 1;
          let smallest = i;
          const value = (k: number) => (k === i ? last[0] : (heap[k] as [number, number])[0]);
          if (left < heap.length && value(left) < value(smallest)) smallest = left;
          if (right < heap.length && value(right) < value(smallest)) smallest = right;
          if (smallest === i) break;
          heap[i] = heap[smallest] as [number, number];
          i = smallest;
        }
        heap[i] = last;
      }
      return top;
    },
  };
}

// 線路の形の上で、from と to の間の道筋を返す。両端は線路へ下ろした点にする
// 線路から離れすぎた点や、線路がつながらない 2 点では null を返す
export function sliceTrackBetween(
  parts: TrackParts,
  from: TrackPosition,
  to: TrackPosition,
): TrackPosition[] | null {
  const graph = loadTrackGraph(parts);
  const start = projectOntoTrack(graph, from);
  const goal = projectOntoTrack(graph, to);
  if (!start || !goal) return null;
  if (start.meters > TRACK_SNAP_MAX_METERS || goal.meters > TRACK_SNAP_MAX_METERS) return null;

  // 下ろした 2 点を仮の点として足す。番号は既存の点の後ろにする
  const startId = graph.points.length;
  const goalId = startId + 1;
  const extra = new Map<number, { to: number; meters: number }[]>();
  const link = (a: number, b: number, meters: number) => {
    extra.set(a, [...(extra.get(a) ?? []), { to: b, meters }]);
    extra.set(b, [...(extra.get(b) ?? []), { to: a, meters }]);
  };
  const pointOf = (id: number): TrackPosition =>
    id === startId ? start.point : id === goalId ? goal.point : (graph.points[id] as TrackPosition);
  for (const [id, projection] of [
    [startId, start],
    [goalId, goal],
  ] as const) {
    for (const end of projection.segment)
      link(id, end, measureMeters(projection.point, pointOf(end)));
  }
  // 2 点が同じ区間の上なら、区間の中で直接つなぐ
  const sameSegment = start.segment[0] === goal.segment[0] && start.segment[1] === goal.segment[1];
  if (sameSegment) link(startId, goalId, measureMeters(start.point, goal.point));

  const dist = new Map<number, number>([[startId, 0]]);
  const prev = new Map<number, number>();
  const queue = createQueue();
  queue.push([0, startId]);
  while (queue.size() > 0) {
    const [d, current] = queue.pop();
    if (d > (dist.get(current) ?? Number.POSITIVE_INFINITY)) continue;
    if (current === goalId) break;
    const neighbors = [...(graph.edges.get(current) ?? []), ...(extra.get(current) ?? [])];
    for (const { to: next, meters } of neighbors) {
      const candidate = d + meters;
      if (candidate < (dist.get(next) ?? Number.POSITIVE_INFINITY)) {
        dist.set(next, candidate);
        prev.set(next, current);
        queue.push([candidate, next]);
      }
    }
  }
  if (!dist.has(goalId)) return null;
  const path: TrackPosition[] = [];
  for (let id: number | undefined = goalId; id !== undefined; id = prev.get(id)) {
    path.unshift(pointOf(id));
    if (id === startId) break;
  }
  return path;
}
