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
  // 画面の内側に必ず収める札。現在地やおすすめなど、欠けてはいけない札に使う
  inside?: readonly string[];
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
  hidden?: string[];
};

// 札ごとの置き方の候補。固定の札は向きを変えず、ずらせる札は向きごとにずらし量を試す
function listChoices(input: LayoutInput, item: LayoutItem): LabelChoice[] {
  const fixed = input.fixed?.[item.key];
  const placements = fixed ? [fixed] : bubblePlacements;
  const slides = item.slides && item.slides.length > 0 ? item.slides : [0];
  return placements.flatMap((placement) => slides.map((slide) => ({ placement, slide })));
}

// 駅の印を覆ってよい面積（px²）。印の余白にかかる程度は許す
export const dotOverlapTolerance = 150;

// 探索で避ける重なり。all は画面の外・ボタン・印・札、collisions は印と札、labels は札だけ
type AvoidOverlap = "all" | "collisions" | "labels" | "none";
// 1 段の探索で試す置き方の上限。札が 6 つで密集しても数十 ms で終わる
const searchBudget = 20_000;
// 必須の札だけを探すときの上限。札が 3 つなら全組み合わせを見ても数 ms で終わる
const requiredSearchBudget = 200_000;

// 探索の結果。exhausted は上限で打ち切った段があり、収まる置き方を見落としたかもしれないことを示す
type LayoutSearch = { layout: LabelLayout; exhausted: boolean };

// 最も重なりの少ない置き場所とずらし量の組み合わせを返す。途中の重さが最良を超えた枝は打ち切る
export function chooseLabelLayout(input: LayoutInput): LabelLayout {
  return searchLabelLayout(input).layout;
}

// 探索を段階的に緩めて置き方を選ぶ。上限で打ち切った段があれば exhausted で知らせる
function searchLabelLayout(input: LayoutInput, budgetLimit = searchBudget): LayoutSearch {
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
  // 札ごとの、ほかの駅の印を覆う面積（px²）
  const dots = input.items.map((_, i) =>
    (rects[i] as Rect[]).map((rect) =>
      input.items.reduce(
        (area, other, j) => area + (j === i ? 0 : overlapArea(rect, dotRect(other))),
        0,
      ),
    ),
  );
  // 札ごとの、見える範囲からはみ出す面積（px²）
  const outsides = input.items.map((_, i) =>
    (rects[i] as Rect[]).map((rect) => outsideArea(rect, input.view)),
  );
  const mustStayInside = input.items.map((item) => input.inside?.includes(item.key) ?? false);
  // 軽い置き方から試すと、最良を超えた枝を早く打ち切れる
  const orders = own.map((costs) =>
    costs.map((_, k) => k).sort((a, b) => (costs[a] as number) - (costs[b] as number)),
  );
  // 1 段の探索で試す置き方の上限。密集した札で収まらない段を長く探し続けない
  let budget = 0;
  let exhausted = false;
  const visit = (i: number, cost: number, avoidOverlap: AvoidOverlap) => {
    if (cost >= bestCost || budget <= 0) return;
    if (i === choices.length) {
      bestCost = cost;
      best = picked.map((k, n) => (choices[n] as LabelChoice[])[k] as LabelChoice);
      return;
    }
    for (const k of orders[i] as number[]) {
      if (--budget <= 0) {
        exhausted = true;
        return;
      }
      const rect = (rects[i] as Rect[])[k] as Rect;
      const dot = (dots[i] as number[])[k] as number;
      const outside = (outsides[i] as number[])[k] as number;
      if (
        avoidOverlap === "all" &&
        (outside > 0 ||
          input.blockers?.some((blocker) => overlapArea(rect, blocker) > 0) ||
          dot > 0)
      ) {
        continue;
      }
      if (avoidOverlap === "collisions" && dot > dotOverlapTolerance) continue;
      // 欠けてはいけない札は、従来の面積評価に落ちるまで画面の外に出さない
      if (avoidOverlap !== "none" && mustStayInside[i] && outside > 0) continue;
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
  const search = (avoidOverlap: AvoidOverlap) => {
    budget = budgetLimit;
    visit(0, 0, avoidOverlap);
  };
  // 収まる組み合わせがあるなら、好みや移動量のために札の重なりを残さない
  search("all");
  // 画面の外やボタンを避けられない場合も、札どうしと駅の印から離れる組み合わせを先に探す
  if (best === null) search("collisions");
  // 印まで避けられない場合も、札どうしが離れる組み合わせを先に探す
  if (best === null) search("labels");
  // 大きなおすすめなど、収まらない場合は従来の面積評価で縮小の判断につなぐ
  if (best === null) search("none");
  const chosen = (best ?? []) as LabelChoice[];
  return {
    layout: {
      placements: Object.fromEntries(
        input.items.map((item, i) => [item.key, chosen[i]?.placement ?? "right"]),
      ),
      slides: Object.fromEntries(input.items.map((item, i) => [item.key, chosen[i]?.slide ?? 0])),
    },
    exhausted,
  };
}

// 選んだ置き方の重なりの合計（px²）。札どうし、札と駅の点、札と覆ってはいけないもの、見える範囲の外を足す
// 好みやずらしの重みは含めないので、「この置き方は重なっていると言えるか」の判定に使える
export function measureLayoutOverlap(input: LayoutInput, layout: LabelLayout): number {
  const items = input.items.filter((item) => !layout.hidden?.includes(item.key));
  const rects = items.map((item) =>
    placeBox(item, layout.placements[item.key] ?? "right", layout.slides[item.key] ?? 0),
  );
  let total = 0;
  rects.forEach((rect, i) => {
    total += outsideArea(rect, input.view);
    for (const blocker of input.blockers ?? []) total += overlapArea(rect, blocker);
    input.items.forEach((other) => {
      if (other.key !== items[i]?.key) total += overlapArea(rect, dotRect(other));
    });
    for (let j = i + 1; j < rects.length; j++) total += overlapArea(rect, rects[j] as Rect);
  });
  return total;
}

// 札どうしの重なりの合計（px²）。隠した札は数えない
export function measureLabelOverlap(input: LayoutInput, layout: LabelLayout): number {
  const boxes = input.items
    .filter((item) => !layout.hidden?.includes(item.key))
    .map((item) =>
      placeBox(item, layout.placements[item.key] ?? "right", layout.slides[item.key] ?? 0),
    );
  return boxes.reduce(
    (total, box, i) =>
      total + boxes.slice(i + 1).reduce((area, other) => area + overlapArea(box, other), 0),
    0,
  );
}

// 札がほかの駅の印を覆う面積の合計（px²）。隠した札の印も覆わないものとして数える
export function measureDotOverlap(input: LayoutInput, layout: LabelLayout): number {
  const visible = input.items.filter((item) => !layout.hidden?.includes(item.key));
  return visible.reduce((total, item) => {
    const rect = placeBox(
      item,
      layout.placements[item.key] ?? "right",
      layout.slides[item.key] ?? 0,
    );
    return (
      total +
      input.items.reduce(
        (area, other) => area + (other.key === item.key ? 0 : overlapArea(rect, dotRect(other))),
        0,
      )
    );
  }, 0);
}

// 画面の内側に収める札が、見える範囲からはみ出す面積の合計（px²）
export function measureInsideShortfall(input: LayoutInput, layout: LabelLayout): number {
  return input.items
    .filter((item) => input.inside?.includes(item.key) && !layout.hidden?.includes(item.key))
    .reduce(
      (total, item) =>
        total +
        outsideArea(
          placeBox(item, layout.placements[item.key] ?? "right", layout.slides[item.key] ?? 0),
          input.view,
        ),
      0,
    );
}

// 札どうしが触れず、駅の印を覆う面積が許容内で、欠けてはいけない札が画面の内側にあるか
// ほかの札の画面の外やボタンへの重なりは別に数える
function isCollisionFree(input: LayoutInput, layout: LabelLayout): boolean {
  return (
    measureLabelOverlap(input, layout) === 0 &&
    measureDotOverlap(input, layout) <= dotOverlapTolerance &&
    measureInsideShortfall(input, layout) === 0
  );
}

// 隠す札の組み合わせを、枚数の少ない順、同じ枚数なら後ろの低優先の札を隠す順に並べる
function listHiddenSubsets(optionalKeys: readonly string[]): string[][] {
  const subsets: number[][] = [[]];
  optionalKeys.forEach((_, index) => {
    subsets.push(...subsets.map((subset) => [...subset, index]));
  });
  const compareIndices = (a: number[], b: number[]): number => {
    for (let i = 0; i < a.length; i++) {
      const diff = (b[i] as number) - (a[i] as number);
      if (diff !== 0) return diff;
    }
    return 0;
  };
  return subsets
    .map((subset) => subset.toSorted((a, b) => b - a))
    .sort((a, b) => a.length - b.length || compareIndices(a, b))
    .map((subset) => subset.map((index) => optionalKeys[index] as string));
}

// 隠した札の駅の印も、残す札が覆わないよう避ける
function buildVisibleInput(input: LayoutInput, hidden: readonly string[]): LayoutInput {
  return {
    ...input,
    items: input.items.filter((item) => !hidden.includes(item.key)),
    blockers: [
      ...(input.blockers ?? []),
      ...input.items.filter((item) => hidden.includes(item.key)).map(dotRect),
    ],
  };
}

// 隠す札を最少にし、同じ枚数なら後ろの低優先の札から隠す。必須の札は隠さず、画面の内側に収める
// 隠す理由は札どうしと駅の印への重なり、必須の札のはみ出しだけにする。ほかの札は縁やボタンにかかってもよい
// 隠し切っても触れるときは、必須の札のはみ出しが無いもの、重なりの小さい順、隠す枚数の少ない順に選ぶ
export function chooseVisibleLabelLayout(
  input: LayoutInput,
  requiredKeys: readonly string[],
): LabelLayout {
  const optionalKeys = input.items
    .filter((item) => !requiredKeys.includes(item.key))
    .map((item) => item.key);
  const insideInput = { ...input, inside: requiredKeys };
  const candidates: LabelLayout[] = [];
  let exhausted = false;
  for (const hidden of listHiddenSubsets(optionalKeys)) {
    const visibleInput = buildVisibleInput(insideInput, hidden);
    const search = searchLabelLayout(visibleInput);
    const layout = { ...search.layout, hidden };
    if (isCollisionFree(visibleInput, layout)) return layout;
    exhausted ||= search.exhausted;
    candidates.push(layout);
  }
  // 上限で打ち切られて収まる置き方を見落としたかもしれないときは、必須の札を先に置く安い手順も候補にする
  if (exhausted) {
    const layered = layerLabelLayout(insideInput, optionalKeys);
    if (layered) candidates.push(layered);
  }
  let best: { layout: LabelLayout; score: readonly number[] } | null = null;
  for (const layout of candidates) {
    const score = scoreFallbackLayout(buildVisibleInput(insideInput, layout.hidden ?? []), layout);
    if (!best || compareScores(score, best.score) < 0) best = { layout, score };
  }
  return best?.layout ?? { placements: {}, slides: {}, hidden: [] };
}

// 収まらない置き方の順位。必須の札のはみ出し、札と印の重なり、隠す枚数、縁やボタンを含む重なりの順に小さいものを選ぶ
function scoreFallbackLayout(input: LayoutInput, layout: LabelLayout): readonly number[] {
  return [
    measureInsideShortfall(input, layout),
    measureLabelOverlap(input, layout) + measureDotOverlap(input, layout),
    layout.hidden?.length ?? 0,
    measureLayoutOverlap(input, layout),
  ];
}

// 必須の札だけで画面の内側に重ならず置ける配置を探し、残りの札を優先の高い順に 1 つずつ足す。触れる札は隠す
// 探索の上限で打ち切られたときの受け皿。必須の札が画面に入らないか互いに触れるなら null
function layerLabelLayout(input: LayoutInput, optionalKeys: readonly string[]): LabelLayout | null {
  const requiredInput = buildVisibleInput(input, optionalKeys);
  const base = { ...searchLabelLayout(requiredInput, requiredSearchBudget).layout, hidden: [] };
  if (
    measureInsideShortfall(requiredInput, base) > 0 ||
    measureLabelOverlap(requiredInput, base) > 0
  ) {
    return null;
  }
  const placements = { ...base.placements };
  const slides = { ...base.slides };
  const hidden: string[] = [];
  const placed = requiredInput.items.map((item) =>
    placeBox(item, placements[item.key] ?? "right", slides[item.key] ?? 0),
  );
  for (const key of optionalKeys) {
    const index = input.items.findIndex((item) => item.key === key);
    const item = input.items[index] as LayoutItem;
    const choice = pickCleanChoice(input, index, placed);
    if (!choice) {
      hidden.push(key);
      continue;
    }
    placements[key] = choice.placement;
    slides[key] = choice.slide;
    placed.push(placeBox(item, choice.placement, choice.slide));
  }
  return { placements, slides, hidden };
}

// 置いた札に触れず、駅の印を覆う面積が許容内の置き方のうち、最も軽いもの。無ければ null
function pickCleanChoice(
  input: LayoutInput,
  index: number,
  placed: readonly Rect[],
): LabelChoice | null {
  const item = input.items[index] as LayoutItem;
  let best: { choice: LabelChoice; cost: number } | null = null;
  for (const choice of listChoices(input, item)) {
    const rect = placeBox(item, choice.placement, choice.slide);
    if (placed.some((other) => overlapArea(rect, other) > 0)) continue;
    const dot = input.items.reduce(
      (area, other, j) => area + (j === index ? 0 : overlapArea(rect, dotRect(other))),
      0,
    );
    if (dot > dotOverlapTolerance) continue;
    const cost = measureOwnCost(input, index, choice);
    if (!best || cost < best.cost) best = { choice, cost };
  }
  return best?.choice ?? null;
}

function compareScores(a: readonly number[], b: readonly number[]): number {
  for (let i = 0; i < a.length; i++) {
    const diff = (a[i] as number) - (b[i] as number);
    if (diff !== 0) return diff;
  }
  return 0;
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

// 札どうしと駅の印に触れず、画面の外やボタンへの重なりも許容内なら収まったとみなす
function fitsLayout(input: LayoutInput, layout: LabelLayout): boolean {
  return (
    isCollisionFree(input, layout) && measureLayoutOverlap(input, layout) <= dotOverlapTolerance
  );
}

// ずらさない札にも、辺の方向のずらし量の候補を与える
function allowStationSlides(input: LayoutInput): LayoutInput {
  return {
    ...input,
    items: input.items.map((item) => ({ ...item, slides: item.slides ?? compactStationSlides })),
  };
}

// 収まる置き方を、通常の札、ずらし、短いおすすめ、短いおすすめとずらし、低優先の札を隠す順に試す
// 必須の札は隠さず、画面の内側に収める。既定の置き場所で収まる画面では、これまでの置き場所を保つ
export function chooseStationLabelLayout(
  fullInput: LayoutInput,
  compactInput: LayoutInput,
  requiredKeys: readonly string[],
): LabelLayout & { compactRecommended: boolean } {
  const full = { ...fullInput, inside: requiredKeys };
  const compact = { ...compactInput, inside: requiredKeys };
  const preferred: LabelLayout = { placements: { ...full.preferred }, slides: {} };
  if (measureLayoutOverlap(full, preferred) === 0) {
    return { ...preferred, compactRecommended: false };
  }
  const attempts: { input: LayoutInput; compactRecommended: boolean }[] = [
    { input: full, compactRecommended: false },
    { input: allowStationSlides(full), compactRecommended: false },
    { input: compact, compactRecommended: true },
    { input: allowStationSlides(compact), compactRecommended: true },
  ];
  for (const attempt of attempts) {
    const layout = chooseLabelLayout(attempt.input);
    if (fitsLayout(attempt.input, layout)) {
      return { ...layout, compactRecommended: attempt.compactRecommended };
    }
  }
  return {
    ...chooseVisibleLabelLayout(allowStationSlides(compact), requiredKeys),
    compactRecommended: true,
  };
}
