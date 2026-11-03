import { describe, expect, it } from "vitest";
import {
  chooseBubblePlacements,
  type LayoutItem,
  measureLayoutCost,
  placeBox,
} from "./bubble-layout";

// 吹き出しの置き場所を、重なりの少ない組み合わせから選べるか確かめる

const view = { left: 0, top: 0, right: 400, bottom: 800 };
const size = { w: 100, h: 30 };

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
