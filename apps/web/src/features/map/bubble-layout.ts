import type { BubblePlacement } from "./focus-areas";

// 吹き出しの置き場所を、画面の上で互いに重ならないよう選ぶ。表示用の純関数だけを置く
// 置き場所は 4 通りで、札は多くても 5 つなので、すべての組み合わせを試して最も重なりの少ないものを選ぶ

export type ScreenPoint = { x: number; y: number };
export type BoxSize = { w: number; h: number };
export type Rect = { left: number; top: number; right: number; bottom: number };

export type LayoutItem = {
  key: string;
  point: ScreenPoint;
  size: BoxSize;
  // 駅から札までの間隔（px）
  gap: number;
};

export const bubblePlacements: readonly BubblePlacement[] = ["top", "right", "bottom", "left"];

// 置き場所ごとの札の矩形。札の尾が点を指すよう、点の反対側に札を置く
export function placeBox(item: LayoutItem, placement: BubblePlacement): Rect {
  const { point: p, size: s, gap } = item;
  switch (placement) {
    case "top":
      return { left: p.x - s.w / 2, right: p.x + s.w / 2, top: p.y - gap - s.h, bottom: p.y - gap };
    case "bottom":
      return { left: p.x - s.w / 2, right: p.x + s.w / 2, top: p.y + gap, bottom: p.y + gap + s.h };
    case "left":
      return { left: p.x - gap - s.w, right: p.x - gap, top: p.y - s.h / 2, bottom: p.y + s.h / 2 };
    case "right":
      return { left: p.x + gap, right: p.x + gap + s.w, top: p.y - s.h / 2, bottom: p.y + s.h / 2 };
  }
}

export function overlapArea(a: Rect, b: Rect): number {
  const w = Math.min(a.right, b.right) - Math.max(a.left, b.left);
  const h = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
  return w > 0 && h > 0 ? w * h : 0;
}

// 見える範囲からはみ出す面積
function outsideArea(r: Rect, view: Rect): number {
  const area = (r.right - r.left) * (r.bottom - r.top);
  return area - overlapArea(r, view);
}

// 駅の点のまわり。札がほかの駅の点を隠さないよう、点も小さな矩形として扱う
const dotRadius = 12;
function dotRect(p: ScreenPoint): Rect {
  return {
    left: p.x - dotRadius,
    right: p.x + dotRadius,
    top: p.y - dotRadius,
    bottom: p.y + dotRadius,
  };
}

// 札が向く先が現在地の側なら小さく罰する。外へ広がる配置を好む
function towardPenalty(item: LayoutItem, placement: BubblePlacement, here: ScreenPoint): number {
  const dx = item.point.x - here.x;
  const dy = item.point.y - here.y;
  const toward =
    (placement === "right" && dx < 0) ||
    (placement === "left" && dx > 0) ||
    (placement === "bottom" && dy < 0) ||
    (placement === "top" && dy > 0);
  return toward ? item.size.w * item.size.h * 0.05 : 0;
}

export type LayoutInput = {
  items: readonly LayoutItem[];
  // 現在地。札の向きの好みに使う
  here: ScreenPoint;
  // 札を収めたい範囲（上部の帯とシートを除いた画面）
  view: Rect;
  // 置き場所を変えない札。現在地の札などに使う
  fixed?: Readonly<Record<string, BubblePlacement>>;
  // 既定の置き場所。同じ重なりなら、これを選ぶ
  preferred?: Readonly<Record<string, BubblePlacement>>;
  // 札で隠したくないもの。到達範囲の札など
  obstacles?: readonly Rect[];
};

export function measureLayoutCost(
  input: LayoutInput,
  placements: readonly BubblePlacement[],
): number {
  const rects = input.items.map((item, i) => placeBox(item, placements[i] as BubblePlacement));
  const dots = input.items.map((item) => dotRect(item.point));
  let cost = 0;
  rects.forEach((rect, i) => {
    const item = input.items[i] as LayoutItem;
    const placement = placements[i] as BubblePlacement;
    cost += outsideArea(rect, input.view) * 2;
    cost += towardPenalty(item, placement, input.here);
    if (input.preferred?.[item.key] && input.preferred[item.key] !== placement) cost += 1;
    for (let j = i + 1; j < rects.length; j++) cost += overlapArea(rect, rects[j] as Rect) * 4;
    for (const obstacle of input.obstacles ?? []) cost += overlapArea(rect, obstacle) * 2;
    dots.forEach((dot, j) => {
      if (j !== i) cost += overlapArea(rect, dot) * 3;
    });
  });
  return cost;
}

// 最も重なりの少ない置き場所の組み合わせを返す
export function chooseBubblePlacements(input: LayoutInput): Record<string, BubblePlacement> {
  const choices = input.items.map((item) => {
    const fixed = input.fixed?.[item.key];
    return fixed ? [fixed] : bubblePlacements;
  });
  let best: BubblePlacement[] | null = null;
  let bestCost = Number.POSITIVE_INFINITY;
  const current: BubblePlacement[] = [];
  const visit = (i: number) => {
    if (i === choices.length) {
      const cost = measureLayoutCost(input, current);
      if (cost < bestCost) {
        bestCost = cost;
        best = [...current];
      }
      return;
    }
    for (const placement of choices[i] as readonly BubblePlacement[]) {
      current[i] = placement;
      visit(i + 1);
    }
  };
  visit(0);
  const chosen = (best ?? []) as BubblePlacement[];
  return Object.fromEntries(input.items.map((item, i) => [item.key, chosen[i] ?? "right"]));
}

// 経度・緯度を、指定の拡大率の世界座標（px）にする。MapLibre のタイルの大きさ 512 に合わせる
export function projectToWorld(lonLat: readonly [number, number], zoom: number): ScreenPoint {
  const scale = 512 * 2 ** zoom;
  const lat = Math.max(-85, Math.min(85, lonLat[1]));
  const sin = Math.sin((lat * Math.PI) / 180);
  return {
    x: ((lonLat[0] + 180) / 360) * scale,
    y: (0.5 - Math.log((1 + sin) / (1 - sin)) / (4 * Math.PI)) * scale,
  };
}
