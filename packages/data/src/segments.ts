import type { LineSegment } from "@repo/geo";
import { roundTo } from "./geometry.ts";
import type { StationAdjacency } from "./topology.ts";

// 隣接関係から路線の駅の並びを作る
// 一本道ならその順に、環状ならひと回りに、分岐があれば分岐駅で区間を分ける

export type SegmentResult = {
  segments: LineSegment[];
  // 並びに問題がある場合の説明（分岐・孤立駅・複数の塊）
  issues: string[];
};

type Neighbors = Map<string, Map<string, number>>;

function buildNeighbors(ids: readonly string[], edges: readonly StationAdjacency[]): Neighbors {
  const neighbors: Neighbors = new Map(ids.map((id) => [id, new Map<string, number>()]));
  for (const e of edges) {
    neighbors.get(e.a)?.set(e.b, e.distanceKm);
    neighbors.get(e.b)?.set(e.a, e.distanceKm);
  }
  return neighbors;
}

function collectComponents(ids: readonly string[], neighbors: Neighbors): string[][] {
  const seen = new Set<string>();
  const components: string[][] = [];
  for (const id of ids) {
    if (seen.has(id)) continue;
    const stack = [id];
    const component: string[] = [];
    seen.add(id);
    while (stack.length > 0) {
      const v = stack.pop() as string;
      component.push(v);
      for (const w of neighbors.get(v)?.keys() ?? []) {
        if (!seen.has(w)) {
          seen.add(w);
          stack.push(w);
        }
      }
    }
    components.push(component);
  }
  return components;
}

function buildSegment(stationIds: string[], neighbors: Neighbors, loop: boolean): LineSegment {
  const cumulativeKm = [0];
  let total = 0;
  for (let i = 1; i < stationIds.length; i++) {
    total += neighbors.get(stationIds[i - 1] as string)?.get(stationIds[i] as string) ?? 0;
    cumulativeKm.push(roundTo(total, 2));
  }
  if (loop && stationIds.length > 2) {
    const last = stationIds[stationIds.length - 1] as string;
    total += neighbors.get(last)?.get(stationIds[0] as string) ?? 0;
  }
  return { stationIds, cumulativeKm, loop, lengthKm: roundTo(total, 2) };
}

// 端の駅から次数2の駅をたどり、次数2でない駅で止まる
function walkChain(start: string, next: string, neighbors: Neighbors): string[] {
  const chain = [start, next];
  let prev = start;
  let curr = next;
  while ((neighbors.get(curr)?.size ?? 0) === 2) {
    const candidates = [...(neighbors.get(curr)?.keys() ?? [])].filter((w) => w !== prev);
    const following = candidates[0];
    if (following === undefined || following === start) break;
    chain.push(following);
    prev = curr;
    curr = following;
  }
  return chain;
}

function orientChain(chain: string[], rankStart: (id: string) => number): string[] {
  const first = chain[0] as string;
  const last = chain[chain.length - 1] as string;
  return rankStart(last) < rankStart(first) ? [...chain].reverse() : chain;
}

// 環状の区間は rankStart が最小の駅から、隣接駅のうち ID の小さい方へ回る
function orderLoop(component: string[], neighbors: Neighbors, rankStart: (id: string) => number) {
  const start = [...component].sort((a, b) => rankStart(a) - rankStart(b))[0] as string;
  const firstStep = [...(neighbors.get(start)?.keys() ?? [])].sort()[0] as string;
  const chain = walkChain(start, firstStep, neighbors);
  if (chain[chain.length - 1] === start) chain.pop();
  return chain;
}

export function buildSegments(
  ids: readonly string[],
  edges: readonly StationAdjacency[],
  rankStart: (id: string) => number,
): SegmentResult {
  const neighbors = buildNeighbors(ids, edges);
  const issues: string[] = [];
  const segments: LineSegment[] = [];
  const components = collectComponents(ids, neighbors);
  if (components.length > 1) issues.push(`線路が ${components.length} つの塊に分かれている`);

  for (const component of components) {
    if (component.length === 1) {
      issues.push(`隣接駅のない駅: ${component[0]}`);
      segments.push(buildSegment(component, neighbors, false));
      continue;
    }
    const degreeOf = (id: string) => neighbors.get(id)?.size ?? 0;
    const ends = component.filter((id) => degreeOf(id) !== 2);
    if (ends.length === 0) {
      segments.push(buildSegment(orderLoop(component, neighbors, rankStart), neighbors, true));
      continue;
    }
    const branches = ends.filter((id) => degreeOf(id) >= 3);
    if (branches.length > 0) issues.push(`分岐駅: ${branches.join(", ")}`);

    // 端または分岐駅から出る辺ごとに区間をたどる。同じ辺を二度たどらない
    const used = new Set<string>();
    const edgeKey = (a: string, b: string) => (a < b ? `${a}|${b}` : `${b}|${a}`);
    for (const end of [...ends].sort((a, b) => rankStart(a) - rankStart(b))) {
      for (const next of [...(neighbors.get(end)?.keys() ?? [])].sort()) {
        if (used.has(edgeKey(end, next))) continue;
        const chain = walkChain(end, next, neighbors);
        for (let i = 1; i < chain.length; i++) {
          used.add(edgeKey(chain[i - 1] as string, chain[i] as string));
        }
        segments.push(buildSegment(orientChain(chain, rankStart), neighbors, false));
      }
    }
  }
  return { segments, issues };
}
