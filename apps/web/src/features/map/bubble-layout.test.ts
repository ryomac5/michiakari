import { describe, expect, it } from "vitest";
import {
  chooseBubblePlacements,
  chooseLabelLayout,
  compactStationSlides,
  constrainFitPadding,
  type LayoutInput,
  type LayoutItem,
  measureLabelOverlap,
  measureLayoutCost,
  measureLayoutOverlap,
  overlapArea,
  placeBox,
  type Rect,
} from "./bubble-layout";

// 吹き出しの置き場所を、重なりの少ない組み合わせから選べるか確かめる

const view = { left: 0, top: 0, right: 400, bottom: 800 };
const size = { w: 100, h: 30 };

describe("constrainFitPadding", () => {
  it("375×667 でも上下の余白で寄せる計算が失敗しない", () => {
    const padding = constrainFitPadding(
      { w: 375, h: 667 },
      { top: 78, right: 0, bottom: 400, left: 0 },
      { top: 186, right: 215, bottom: 30, left: 80 },
    );
    expect(667 - padding.top - padding.bottom).toBeCloseTo(64);
    expect(375 - padding.left - padding.right).toBeGreaterThanOrEqual(64);
  });

  it("390×844 で収まっていた余白は変えない", () => {
    expect(
      constrainFitPadding(
        { w: 390, h: 844 },
        { top: 78, right: 0, bottom: 500, left: 0 },
        { top: 56, right: 215, bottom: 30, left: 80 },
      ),
    ).toEqual({ top: 134, right: 215, bottom: 530, left: 80 });
  });
});

describe("chooseBubblePlacements", () => {
  it("近い 2 つの駅の札は、互いに重ならない向きに置く", () => {
    const items: LayoutItem[] = [
      { key: "a", point: { x: 200, y: 400 }, size, gap: 12 },
      { key: "b", point: { x: 200, y: 420 }, size, gap: 12 },
    ];
    const chosen = chooseBubblePlacements({ items, here: { x: 200, y: 300 }, view });
    const order = items.map((i) => chosen[i.key] ?? "right");
    expect(measureLayoutCost({ items, here: { x: 200, y: 300 }, view }, order)).toBeLessThan(
      size.w * size.h * 0.1,
    );
    const [a, b] = items.map((item, i) => placeBox(item, order[i] ?? "right"));
    const overlap =
      a && b
        ? Math.max(0, Math.min(a.right, b.right) - Math.max(a.left, b.left)) *
          Math.max(0, Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top))
        : 0;
    expect(overlap).toBe(0);
  });

  it("画面の端の駅は、内側に札を出す", () => {
    const items: LayoutItem[] = [{ key: "edge", point: { x: 390, y: 400 }, size, gap: 12 }];
    expect(chooseBubblePlacements({ items, here: { x: 200, y: 400 }, view }).edge).toBe("left");
  });

  it("固定した札は動かさない", () => {
    const items: LayoutItem[] = [{ key: "here", point: { x: 200, y: 400 }, size, gap: 20 }];
    expect(
      chooseBubblePlacements({ items, here: { x: 200, y: 400 }, view, fixed: { here: "bottom" } })
        .here,
    ).toBe("bottom");
  });
});

// 駅間の車内の人の既定の画面（390x844、閉じたシートが画面の 60%）。塚本の降りる駅と、御幣島・姫島・十三の吹き出し
// 地図の見える範囲は x 8〜382、y 78〜337。「全体を見る」のボタンは右下にある
const tsukamoto = {
  view: { left: 8, top: 78, right: 382, bottom: 337 } satisfies Rect,
  // 「全体を見る」のボタン。札の置き場所の計算には、6px の余白を足した矩形を渡す
  button: { left: 259, top: 261, right: 378, bottom: 305 } satisfies Rect,
  toggle: { left: 253, top: 255, right: 384, bottom: 311 } satisfies Rect,
  slides: [-64, -56, -48, -40, -32, -24, -16, -8, 0, 8, 16, 24, 32, 40, 48, 56, 64],
};

function buildTsukamotoInput(recommendedSize: { w: number; h: number }): LayoutInput {
  const items: LayoutItem[] = [
    {
      key: "here",
      point: { x: 278, y: 252 },
      size: { w: 182, h: 34 },
      gap: 20,
      slides: tsukamoto.slides,
    },
    {
      key: "alight",
      point: { x: 195, y: 212 },
      size: { w: 108, h: 22 },
      gap: 16,
      slides: tsukamoto.slides,
    },
    { key: "himejima", point: { x: 127, y: 278 }, size: recommendedSize, gap: 12 },
    { key: "juso", point: { x: 280, y: 153 }, size: { w: 94, h: 34 }, gap: 12 },
    { key: "mikuriya", point: { x: 110, y: 212 }, size: { w: 106, h: 34 }, gap: 12 },
  ];
  return {
    items,
    here: { x: 278, y: 252 },
    view: tsukamoto.view,
    preferred: { here: "left", alight: "bottom" },
    blockers: [tsukamoto.toggle],
  };
}

const dotRect = (item: LayoutItem, radius = 8): Rect => ({
  left: item.point.x - radius,
  right: item.point.x + radius,
  top: item.point.y - radius,
  bottom: item.point.y + radius,
});

describe("chooseLabelLayout: 駅と駅の間の既定の画面", () => {
  const input = buildTsukamotoInput({ w: 108, h: 34 });
  const layout = chooseLabelLayout(input);
  const boxes = Object.fromEntries(
    input.items.map((item) => [
      item.key,
      placeBox(item, layout.placements[item.key] ?? "right", layout.slides[item.key] ?? 0),
    ]),
  );
  const here = boxes.here as Rect;
  const alight = boxes.alight as Rect;

  it("「いま」の札と「降りる駅」の札は、互いに重ならない", () => {
    expect(overlapArea(here, alight)).toBe(0);
  });

  it("2 つの札は、どの駅の印にも重ならない", () => {
    for (const label of [here, alight]) {
      for (const item of input.items) expect(overlapArea(label, dotRect(item))).toBe(0);
    }
  });

  it("2 つの札は、ほかの吹き出しにも、「全体を見る」のボタンにも重ならず、見える範囲に収まる", () => {
    for (const label of [here, alight]) {
      for (const key of ["himejima", "juso", "mikuriya"]) {
        expect(overlapArea(label, boxes[key] as Rect), key).toBe(0);
      }
      expect(overlapArea(label, tsukamoto.button)).toBe(0);
      expect(overlapArea(label, tsukamoto.view)).toBeCloseTo(
        (label.right - label.left) * (label.bottom - label.top),
        5,
      );
    }
  });

  it("札は印の近くに置く。ずらすのは、重なりを避けるのに要る分だけ", () => {
    expect(Math.abs(layout.slides.here ?? 0)).toBeLessThanOrEqual(40);
    expect(Math.abs(layout.slides.alight ?? 0)).toBeLessThanOrEqual(40);
  });

  it("全体の重なりは、重なっていないとみなせる面積に収まる", () => {
    expect(measureLayoutOverlap(input, layout)).toBeLessThanOrEqual(150);
  });
});

describe("measureLayoutOverlap: おすすめの大きな札", () => {
  it("大きな札では、ほかの駅の印や札が隠れる。小さな札なら収まる", () => {
    const large = buildTsukamotoInput({ w: 196, h: 150 });
    const small = buildTsukamotoInput({ w: 108, h: 34 });
    const largeOverlap = measureLayoutOverlap(large, chooseLabelLayout(large));
    const smallOverlap = measureLayoutOverlap(small, chooseLabelLayout(small));
    expect(largeOverlap).toBeGreaterThan(150);
    expect(smallOverlap).toBeLessThanOrEqual(150);
  });
});

describe("chooseLabelLayout: ずらしと覆ってはいけないもの", () => {
  const view = { left: 0, top: 0, right: 400, bottom: 800 };

  it("四方に置くと駅の印に重なる札は、辺の方向へずらして印を避ける", () => {
    const items: LayoutItem[] = [
      {
        key: "label",
        point: { x: 200, y: 400 },
        size: { w: 100, h: 30 },
        gap: 20,
        slides: [-32, -16, 0, 16, 32],
      },
      // 札の真上の右寄りに別の駅の印がある。真上に札を置くと印を隠す
      { key: "other", point: { x: 236, y: 360 }, size: { w: 10, h: 10 }, gap: 12 },
    ];
    const layout = chooseLabelLayout({
      items,
      here: { x: 200, y: 400 },
      view,
      fixed: { label: "top" },
    });
    const box = placeBox(items[0] as LayoutItem, "top", layout.slides.label ?? 0);
    expect(Math.abs(layout.slides.label ?? 0)).toBeGreaterThan(0);
    expect(overlapArea(box, dotRect(items[1] as LayoutItem, 12))).toBe(0);
  });

  it("ボタンなど覆ってはいけないものは、札が避ける", () => {
    const items: LayoutItem[] = [{ key: "label", point: { x: 300, y: 400 }, size, gap: 12 }];
    const blocker = { left: 330, top: 380, right: 400, bottom: 420 };
    const layout = chooseLabelLayout({
      items,
      here: { x: 300, y: 400 },
      view,
      blockers: [blocker],
    });
    const box = placeBox(items[0] as LayoutItem, layout.placements.label ?? "right", 0);
    expect(overlapArea(box, blocker)).toBe(0);
    expect(layout.placements.label).not.toBe("right");
  });

  it("ずらし量を持たない札は、これまでどおりずらさない", () => {
    const items: LayoutItem[] = [{ key: "a", point: { x: 200, y: 400 }, size, gap: 12 }];
    const layout = chooseLabelLayout({ items, here: { x: 200, y: 300 }, view });
    expect(layout.slides.a).toBe(0);
  });
});

describe("chooseLabelLayout: 375×667 の狭い地図", () => {
  it("四方だけでは重なる密集した駅も、札を少しずらして見える範囲に収める", () => {
    const items: LayoutItem[] = [
      {
        key: "here",
        point: { x: 110, y: 170 },
        size: { w: 154, h: 36 },
        gap: 20,
        slides: [-64, -48, -32, -16, 0, 16, 32, 48, 64],
      },
      { key: "a", point: { x: 160, y: 141 }, size: { w: 160, h: 46 }, gap: 12 },
      { key: "b", point: { x: 151, y: 180 }, size: { w: 160, h: 46 }, gap: 12 },
      { key: "c", point: { x: 142, y: 134 }, size: { w: 112, h: 46 }, gap: 12 },
      { key: "d", point: { x: 133, y: 173 }, size: { w: 112, h: 46 }, gap: 12 },
    ];
    const input: LayoutInput = {
      items,
      here: items[0]?.point ?? { x: 110, y: 170 },
      view: { left: 8, top: 78, right: 367, bottom: 259 },
    };
    expect(measureLabelOverlap(input, chooseLabelLayout(input))).toBeGreaterThan(0);
    const slidingInput = {
      ...input,
      items: items.map((item) => ({ ...item, slides: item.slides ?? compactStationSlides })),
    };
    const layout = chooseLabelLayout(slidingInput);
    expect(measureLabelOverlap(slidingInput, layout)).toBe(0);
    expect(measureLayoutOverlap(slidingInput, layout)).toBe(0);
    for (const item of items.slice(1)) {
      expect(Math.abs(layout.slides[item.key] ?? 0)).toBeLessThanOrEqual(32);
    }
  });

  it("収まる組み合わせがなくても、固定した向きを保って配置を返す", () => {
    const input: LayoutInput = {
      items: [{ key: "large", point: { x: 187, y: 160 }, size: { w: 196, h: 150 }, gap: 12 }],
      here: { x: 187, y: 160 },
      view: { left: 8, top: 78, right: 367, bottom: 259 },
      fixed: { large: "top" },
    };
    const layout = chooseLabelLayout(input);
    expect(layout.placements.large).toBe("top");
    expect(layout.slides.large).toBe(0);
    expect(measureLayoutOverlap(input, layout)).toBeGreaterThan(0);
  });

  it.each([34, 44])(
    "札の高さが %ipx でも、向きの好みのためにわずかな重なりを残さない",
    (height) => {
      const input: LayoutInput = {
        items: [
          {
            key: "here",
            point: { x: 176, y: 142 },
            size: { w: 150, h: 34 },
            gap: 20,
            slides: [-16, -8, 0, 8, 16],
          },
          { key: "a", point: { x: 133, y: 134 }, size: { w: 108, h: height }, gap: 12 },
          { key: "b", point: { x: 253, y: 189 }, size: { w: 108, h: height }, gap: 12 },
          { key: "c", point: { x: 174, y: 178 }, size: { w: 108, h: height }, gap: 12 },
        ],
        here: { x: 187, y: 160 },
        view: { left: 8, top: 78, right: 367, bottom: 259 },
      };
      const layout = chooseLabelLayout(input);
      expect(measureLayoutOverlap(input, layout)).toBe(0);
      const boxes = input.items.map((item) =>
        placeBox(item, layout.placements[item.key] ?? "right", layout.slides[item.key] ?? 0),
      );
      boxes.forEach((box, i) => {
        expect(overlapArea(box, input.view)).toBeCloseTo(
          (box.right - box.left) * (box.bottom - box.top),
        );
        for (const other of boxes.slice(i + 1)) expect(overlapArea(box, other)).toBe(0);
      });
    },
  );
});

describe("placeBox", () => {
  const item: LayoutItem = { key: "a", point: { x: 200, y: 400 }, size, gap: 12 };

  it("上下に置くなら横へ、左右に置くなら縦へずらす", () => {
    expect(placeBox(item, "top", 20)).toEqual({
      ...placeBox(item, "top"),
      left: 170,
      right: 270,
    });
    expect(placeBox(item, "left", -10)).toEqual({
      ...placeBox(item, "left"),
      top: 375,
      bottom: 405,
    });
  });
});
