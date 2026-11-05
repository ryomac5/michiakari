import type { ResumeChance } from "@repo/schema";
import { describe, expect, it } from "vitest";
import {
  buildChanceChart,
  buildChartPaths,
  checkLabelsCollide,
  selectValueSides,
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

describe("buildChanceChart", () => {
  it("目盛りは時刻どおりに横へ並び、高さは動いている見込みになる", () => {
    const chart = buildChanceChart({ chance, breakEvenTime: at("22:46"), nowMs: ms("22:40") });
    expect(chart.points.map((p) => p.x)).toEqual([0, 0.25, 0.5, 0.75, 1]);
    expect(chart.points.map((p) => p.y)).toEqual([0, 0, 0.6, 0.8, 1]);
    // 境目より後の目盛りは after になる
    expect(chart.points.map((p) => p.side)).toEqual(["before", "after", "after", "after", "after"]);
    expect(chart.now).toBeCloseTo(10 / 120, 5);
  });

  it("境目と期限の印を時刻の位置に置き、点の高さは agent の確率をそのまま使う", () => {
    const chart = buildChanceChart({ chance, breakEvenTime: at("22:46"), nowMs: null });
    expect(chart.marks.map((m) => m.kind)).toEqual(["breakEven", "resumeBy"]);
    const [breakEven, deadline] = chart.marks;
    expect(breakEven?.x).toBeCloseTo(16 / 120, 5);
    expect(breakEven?.tenths).toBe(0);
    expect(deadline?.x).toBeCloseTo(75 / 120, 5);
    expect(deadline?.tenths).toBe(6);
    expect(chart.now).toBeNull();
  });

  it("期限が理由で境目と期限が同じ時刻なら、印は境目の 1 つだけで期限の見込みを添える", () => {
    const chart = buildChanceChart({
      chance: { ...chance, waitFaster: null },
      breakEvenTime: at("23:45"),
      nowMs: null,
    });
    expect(chart.marks.map((m) => m.kind)).toEqual(["breakEven"]);
    expect(chart.marks[0]?.tenths).toBe(6);
  });

  it("軸の外の時刻は端に寄せ、向きを残す。いまが軸の外なら印を置かない", () => {
    const passed = buildChanceChart({ chance, breakEvenTime: at("21:00"), nowMs: ms("22:10") });
    expect(passed.marks[0]).toMatchObject({ kind: "breakEven", x: 0, outside: "before" });
    expect(passed.points.every((p) => p.side === "after")).toBe(true);
    expect(passed.now).toBeNull();
    const none = buildChanceChart({
      chance: { ...chance, resumeByForDeadline: null },
      breakEvenTime: null,
      nowMs: null,
    });
    expect(none.marks).toEqual([]);
    expect(none.points.every((p) => p.side === "before")).toBe(true);
  });
});

describe("buildChartPaths", () => {
  it("折れ線は上が 100% の座標で描き、面は底辺で閉じる", () => {
    const chart = buildChanceChart({ chance, breakEvenTime: null, nowMs: null });
    const paths = buildChartPaths(chart.points);
    expect(paths.line).toBe(
      "M 0.00 100.00 L 25.00 100.00 L 50.00 40.00 L 75.00 20.00 L 100.00 0.00",
    );
    expect(paths.area).toBe(`${paths.line} L 100.00 100 L 0.00 100 Z`);
    expect(buildChartPaths([])).toEqual({ line: "", area: "" });
  });
});

describe("checkLabelsCollide", () => {
  it("2 つの位置の差が文字の幅より小さければ重なる", () => {
    expect(checkLabelsCollide(0.1, 0.2, 0.15)).toBe(true);
    expect(checkLabelsCollide(0.1, 0.4, 0.15)).toBe(false);
  });
});

describe("selectValueSides", () => {
  const mark = (kind: "breakEven" | "resumeBy", x: number) =>
    ({ kind, time: at("23:00"), x, outside: null, tenths: 1 }) as const;
  it("右端に近い点の数字は左に置く", () => {
    expect(selectValueSides([mark("breakEven", 0.2)])).toEqual({ breakEven: "right" });
    expect(selectValueSides([mark("breakEven", 0.9)])).toEqual({ breakEven: "left" });
  });

  it("境目と期限が近いときは、左の点を左、右の点を右に分ける", () => {
    expect(selectValueSides([mark("breakEven", 0.28), mark("resumeBy", 0.42)])).toEqual({
      breakEven: "left",
      resumeBy: "right",
    });
    expect(selectValueSides([mark("breakEven", 0.2), mark("resumeBy", 0.8)])).toEqual({
      breakEven: "right",
      resumeBy: "left",
    });
  });
});
