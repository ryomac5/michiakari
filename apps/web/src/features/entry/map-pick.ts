import type { ScreenPoint } from "@/features/map/bubble-layout";
import type { LabelSide } from "./areas";
import type { DirectionStop, EntryDirection } from "./directions";
import type { EntryLine, Position } from "./entry-places";

// 入口の地図で、路線・方面・行き先・駅の間を押して選ぶための純粋な計算

// 路線の札。駅から路線の最初の方面へ少し進んだ線の上に置く
export type LinePick = { line: EntryLine; position: Position };

// 路線の札を置く点の、隣の駅までの割合
const lineLabelRatio = 0.75;
// 方面を選んだあとに地図へ名前を出す、方面の先の駅の数
export const ROUTE_STOP_LIMIT = 6;
// 車内の駅の間を地図で選ぶとき、選んでいる駅の間の前後に出す駅の間の数
const segmentWindow = 3;

// 緯度経度の差を、その場所の m に直す
function toMeters(from: Position, to: Position): { x: number; y: number } {
  const metersPerDegree = 111_320;
  return {
    x: (to[0] - from[0]) * metersPerDegree * Math.cos((from[1] * Math.PI) / 180),
    y: (to[1] - from[1]) * metersPerDegree,
  };
}

// 点から線分までの距離（m）
export function measureSegmentDistance(point: Position, a: Position, b: Position): number {
  const ab = toMeters(a, b);
  const ap = toMeters(a, point);
  const length = ab.x * ab.x + ab.y * ab.y;
  const t = length === 0 ? 0 : Math.max(0, Math.min(1, (ap.x * ab.x + ap.y * ab.y) / length));
  const dx = ap.x - ab.x * t;
  const dy = ap.y - ab.y * t;
  return Math.hypot(dx, dy);
}

// 点から折れ線までの距離（m）。点が 1 つだけなら、その点までの距離
export function measurePathDistance(point: Position, path: readonly Position[]): number {
  const [first] = path;
  if (!first) return Number.POSITIVE_INFINITY;
  if (path.length === 1) return measureSegmentDistance(point, first, first);
  let best = Number.POSITIVE_INFINITY;
  for (let i = 0; i + 1 < path.length; i++) {
    const a = path[i];
    const b = path[i + 1];
    if (a && b) best = Math.min(best, measureSegmentDistance(point, a, b));
  }
  return best;
}

// 駅の路線ごとに札の位置を決める。最初の方面の隣の駅との中ほどに置く
// 同じ位置になる路線は、次の方面の側へ回して重ならないようにする
export function listLinePicks(
  lines: readonly EntryLine[],
  origin: Position,
  directionsOf: (line: EntryLine) => readonly EntryDirection[],
): LinePick[] {
  const picks: LinePick[] = [];
  for (const line of lines) {
    const used = new Set(picks.map((p) => p.position.join(",")));
    const points = directionsOf(line).flatMap((d) => {
      const next = d.stops[0];
      if (!next) return [];
      const position: Position = [
        origin[0] + (next.position[0] - origin[0]) * lineLabelRatio,
        origin[1] + (next.position[1] - origin[1]) * lineLabelRatio,
      ];
      return [position];
    });
    const position = points.find((p) => !used.has(p.join(","))) ?? points[0];
    if (position) picks.push({ line, position });
  }
  return picks;
}

// 押した点に近い路線を選ぶ。同じ路線データに通称が複数あれば、通称の方面の駅に近いほうにする
export function pickLineAt(
  options: readonly { line: EntryLine; path: readonly Position[] }[],
  point: Position,
): EntryLine | null {
  let best: { line: EntryLine; meters: number } | null = null;
  for (const option of options) {
    const meters = measurePathDistance(point, option.path);
    if (!best || meters < best.meters) best = { line: option.line, meters };
  }
  return best?.line ?? null;
}

// 地図の線から、押した点にいちばん近い路線の ID を返す
export function findNearestLineId(
  features: readonly { lineId: string; paths: readonly (readonly Position[])[] }[],
  point: Position,
): string | null {
  let best: { lineId: string; meters: number } | null = null;
  for (const feature of features) {
    for (const path of feature.paths) {
      const meters = measurePathDistance(point, path);
      if (!best || meters < best.meters) best = { lineId: feature.lineId, meters };
    }
  }
  return best?.lineId ?? null;
}

// 方面を選んだあとに地図へ出す駅。方面の先の駅を近い順に出す
export function listRouteStops(
  direction: EntryDirection,
  limit = ROUTE_STOP_LIMIT,
): DirectionStop[] {
  return direction.stops.slice(0, limit);
}

// 方面を選んだあとの行き先の候補。地図に出した駅を先に並べ、ほかの候補を後ろに続ける
export function mergeRouteCandidates(
  routeStops: readonly DirectionStop[],
  candidates: readonly DirectionStop[],
): DirectionStop[] {
  const merged = [...routeStops, ...candidates];
  return merged.filter((s, i) => merged.findIndex((o) => o.choice.id === s.choice.id) === i);
}

// 押した駅が方面の先にあるか。あれば選んだ路線と方面をそのまま使う
export function isOnRoute(direction: EntryDirection | null, stationId: string): boolean {
  return direction?.stops.some((s) => s.choice.id === stationId) ?? false;
}

// 車内の駅の間。index は stops の並びでの前の駅の位置
export type SegmentPick = { index: number; from: DirectionStop; to: DirectionStop };

// 選んでいる駅の間の前後だけを地図に出す。端では反対側へ寄せて数をそろえる
export function listSegmentWindow(
  stops: readonly DirectionStop[],
  index: number,
  reach = segmentWindow,
): SegmentPick[] {
  const count = Math.max(0, stops.length - 1);
  if (count === 0) return [];
  const span = reach * 2 + 1;
  const start = Math.max(0, Math.min(index - reach, count - span));
  const end = Math.min(count, start + span);
  const picks: SegmentPick[] = [];
  for (let i = start; i < end; i++) {
    const from = stops[i];
    const to = stops[i + 1];
    if (from && to) picks.push({ index: i, from, to });
  }
  return picks;
}

// 押した点に一番近い駅の間を返す。
// maxMeters より遠ければ、押した線は候補の外とみなして決めない
export function findNearestSegment(
  segments: readonly SegmentPick[],
  point: Position,
  maxMeters = Number.POSITIVE_INFINITY,
): SegmentPick | null {
  let best: { segment: SegmentPick; meters: number } | null = null;
  for (const segment of segments) {
    const meters = measureSegmentDistance(point, segment.from.position, segment.to.position);
    if (meters <= maxMeters && (!best || meters < best.meters)) best = { segment, meters };
  }
  return best?.segment ?? null;
}

// 駅の間の押せる丸の半径（px）。駅の印の押せる丸に届かず、ほかの駅の間の丸とは中点の内側に収める
// 小さすぎれば null にし、印だけを出して線を押して選ぶ
export function computeSegmentHitRadii(
  points: readonly ScreenPoint[],
  markers: readonly { point: ScreenPoint; radius: number }[],
  max = 22,
  min = 10,
): (number | null)[] {
  return points.map((point, i) => {
    let radius = max;
    for (const marker of markers) {
      const gap = Math.hypot(point.x - marker.point.x, point.y - marker.point.y) - marker.radius;
      radius = Math.min(radius, gap);
    }
    points.forEach((other, j) => {
      if (j !== i) radius = Math.min(radius, Math.hypot(point.x - other.x, point.y - other.y) / 2);
    });
    return radius >= min ? Math.floor(radius) : null;
  });
}

// 駅の間の中ほどの点
export function computeMidpoint(a: Position, b: Position): Position {
  return [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
}

// 選んだ駅の名前の札を、地図に出す札の向きと反対の側に置く
export function selectAwaySide(origin: Position, points: readonly Position[]): LabelSide | null {
  let x = 0;
  let y = 0;
  for (const point of points) {
    const d = toMeters(origin, point);
    const length = Math.hypot(d.x, d.y);
    if (length === 0) continue;
    x += d.x / length;
    y += d.y / length;
  }
  if (Math.hypot(x, y) < 1e-6) return null;
  if (Math.abs(x) > Math.abs(y)) return x > 0 ? "left" : "right";
  return y > 0 ? "bottom" : "top";
}
