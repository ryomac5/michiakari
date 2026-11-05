import { describe, expect, it } from "vitest";
import {
  chooseBubblePlacements,
  chooseLabelLayout,
  chooseStationLabelLayout,
  chooseVisibleLabelLayout,
  compactStationSlides,
  constrainFitPadding,
  type LayoutInput,
  type LayoutItem,
  measureLabelOverlap,
  measureLayoutCost,
  measureLayoutOverlap,
  measureRequiredLabelOverlap,
  overlapArea,
  placeBox,
  type Rect,
  type ScreenPoint,
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
  it("390×844 の従来の向きとずらし量を維持する", () => {
    expect(layout).toEqual({
      placements: {
        here: "left",
        alight: "right",
        himejima: "bottom",
        juso: "top",
        mikuriya: "top",
      },
      slides: { here: -8, alight: 0, himejima: 0, juso: 0, mikuriya: 0 },
    });
  });

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

describe("constrainFitPadding: 画面の縦横比", () => {
  it.each([
    { w: 375, h: 667 },
    { w: 320, h: 568 },
    { w: 390, h: 844 },
    { w: 375, h: 844 },
    { w: 390, h: 667 },
  ])("$w×$h: 上限サイズによらず地図に必要な余白を制限する", (size) => {
    const padding = constrainFitPadding(
      size,
      { left: 0, right: 0, top: 78, bottom: size.h * 0.6 },
      { left: 80, right: 215, top: 186, bottom: 30 },
    );
    expect(size.w - padding.left - padding.right).toBeGreaterThanOrEqual(64);
    expect(size.h - padding.top - padding.bottom).toBeGreaterThanOrEqual(64 - 1e-10);
  });
});

// 前回の e2e で観測した交差幅・高さを、画面座標の矩形として固定する。
const reportedCollisions = [
  {
    names: ["いま大阪駅", "おすすめ大阪梅田"],
    a: { w: 176, h: 34 },
    b: { w: 196, h: 150 },
    dx: 47,
    dy: 16.75,
    width: 129,
    height: 17.25,
  },
  {
    names: ["いま大阪駅", "梅田6分"],
    a: { w: 176, h: 34 },
    b: { w: 100, h: 44 },
    dx: 141.5,
    dy: 33,
    width: 34.5,
    height: 1,
  },
  {
    names: ["北新地9分", "阪神 大阪梅田6分"],
    a: { w: 112, h: 44 },
    b: { w: 160, h: 44 },
    dx: 61.98,
    dy: 16,
    width: 50.02,
    height: 28,
  },
  {
    names: ["大阪城北詰14分", "大阪ビジネスパーク11分"],
    a: { w: 160, h: 44 },
    b: { w: 196, h: 44 },
    dx: 41,
    dy: 14,
    width: 119,
    height: 30,
  },
];

describe("chooseLabelLayout: 報告された札の交差", () => {
  for (const viewport of [
    { w: 375, h: 667 },
    { w: 390, h: 844 },
  ]) {
    it.each(reportedCollisions)(`${viewport.w}×${viewport.h}: $names`, (collision) => {
      const items: LayoutItem[] = [
        {
          key: collision.names[0] ?? "a",
          point: { x: 80, y: 160 + collision.a.h / 2 },
          size: collision.a,
          gap: 12,
          slides: [-64, -32, 0, 32, 64],
        },
        {
          key: collision.names[1] ?? "b",
          point: { x: 80 + collision.dx, y: 160 + collision.dy + collision.b.h / 2 },
          size: collision.b,
          gap: 12,
          slides: compactStationSlides,
        },
      ];
      const [a, b] = items.map((item) => placeBox(item, "right"));
      expect(overlapArea(a as Rect, b as Rect)).toBeCloseTo(collision.width * collision.height);
      const input: LayoutInput = {
        items,
        here: items[0]?.point ?? { x: 80, y: 160 },
        view: { left: 8, top: 78, right: viewport.w - 8, bottom: Math.floor(viewport.h * 0.4) },
        preferred: Object.fromEntries(items.map((item) => [item.key, "right"])),
      };
      const layout = chooseStationLabelLayout(
        input,
        input,
        items.map((item) => item.key),
      );
      expect(measureLabelOverlap(input, layout)).toBe(0);
      expect(layout.hidden ?? []).toEqual([]);
    });
  }
});

describe("chooseStationLabelLayout: 札の優先順位", () => {
  it("大きすぎる札を除けば収まる場合、後ろの小さな駅札まで減らさない", () => {
    const input: LayoutInput = {
      items: ["here", "recommended", "large", "small-a", "small-b"].map((key) => ({
        key,
        point: { x: 187, y: 166 },
        size:
          key === "large"
            ? { w: 500, h: 400 }
            : key.startsWith("small")
              ? { w: 60, h: 24 }
              : { w: 140, h: 44 },
        gap: 12,
      })),
      here: { x: 187, y: 166 },
      view: { left: 8, top: 78, right: 367, bottom: 259 },
    };
    const layout = chooseVisibleLabelLayout(input, ["here", "recommended"]);
    expect(layout.hidden).toEqual(["large"]);
    expect(measureLabelOverlap(input, layout)).toBe(0);
    expect(measureLayoutOverlap(input, layout)).toBe(0);
  });

  it.each([
    { w: 375, h: 667 },
    { w: 390, h: 844 },
  ])("$w×$h: 大阪駅で複数の交差が同時に起きても必須の札を残して置き直す", (viewport) => {
    const input: LayoutInput = {
      items: [
        {
          key: "here",
          point: { x: 138, y: 194 },
          size: { w: 176, h: 34 },
          gap: 20,
          slides: tsukamoto.slides,
        },
        { key: "recommended", point: { x: 195, y: 318.75 }, size: { w: 196, h: 150 }, gap: 12 },
        { key: "metro", point: { x: 179.5, y: 195 }, size: { w: 100, h: 44 }, gap: 12 },
        { key: "kitashinchi", point: { x: 154, y: 242 }, size: { w: 112, h: 44 }, gap: 12 },
        { key: "hanshin", point: { x: 171.98, y: 224 }, size: { w: 160, h: 44 }, gap: 12 },
      ],
      here: { x: 138, y: 194 },
      view: { left: 8, top: 78, right: viewport.w - 8, bottom: viewport.h * 0.4 },
      preferred: {
        here: "top",
        recommended: "top",
        metro: "right",
        kitashinchi: "left",
        hanshin: "bottom",
      },
    };
    const original = { placements: { ...input.preferred }, slides: {} };
    expect(measureLabelOverlap(input, original)).toBeGreaterThan(
      129 * 17.25 + 34.5 + 50.02 * 28 - 0.01,
    );
    const compact = {
      ...input,
      items: input.items.map((item) =>
        item.key === "recommended" ? { ...item, size: { w: 176, h: 44 } } : item,
      ),
    };
    const layout = chooseStationLabelLayout(input, compact, ["here", "recommended"]);
    expect(measureLabelOverlap(layout.compactRecommended ? compact : input, layout)).toBe(0);
    expect(layout.hidden ?? []).not.toContain("here");
    expect(layout.hidden ?? []).not.toContain("recommended");
  });

  it.each([
    { w: 375, h: 667 },
    { w: 390, h: 844 },
    { w: 1024, h: 768 },
  ])("$w×$h: 収まらない札を減らしても現在地とおすすめを残す", (viewport) => {
    const input: LayoutInput = {
      items: ["here", "recommended", "first", "second", "last"].map((key) => ({
        key,
        point: { x: 187, y: 166 },
        size: { w: 140, h: 44 },
        gap: 12,
      })),
      here: { x: 187, y: 166 },
      view: { left: 8, top: 78, right: Math.min(viewport.w - 8, 367), bottom: 259 },
    };
    const layout = chooseVisibleLabelLayout(input, ["here", "recommended"]);
    expect(layout.hidden?.length).toBeGreaterThan(0);
    expect(layout.hidden?.[0]).toBe("last");
    expect(layout.hidden).not.toContain("here");
    expect(layout.hidden).not.toContain("recommended");
    expect(layout.placements.here).toBeDefined();
    expect(layout.placements.recommended).toBeDefined();
    expect(measureLabelOverlap(input, layout)).toBe(0);
    expect(measureLayoutOverlap(input, layout)).toBe(0);
  });

  it("390×844 で重ならない既定配置と通常の札を保つ", () => {
    const input = buildTsukamotoInput({ w: 108, h: 34 });
    const preferred = chooseLabelLayout(input);
    const layout = chooseStationLabelLayout({ ...input, preferred: preferred.placements }, input, [
      "here",
      "alight",
      "himejima",
    ]);
    expect(layout).toEqual({ ...preferred, compactRecommended: false });
  });

  it("大きなおすすめが入らない場合は、ほかの札を隠す前に短い形を試す", () => {
    const full = buildTsukamotoInput({ w: 196, h: 150 });
    const compact = buildTsukamotoInput({ w: 108, h: 34 });
    const layout = chooseStationLabelLayout(full, compact, ["here", "alight", "himejima"]);
    expect(layout.compactRecommended).toBe(true);
    expect(layout.hidden ?? []).toEqual([]);
    expect(measureLabelOverlap(compact, layout)).toBe(0);
  });
});

// 375px 幅の画面の同じ点に、現在地・降りる駅・おすすめと 3 駅の札が密集する配置
function buildCrowdedInput(recommendedSize: { w: number; h: number }): LayoutInput {
  const point = { x: 187, y: 166 };
  const sizes: Record<string, { w: number; h: number }> = {
    here: { w: 176, h: 34 },
    alight: { w: 108, h: 22 },
    recommended: recommendedSize,
    metro: { w: 100, h: 44 },
    kitashinchi: { w: 112, h: 44 },
    hanshin: { w: 160, h: 44 },
  };
  return {
    items: Object.entries(sizes).map(([key, size]) => ({
      key,
      point,
      size,
      gap: key === "here" ? 20 : key === "alight" ? 16 : 12,
      slides: key === "here" || key === "alight" ? tsukamoto.slides : undefined,
    })),
    here: point,
    view: { left: 8, top: 78, right: 367, bottom: 259 },
    preferred: {
      here: "right",
      alight: "bottom",
      recommended: "top",
      metro: "right",
      kitashinchi: "left",
      hanshin: "bottom",
    },
    blockers: [{ left: 253, top: 203, right: 384, bottom: 259 }],
  };
}

describe("chooseStationLabelLayout: 375px 幅の密集した 6 札", () => {
  const required = ["here", "alight", "recommended"];
  const full = buildCrowdedInput({ w: 196, h: 150 });
  const compact = buildCrowdedInput({ w: 176, h: 44 });

  it("必須の札は隠さず、画面の内側に収める", () => {
    const started = performance.now();
    const layout = chooseStationLabelLayout(full, compact, required);
    const elapsed = performance.now() - started;
    const input = layout.compactRecommended ? compact : full;
    for (const key of required) {
      expect(layout.hidden ?? []).not.toContain(key);
      const item = input.items.find((i) => i.key === key) as LayoutItem;
      const rect = placeBox(item, layout.placements[key] ?? "right", layout.slides[key] ?? 0);
      expect({ key, outside: overlapArea(rect, input.view) }).toEqual({
        key,
        outside: (rect.right - rect.left) * (rect.bottom - rect.top),
      });
    }
    expect(measureLabelOverlap(input, layout)).toBe(0);
    expect(elapsed).toBeLessThan(500);
  });

  it("探索の上限で打ち切られても、必須の札を画面の内側に収める", () => {
    const points: Record<string, { x: number; y: number }> = {
      here: { x: 199, y: 157 },
      alight: { x: 207, y: 190 },
      recommended: { x: 186, y: 152 },
      metro: { x: 216, y: 175 },
      kitashinchi: { x: 134, y: 206 },
      hanshin: { x: 217, y: 211 },
    };
    const spread = (input: LayoutInput): LayoutInput => ({
      ...input,
      items: input.items.map((item) => ({ ...item, point: points[item.key] as ScreenPoint })),
      here: points.here as ScreenPoint,
    });
    const fullSpread = spread(full);
    const compactSpread = spread(compact);
    const layout = chooseStationLabelLayout(fullSpread, compactSpread, required);
    const input = layout.compactRecommended ? compactSpread : fullSpread;
    for (const key of required) {
      expect(layout.hidden ?? []).not.toContain(key);
      const item = input.items.find((i) => i.key === key) as LayoutItem;
      const rect = placeBox(item, layout.placements[key] ?? "right", layout.slides[key] ?? 0);
      expect({ key, rect, inside: overlapArea(rect, input.view) }).toEqual({
        key,
        rect,
        inside: (rect.right - rect.left) * (rect.bottom - rect.top),
      });
    }
    expect(measureLabelOverlap(input, layout)).toBe(0);
  });
});

describe("chooseStationLabelLayout: 必須の札どうしが触れる画面", () => {
  const input: LayoutInput = {
    view: { left: 0, top: 0, right: 100, bottom: 50 },
    here: { x: 50, y: 25 },
    items: [
      { key: "here", point: { x: 50, y: 25 }, size: { w: 176, h: 44 }, gap: 10 },
      { key: "recommended", point: { x: 60, y: 25 }, size: { w: 150, h: 44 }, gap: 10 },
      { key: "other", point: { x: 80, y: 25 }, size: { w: 120, h: 44 }, gap: 10 },
    ],
  };

  it("必須の札を消したりはみ出させたりせず一覧へ移し、ほかの札は隠す", () => {
    const result = chooseStationLabelLayout(input, input, ["here", "recommended"]);
    expect(result.docked).toEqual(["here", "recommended"]);
    expect(result.hidden).toEqual(["other"]);
  });

  it("必須の札が画面からはみ出すだけなら一覧へ移さない", () => {
    const alone: LayoutInput = { ...input, items: input.items.slice(0, 1) };
    const result = chooseStationLabelLayout(alone, alone, ["here"]);
    expect(result.docked).toBeUndefined();
  });

  it("収まる画面では一覧へ移さない", () => {
    const roomy: LayoutInput = { ...input, view: { left: 0, top: 0, right: 1000, bottom: 1000 } };
    const spread: LayoutInput = {
      ...roomy,
      here: { x: 300, y: 300 },
      items: [
        { key: "here", point: { x: 300, y: 300 }, size: { w: 176, h: 44 }, gap: 10 },
        { key: "recommended", point: { x: 700, y: 700 }, size: { w: 150, h: 44 }, gap: 10 },
      ],
    };
    const result = chooseStationLabelLayout(spread, spread, ["here", "recommended"]);
    expect(result.docked).toBeUndefined();
  });
});

describe("measureRequiredLabelOverlap", () => {
  const input: LayoutInput = {
    view: { left: 0, top: 0, right: 400, bottom: 400 },
    here: { x: 100, y: 100 },
    items: [
      { key: "here", point: { x: 100, y: 100 }, size: { w: 80, h: 30 }, gap: 10 },
      { key: "recommended", point: { x: 300, y: 300 }, size: { w: 80, h: 30 }, gap: 10 },
      { key: "other", point: { x: 100, y: 140 }, size: { w: 80, h: 30 }, gap: 10 },
    ],
  };

  it("任意の札との重なりは数えず、必須の札どうしの重なりだけを数える", () => {
    const layout = {
      placements: { here: "right", recommended: "right", other: "right" } as const,
      slides: { here: 0, recommended: 0, other: -40 },
    };
    expect(measureLabelOverlap(input, layout)).toBeGreaterThan(0);
    expect(measureRequiredLabelOverlap(input, layout, ["here", "recommended"])).toBe(0);
  });

  it("必須の札どうしが重なれば数える", () => {
    const close: LayoutInput = {
      ...input,
      items: input.items.map((item) =>
        item.key === "recommended" ? { ...item, point: { x: 110, y: 105 } } : item,
      ),
    };
    const layout = {
      placements: { here: "right", recommended: "right", other: "right" } as const,
      slides: {},
    };
    expect(measureRequiredLabelOverlap(close, layout, ["here", "recommended"])).toBeGreaterThan(0);
  });
});
