import type { BubblePlacement } from "./focus-areas";

// 吹き出しと札の置き場所を、画面の上で互いに重ならないよう選ぶ。表示用の純関数だけを置く
// 置き場所は 4 通りで、札は多くても 6 つなので、組み合わせを試して最も重なりの少ないものを選ぶ
// 現在地と降りる駅の札は、辺の方向へ少しずらせる。四方に置いても重なるとき、ずらして駅の印を避ける

export type ScreenPoint = { x: number; y: number };
export type BoxSize = { w: number; h: number };
export type Rect = { left: number; top: number; right: number; bottom: number };

// 小画面でも寄せる計算が成立するよう、地図に最低限の幅と高さを残す。
export function constrainFitPadding(size: BoxSize, insets: Rect, margins: Rect): Rect {
  const minimumMapSpan = 64;
  const scaleX = Math.min(
    1,
    Math.max(0, size.w - insets.left - insets.right - minimumMapSpan) /
      (margins.left + margins.right),
  );
  const scaleY = Math.min(
    1,
    Math.max(0, size.h - insets.top - insets.bottom - minimumMapSpan) /
      (margins.top + margins.bottom),
  );
  return {
    left: insets.left + margins.left * scaleX,
    right: insets.right + margins.right * scaleX,
    top: insets.top + margins.top * scaleY,
    bottom: insets.bottom + margins.bottom * scaleY,
  };
}

export type LayoutItem = {
  key: string;
  point: ScreenPoint;
  size: BoxSize;
  // 駅から札までの間隔（px）
  gap: number;
  // 札を辺の方向へずらせる量の候補（px）。上下に置くなら横へ、左右に置くなら縦へずらす。省くとずらさない
  slides?: readonly number[];
  // 駅の印の半径（px）。ほかの札が避ける範囲。省くと既定の半径
  dotRadius?: number;
};

export const bubblePlacements: readonly BubblePlacement[] = ["top", "right", "bottom", "left"];
// 狭い地図で四方だけでは収まらないとき、小さな駅の札も少しずらす。
export const compactStationSlides = [0, -16, 16, -32, 32] as const;

// 置き場所ごとの札の矩形。札の尾が点を指すよう、点の反対側に札を置く。slide は辺の方向へのずらし
export function placeBox(item: LayoutItem, placement: BubblePlacement, slide = 0): Rect {
  const { point: p, size: s, gap } = item;
  switch (placement) {
    case "top":
      return {
        left: p.x - s.w / 2 + slide,
        right: p.x + s.w / 2 + slide,
        top: p.y - gap - s.h,
        bottom: p.y - gap,
      };
    case "bottom":
      return {
        left: p.x - s.w / 2 + slide,
        right: p.x + s.w / 2 + slide,
        top: p.y + gap,
        bottom: p.y + gap + s.h,
      };
    case "left":
      return {
        left: p.x - gap - s.w,
        right: p.x - gap,
        top: p.y - s.h / 2 + slide,
        bottom: p.y + s.h / 2 + slide,
      };
    case "right":
      return {
        left: p.x + gap,
        right: p.x + gap + s.w,
        top: p.y - s.h / 2 + slide,
        bottom: p.y + s.h / 2 + slide,
      };
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
const defaultDotRadius = 12;
function dotRect(item: LayoutItem): Rect {
  const radius = item.dotRadius ?? defaultDotRadius;
  return {
    left: item.point.x - radius,
    right: item.point.x + radius,
    top: item.point.y - radius,
    bottom: item.point.y + radius,
  };
}

// 重なりと好みの重み。面積（px²）に掛ける。札どうしの重なりと駅の点を隠すことは、ずらして避けるほうを選ぶ
const weights = {
  // 見える範囲からはみ出すと札が欠けるので、重なりより重く避ける
  outside: 10,
  label: 6,
  // 駅の点を札で隠さない。ずらす手間（slidePerPx）より十分重くして、わずかな重なりも避ける
  dot: 60,
  obstacle: 2,
  // 札で覆ってはいけないもの。「全体を見る」のボタンなど
  blocker: 40,
  // 辺の方向へずらす 1px あたり。同じ重なりなら、ずらさない置き方を選ぶ
  slidePerPx: 8,
  preferred: 1,
  toward: 0.05,
} as const;

// 札が向く先が現在地の側なら小さく罰する。外へ広がる配置を好む
function towardPenalty(item: LayoutItem, placement: BubblePlacement, here: ScreenPoint): number {
  const dx = item.point.x - here.x;
  const dy = item.point.y - here.y;
  const toward =
    (placement === "right" && dx < 0) ||
    (placement === "left" && dx > 0) ||
    (placement === "bottom" && dy < 0) ||
    (placement === "top" && dy > 0);
  return toward ? item.size.w * item.size.h * weights.toward : 0;
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
  // 札で覆ってはいけないもの。「全体を見る」のボタンなど。障害物より強く避ける
  blockers?: readonly Rect[];
};

export type LabelChoice = { placement: BubblePlacement; slide: number };

// 札 1 つを 1 つの置き方にしたときの、ほかの札に依らない重さ
function measureOwnCost(input: LayoutInput, index: number, choice: LabelChoice): number {
  const item = input.items[index] as LayoutItem;
  const rect = placeBox(item, choice.placement, choice.slide);
  let cost = outsideArea(rect, input.view) * weights.outside;
  cost += towardPenalty(item, choice.placement, input.here);
  if (input.preferred?.[item.key] && input.preferred[item.key] !== choice.placement) {
    cost += weights.preferred;
  }
  cost += Math.abs(choice.slide) * weights.slidePerPx;
  for (const obstacle of input.obstacles ?? [])
    cost += overlapArea(rect, obstacle) * weights.obstacle;
  for (const blocker of input.blockers ?? []) cost += overlapArea(rect, blocker) * weights.blocker;
  input.items.forEach((other, j) => {
    if (j !== index) cost += overlapArea(rect, dotRect(other)) * weights.dot;
  });
  return cost;
}

export function measureLayoutCost(
  input: LayoutInput,
  placements: readonly BubblePlacement[],
  slides: readonly number[] = [],
): number {
  const choices = input.items.map(
    (_, i): LabelChoice => ({
      placement: placements[i] as BubblePlacement,
      slide: slides[i] ?? 0,
    }),
  );
  const rects = input.items.map((item, i) =>
    placeBox(item, (choices[i] as LabelChoice).placement, (choices[i] as LabelChoice).slide),
  );
  let cost = 0;
  rects.forEach((rect, i) => {
    cost += measureOwnCost(input, i, choices[i] as LabelChoice);
    for (let j = i + 1; j < rects.length; j++) {
      cost += overlapArea(rect, rects[j] as Rect) * weights.label;
    }
  });
  return cost;
}

export type LabelLayout = {
  placements: Record<string, BubblePlacement>;
  // 辺の方向へずらした量（px）。ずらさない札は 0
  slides: Record<string, number>;
};

// 札ごとの置き方の候補。固定の札は向きを変えず、ずらせる札は向きごとにずらし量を試す
function listChoices(input: LayoutInput, item: LayoutItem): LabelChoice[] {
  const fixed = input.fixed?.[item.key];
  const placements = fixed ? [fixed] : bubblePlacements;
  const slides = item.slides && item.slides.length > 0 ? item.slides : [0];
  return placements.flatMap((placement) => slides.map((slide) => ({ placement, slide })));
}

// 最も重なりの少ない置き場所とずらし量の組み合わせを返す。途中の重さが最良を超えた枝は打ち切る
export function chooseLabelLayout(input: LayoutInput): LabelLayout {
  const choices = input.items.map((item) => listChoices(input, item));
  const own = input.items.map((_, i) =>
    (choices[i] as LabelChoice[]).map((choice) => measureOwnCost(input, i, choice)),
  );
  const rects = input.items.map((item, i) =>
    (choices[i] as LabelChoice[]).map((c) => placeBox(item, c.placement, c.slide)),
  );
  let best: LabelChoice[] | null = null;
  let bestCost = Number.POSITIVE_INFINITY;
  const picked: number[] = [];
  const visit = (i: number, cost: number, avoidOverlap: "all" | "labels" | "none") => {
    if (cost >= bestCost) return;
    if (i === choices.length) {
      bestCost = cost;
      best = picked.map((k, n) => (choices[n] as LabelChoice[])[k] as LabelChoice);
      return;
    }
    const candidates = choices[i] as LabelChoice[];
    for (let k = 0; k < candidates.length; k++) {
      const rect = (rects[i] as Rect[])[k] as Rect;
      if (
        avoidOverlap === "all" &&
        (outsideArea(rect, input.view) > 0 ||
          input.blockers?.some((blocker) => overlapArea(rect, blocker) > 0) ||
          input.items.some((other, j) => j !== i && overlapArea(rect, dotRect(other)) > 0))
      ) {
        continue;
      }
      let next = cost + ((own[i] as number[])[k] as number);
      let overlaps = false;
      for (let j = 0; j < i; j++) {
        const other = (rects[j] as Rect[])[picked[j] as number] as Rect;
        const area = overlapArea(rect, other);
        if (avoidOverlap !== "none" && area > 0) {
          overlaps = true;
          break;
        }
        next += area * weights.label;
      }
      if (overlaps) continue;
      picked[i] = k;
      visit(i + 1, next, avoidOverlap);
    }
  };
  // 収まる組み合わせがあるなら、好みや移動量のために札の重なりを残さない
  visit(0, 0, "all");
  // 印や余白まで避けられない場合も、札どうしが離れる組み合わせを先に探す。
  if (best === null) visit(0, 0, "labels");
  // 大きなおすすめなど、収まらない場合は従来の面積評価で縮小の判断につなぐ
  if (best === null) visit(0, 0, "none");
  const chosen = (best ?? []) as LabelChoice[];
  return {
    placements: Object.fromEntries(
      input.items.map((item, i) => [item.key, chosen[i]?.placement ?? "right"]),
    ),
    slides: Object.fromEntries(input.items.map((item, i) => [item.key, chosen[i]?.slide ?? 0])),
  };
}

// 選んだ置き方の重なりの合計（px²）。札どうし、札と駅の点、札と覆ってはいけないもの、見える範囲の外を足す
// 好みやずらしの重みは含めないので、「この置き方は重なっていると言えるか」の判定に使える
export function measureLayoutOverlap(input: LayoutInput, layout: LabelLayout): number {
  const rects = input.items.map((item) =>
    placeBox(item, layout.placements[item.key] ?? "right", layout.slides[item.key] ?? 0),
  );
  let total = 0;
  rects.forEach((rect, i) => {
    total += outsideArea(rect, input.view);
    for (const blocker of input.blockers ?? []) total += overlapArea(rect, blocker);
    input.items.forEach((other, j) => {
      if (j !== i) total += overlapArea(rect, dotRect(other));
      if (j > i) total += overlapArea(rect, rects[j] as Rect);
    });
  });
  return total;
}

export function measureLabelOverlap(input: LayoutInput, layout: LabelLayout): number {
  const boxes = input.items.map((item) =>
    placeBox(item, layout.placements[item.key] ?? "right", layout.slides[item.key] ?? 0),
  );
  return boxes.reduce(
    (total, box, i) =>
      total + boxes.slice(i + 1).reduce((area, other) => area + overlapArea(box, other), 0),
    0,
  );
}

// 最も重なりの少ない置き場所の組み合わせを返す
export function chooseBubblePlacements(input: LayoutInput): Record<string, BubblePlacement> {
  return chooseLabelLayout(input).placements;
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
