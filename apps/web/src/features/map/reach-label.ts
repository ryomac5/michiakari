import { type BoxSize, overlapArea, type Rect, type ScreenPoint } from "./bubble-layout";

// 到達範囲の札の置き場所を、画面の上で吹き出しや線と重ならない向きから選ぶ。表示用の純関数だけを置く
// 候補は外周の方位ごとの点で、先頭ほど好ましい。重なりの少ない候補を選び、同じ重なりなら先頭を選ぶ

export type ReachLabelCandidate<T> = { key: T; point: ScreenPoint };

export type ReachLabelContext = {
  // 札の大きさ（px）
  size: BoxSize;
  // 札を収めたい範囲（上部の帯とシートを除いた画面）
  view: Rect;
  // 札で隠したくない矩形。吹き出し、現在地の札、ボタン
  boxes: readonly Rect[];
  // 札を掛けたくない線。路線と徒歩の道を画面の座標にしたもの
  polylines: readonly (readonly ScreenPoint[])[];
};

// 線から札までに空ける間隔（px）
const lineClearance = 6;
// 候補の順番を 1 つ下るごとに足す値。重なりが同じなら先頭の候補を選ぶ
const orderPenalty = 1;

// 札の矩形。点を中心に置く
export function buildReachLabelRect(point: ScreenPoint, size: BoxSize): Rect {
  return {
    left: point.x - size.w / 2,
    right: point.x + size.w / 2,
    top: point.y - size.h / 2,
    bottom: point.y + size.h / 2,
  };
}

function inflate(r: Rect, by: number): Rect {
  return { left: r.left - by, right: r.right + by, top: r.top - by, bottom: r.bottom + by };
}

function containsPoint(r: Rect, p: ScreenPoint): boolean {
  return p.x >= r.left && p.x <= r.right && p.y >= r.top && p.y <= r.bottom;
}

// 線分が矩形の縁をまたぐか。Liang–Barsky で区間を狭めて判定する
function segmentCrossesRect(a: ScreenPoint, b: ScreenPoint, r: Rect): boolean {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  let t0 = 0;
  let t1 = 1;
  const edges: [number, number][] = [
    [-dx, a.x - r.left],
    [dx, r.right - a.x],
    [-dy, a.y - r.top],
    [dy, r.bottom - a.y],
  ];
  for (const [p, q] of edges) {
    if (p === 0) {
      if (q < 0) return false;
      continue;
    }
    const t = q / p;
    if (p < 0) {
      if (t > t1) return false;
      if (t > t0) t0 = t;
    } else {
      if (t < t0) return false;
      if (t < t1) t1 = t;
    }
  }
  return true;
}

// 折れ線が矩形に掛かるか
export function polylineCrossesRect(line: readonly ScreenPoint[], r: Rect): boolean {
  if (line.length === 1) return containsPoint(r, line[0] as ScreenPoint);
  for (let i = 1; i < line.length; i++) {
    const a = line[i - 1] as ScreenPoint;
    const b = line[i] as ScreenPoint;
    // 線分の包含矩形が離れていれば調べない
    if (Math.max(a.x, b.x) < r.left || Math.min(a.x, b.x) > r.right) continue;
    if (Math.max(a.y, b.y) < r.top || Math.min(a.y, b.y) > r.bottom) continue;
    if (segmentCrossesRect(a, b, r)) return true;
  }
  return false;
}

// 見える範囲からはみ出す面積
function outsideArea(r: Rect, view: Rect): number {
  return (r.right - r.left) * (r.bottom - r.top) - overlapArea(r, view);
}

// 札が見える範囲に欠けずに収まるか
export function fitsInView(point: ScreenPoint, size: BoxSize, view: Rect): boolean {
  return outsideArea(buildReachLabelRect(point, size), view) <= 0;
}

// 置き場所の悪さ。はみ出し、吹き出しとの重なり、線との交差の順に重く見る
export function measureReachLabelCost(point: ScreenPoint, ctx: ReachLabelContext): number {
  const rect = buildReachLabelRect(point, ctx.size);
  const area = ctx.size.w * ctx.size.h;
  let cost = outsideArea(rect, ctx.view) * 2;
  for (const box of ctx.boxes) cost += overlapArea(rect, box) * 4;
  const guarded = inflate(rect, lineClearance);
  for (const line of ctx.polylines) {
    if (polylineCrossesRect(line, guarded)) cost += area;
  }
  return cost;
}

// 最も重なりの少ない候補を返す。候補が無ければ null
export function chooseReachLabelCandidate<T>(
  candidates: readonly ReachLabelCandidate<T>[],
  ctx: ReachLabelContext,
): ReachLabelCandidate<T> | null {
  let best: ReachLabelCandidate<T> | null = null;
  let bestCost = Number.POSITIVE_INFINITY;
  candidates.forEach((candidate, i) => {
    const cost = measureReachLabelCost(candidate.point, ctx) + i * orderPenalty;
    if (cost < bestCost) {
      bestCost = cost;
      best = candidate;
    }
  });
  return best;
}

// 札の大きさのおよそ。文字 11px に縁取りが付く
export function estimateReachLabelSize(label: string): BoxSize {
  let width = 10;
  for (const ch of label) width += /[\x20-\x7e]/.test(ch) ? 6.5 : 11;
  return { w: width, h: 18 };
}
