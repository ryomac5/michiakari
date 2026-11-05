import { describe, expect, it } from "vitest";
import {
  buildReachLabelRect,
  chooseReachLabelCandidate,
  estimateReachLabelSize,
  fitsInView,
  measureReachLabelCost,
  polylineCrossesRect,
  type ReachLabelContext,
} from "./reach-label";

const view = { left: 0, top: 0, right: 390, bottom: 600 };
const size = { w: 60, h: 18 };
const base: ReachLabelContext = { size, view, boxes: [], polylines: [] };

describe("fitsInView", () => {
  it("札が範囲に収まれば true、縁に掛かれば false", () => {
    expect(fitsInView({ x: 200, y: 300 }, size, view)).toBe(true);
    expect(fitsInView({ x: 380, y: 300 }, size, view)).toBe(false);
    expect(fitsInView({ x: 200, y: 5 }, size, view)).toBe(false);
  });
});

describe("polylineCrossesRect", () => {
  const rect = { left: 100, top: 100, right: 160, bottom: 118 };

  it("矩形をまたぐ線分と、端が矩形の中にある線分を検出する", () => {
    expect(
      polylineCrossesRect(
        [
          { x: 0, y: 110 },
          { x: 300, y: 110 },
        ],
        rect,
      ),
    ).toBe(true);
    expect(
      polylineCrossesRect(
        [
          { x: 130, y: 105 },
          { x: 400, y: 400 },
        ],
        rect,
      ),
    ).toBe(true);
  });

  it("矩形から離れた線分は検出しない", () => {
    expect(
      polylineCrossesRect(
        [
          { x: 0, y: 0 },
          { x: 300, y: 50 },
        ],
        rect,
      ),
    ).toBe(false);
    // 包含矩形は重なるが、対角線は矩形の角をかすめない
    expect(
      polylineCrossesRect(
        [
          { x: 0, y: 118 },
          { x: 100, y: 200 },
        ],
        rect,
      ),
    ).toBe(false);
  });
});

describe("measureReachLabelCost", () => {
  it("何にも重ならなければ 0", () => {
    expect(measureReachLabelCost({ x: 200, y: 300 }, base)).toBe(0);
  });

  it("吹き出しに重なる、線をまたぐ、画面からはみ出すほど高くなる", () => {
    const onBox = measureReachLabelCost(
      { x: 200, y: 300 },
      {
        ...base,
        boxes: [{ left: 170, top: 290, right: 230, bottom: 310 }],
      },
    );
    const onLine = measureReachLabelCost(
      { x: 200, y: 300 },
      {
        ...base,
        polylines: [
          [
            { x: 0, y: 300 },
            { x: 390, y: 300 },
          ],
        ],
      },
    );
    const outside = measureReachLabelCost({ x: 380, y: 300 }, base);
    expect(onBox).toBeGreaterThan(0);
    expect(onLine).toBeGreaterThan(0);
    expect(outside).toBeGreaterThan(0);
  });
});

describe("chooseReachLabelCandidate", () => {
  const candidates = [
    { key: "east", point: { x: 300, y: 300 } },
    { key: "south", point: { x: 200, y: 400 } },
    { key: "north", point: { x: 200, y: 200 } },
  ];

  it("重なりが無ければ先頭の候補を選ぶ", () => {
    expect(chooseReachLabelCandidate(candidates, base)?.key).toBe("east");
  });

  it("先頭が吹き出しに重なれば、次に重ならない候補を選ぶ", () => {
    const ctx = { ...base, boxes: [{ left: 260, top: 280, right: 340, bottom: 320 }] };
    expect(chooseReachLabelCandidate(candidates, ctx)?.key).toBe("south");
  });

  it("先頭が線に掛かれば、線から離れた候補を選ぶ", () => {
    const ctx: ReachLabelContext = {
      ...base,
      polylines: [
        [
          { x: 0, y: 305 },
          { x: 390, y: 295 },
        ],
      ],
    };
    expect(chooseReachLabelCandidate(candidates, ctx)?.key).toBe("south");
  });

  it("候補が無ければ null", () => {
    expect(chooseReachLabelCandidate([], base)).toBeNull();
  });
});

describe("buildReachLabelRect と estimateReachLabelSize", () => {
  it("点を中心にした矩形を返す", () => {
    expect(buildReachLabelRect({ x: 100, y: 50 }, size)).toEqual({
      left: 70,
      right: 130,
      top: 41,
      bottom: 59,
    });
  });

  it("和文は英数字より広く見積もる", () => {
    expect(estimateReachLabelSize("徒歩 10 分").w).toBeGreaterThan(
      estimateReachLabelSize("10 min").w,
    );
    expect(estimateReachLabelSize("徒歩 10 分").h).toBe(18);
  });
});
