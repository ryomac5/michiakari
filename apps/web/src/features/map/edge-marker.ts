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
  return {
    x: center.x + dx * scale,
    y: center.y + dy * scale,
    angle: (Math.atan2(dy, dx) * 180) / Math.PI,
  };
}
