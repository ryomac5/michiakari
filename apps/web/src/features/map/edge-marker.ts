import type { Rect } from "./bubble-layout";

// 画面の外にある行き先を、見える範囲の縁に札で示すための純関数

export type EdgeMarker = {
  // 札の中心。地図の左上が原点の px
  x: number;
  y: number;
  // 行き先の向き。右が 0、時計回りの度
  angle: number;
};

// 点が見える範囲の内側なら null。外なら、範囲の中心から点へ向かう線が縁と交わる点を返す
// size は札の大きさ。札が範囲からはみ出さないよう、その半分だけ内側に寄せる
export function placeEdgeMarker(
  point: { x: number; y: number },
  view: Rect,
  size: { w: number; h: number },
  // 重ねたくない札と印の矩形
  avoid: readonly Rect[] = [],
): EdgeMarker | null {
  if (
    point.x >= view.left &&
    point.x <= view.right &&
    point.y >= view.top &&
    point.y <= view.bottom
  )
    return null;
  const inner = {
    left: view.left + size.w / 2,
    right: view.right - size.w / 2,
    top: view.top + size.h / 2,
    bottom: view.bottom - size.h / 2,
  };
  const center = { x: (view.left + view.right) / 2, y: (view.top + view.bottom) / 2 };
  const dx = point.x - center.x;
  const dy = point.y - center.y;
  const halfW = Math.max(1, (inner.right - inner.left) / 2);
  const halfH = Math.max(1, (inner.bottom - inner.top) / 2);
  const scale = Math.min(
    dx === 0 ? Number.POSITIVE_INFINITY : halfW / Math.abs(dx),
    dy === 0 ? Number.POSITIVE_INFINITY : halfH / Math.abs(dy),
  );
  const base = { x: center.x + dx * scale, y: center.y + dy * scale };
  const angle = (Math.atan2(dy, dx) * 180) / Math.PI;
  // 今いる位置や駅の札に重なるなら、縁に沿ってずらす。縁の上の空いた点のうち、元の点にいちばん近いものを選ぶ
  // どこに置いても重なるなら札を出さない。行き先は「全体を見る」で見られる
  const placed = findFreeEdgePoint(base, size, avoid, inner);
  return placed ? { ...placed, angle } : null;
}

const slideStepPx = 12;

function overlaps(a: Rect, b: Rect): boolean {
  return a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;
}

// 内側の縁を一周する点の候補
function listEdgePoints(inner: Rect): { x: number; y: number }[] {
  const points: { x: number; y: number }[] = [];
  for (let x = inner.left; x <= inner.right; x += slideStepPx) {
    points.push({ x, y: inner.top }, { x, y: inner.bottom });
  }
  for (let y = inner.top; y <= inner.bottom; y += slideStepPx) {
    points.push({ x: inner.left, y }, { x: inner.right, y });
  }
  return points;
}

function findFreeEdgePoint(
  base: { x: number; y: number },
  size: { w: number; h: number },
  avoid: readonly Rect[],
  inner: Rect,
): { x: number; y: number } | null {
  const rectAt = (p: { x: number; y: number }): Rect => ({
    left: p.x - size.w / 2,
    right: p.x + size.w / 2,
    top: p.y - size.h / 2,
    bottom: p.y + size.h / 2,
  });
  const free = (p: { x: number; y: number }) => avoid.every((r) => !overlaps(rectAt(p), r));
  if (free(base)) return base;
  const candidates = listEdgePoints(inner)
    .filter(free)
    .sort(
      (a, b) => Math.hypot(a.x - base.x, a.y - base.y) - Math.hypot(b.x - base.x, b.y - base.y),
    );
  return candidates[0] ?? null;
}
