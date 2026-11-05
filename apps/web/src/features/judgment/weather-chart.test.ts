import { describe, expect, it } from "vitest";
import { buildWeatherChart, formatWarningName, hasWeatherWarning } from "./weather-chart";

const at = (minute: number) => `2026-11-05T18:${String(minute).padStart(2, "0")}:00+09:00`;

describe("buildWeatherChart", () => {
  it("観測ごとに枠を等分し、最大値を上端に棒の高さを割り当てる", () => {
    const chart = buildWeatherChart([
      { time: at(0), rainfall10minMm: 6 },
      { time: at(10), rainfall10minMm: 12 },
    ]);
    expect(chart.scaleMaxMm).toBe(12);
    expect(chart.bars.map((b) => b.height)).toEqual([0.5, 1]);
    expect(chart.bars[0]?.x).toBeCloseTo(0.095);
    expect(chart.bars[1]?.x).toBeCloseTo(0.595);
    expect(chart.bars.map((b) => b.latest)).toEqual([false, true]);
    expect(chart.missingCount).toBe(0);
  });

  it("弱い雨だけのときも上端は 5mm を下回らない", () => {
    const chart = buildWeatherChart([{ time: at(0), rainfall10minMm: 1 }]);
    expect(chart.scaleMaxMm).toBe(5);
    expect(chart.bars[0]?.height).toBeCloseTo(0.2);
  });

  it("欠測は高さ 0 で数に入れ、最新の印は欠測でない最後の観測に付ける", () => {
    const chart = buildWeatherChart([
      { time: at(0), rainfall10minMm: 3 },
      { time: at(10), rainfall10minMm: null },
    ]);
    expect(chart.bars.map((b) => [b.mm, b.height, b.latest])).toEqual([
      [3, 0.6, true],
      [null, 0, false],
    ]);
    expect(chart.missingCount).toBe(1);
  });

  it("観測が無ければ棒も無い", () => {
    expect(buildWeatherChart([])).toEqual({ bars: [], scaleMaxMm: 5, missingCount: 0 });
  });
});

describe("hasWeatherWarning", () => {
  it("警報だけを数え、注意報は数えない", () => {
    expect(hasWeatherWarning(["大雨警報"])).toBe(true);
    expect(hasWeatherWarning(["大雨注意報"])).toBe(false);
    expect(hasWeatherWarning([])).toBe(false);
  });
});

describe("formatWarningName", () => {
  it("英語では表にある名前を英語に直し、無ければそのまま出す", () => {
    expect(formatWarningName("大雨警報", "en")).toBe("Heavy rain warning");
    expect(formatWarningName("大雨警報", "ja")).toBe("大雨警報");
    expect(formatWarningName("波浪注意報", "en")).toBe("波浪注意報");
  });
});
