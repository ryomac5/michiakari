import type { ResumeChance } from "@repo/schema";
import { describe, expect, it } from "vitest";
import {
  buildChanceLayout,
  computeBarHeight,
  computeChancePosition,
  selectMarkLabelSide,
} from "./resume-chance";

const at = (clock: string) => `2026-11-05T${clock}:00+09:00`;
const ms = (clock: string) => Date.parse(at(clock));

// 22:10 の判断。目盛りは 22:30 から 30 分刻みで 5 個
const chance: ResumeChance = {
  stepMinutes: 30,
  ticks: [
    { time: at("22:30"), tenths: 0, sinceOnsetMinutes: 20 },
    { time: at("23:00"), tenths: 0, sinceOnsetMinutes: 50 },
    { time: at("23:30"), tenths: 6, sinceOnsetMinutes: 80 },
    { time: at("00:00").replace("05T", "06T"), tenths: 8, sinceOnsetMinutes: 110 },
    { time: at("00:30").replace("05T", "06T"), tenths: 10, sinceOnsetMinutes: 140 },
  ],
  waitFaster: 0,
  waitOnTime: 6,
  resumeByForDeadline: at("23:45"),
  onsetTime: at("22:10"),
};

describe("computeChancePosition", () => {
  it("目盛りは等間隔の列の中央にあり、その間の時刻は直線で写す", () => {
    expect(computeChancePosition(chance, ms("22:30"))).toBeCloseTo(0.1, 5);
    expect(computeChancePosition(chance, ms("23:00"))).toBeCloseTo(0.3, 5);
    expect(computeChancePosition(chance, ms("22:45"))).toBeCloseTo(0.2, 5);
    // いま（22:10）は最初の目盛りの左の外
    expect(computeChancePosition(chance, ms("22:10"))).toBeLessThan(0);
  });
});

describe("selectMarkLabelSide", () => {
  const bars = [0.1, 0.3, 0.5, 0.7, 0.9];
  it("右に置けるなら右、棒に重なるなら左、どちらも無理なら出さない", () => {
    expect(selectMarkLabelSide(0.12, bars)).toBe("right");
    // 右に置くと 0.3 の棒に重なるので左に置く
    expect(selectMarkLabelSide(0.27, bars)).toBe("left");
    // 棒と棒のちょうど中間では、どちら側も棒に重なる
    expect(selectMarkLabelSide(0.2, bars)).toBe("hidden");
    expect(selectMarkLabelSide(0.3, bars)).toBe("hidden");
  });

  it("右端に近ければ左に置く", () => {
    expect(selectMarkLabelSide(0.95, [0.1, 0.3])).toBe("left");
  });
});

describe("buildChanceLayout", () => {
  it("分岐点より後の目盛りは after になり、分岐点と期限の印が軸の上に置かれる", () => {
    const layout = buildChanceLayout({ chance, breakEvenTime: at("22:46"), nowMs: ms("22:10") });
    expect(layout.ticks.map((t) => t.side)).toEqual(["before", "after", "after", "after", "after"]);
    expect(layout.marks.map((m) => m.kind)).toEqual(["breakEven", "deadline"]);
    const [breakEven, deadline] = layout.marks;
    expect(breakEven?.position).toBeCloseTo(0.1 + (16 / 30) * 0.2, 5);
    expect(deadline?.position).toBeCloseTo(0.5 + (15 / 30) * 0.2, 5);
    expect(deadline?.time).toBe(at("23:45"));
  });

  it("軸の外の印は置かず、分岐点が無ければ全部 before になる", () => {
    const passed = buildChanceLayout({ chance, breakEvenTime: at("21:00"), nowMs: null });
    expect(passed.marks.map((m) => m.kind)).toEqual(["deadline"]);
    expect(passed.ticks.every((t) => t.side === "after")).toBe(true);
    const none = buildChanceLayout({
      chance: { ...chance, resumeByForDeadline: null },
      breakEvenTime: null,
      nowMs: null,
    });
    expect(none.marks).toEqual([]);
    expect(none.ticks.every((t) => t.side === "before")).toBe(true);
  });

  it("要点の目盛りは 5 割に達する最初の目盛りで、いまからの分を付ける", () => {
    const layout = buildChanceLayout({ chance, breakEvenTime: at("22:46"), nowMs: ms("22:10") });
    expect(layout.lead?.tick.time).toBe(at("23:30"));
    expect(layout.lead?.fromNowMinutes).toBe(80);
    const noNow = buildChanceLayout({ chance, breakEvenTime: null, nowMs: null });
    expect(noNow.lead?.fromNowMinutes).toBeNull();
  });
});

describe("computeBarHeight", () => {
  it("確率に比例し、1 割未満でも 2px は残す", () => {
    expect(computeBarHeight(0, 22)).toBe(2);
    expect(computeBarHeight(5, 22)).toBe(11);
    expect(computeBarHeight(10, 22)).toBe(22);
  });
});
