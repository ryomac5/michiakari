import { describe, expect, it } from "vitest";
import { MAP_SCALE, pickMapScale, scalePaintValue } from "./map-scale";

describe("pickMapScale", () => {
  it("640px 未満はスマホの倍率にする", () => {
    expect(pickMapScale(390)).toEqual({ line: 0.75, mark: 0.8 });
    expect(pickMapScale(639)).toBe(MAP_SCALE.mobile);
  });

  it("640px 以上は今の見た目のままにする", () => {
    expect(pickMapScale(640)).toEqual({ line: 1, mark: 1 });
    expect(pickMapScale(1280)).toBe(MAP_SCALE.desktop);
  });
});

describe("scalePaintValue", () => {
  it("数値を倍にする", () => {
    expect(scalePaintValue(10, 0.75)).toBe(7.5);
  });

  it("zoom の補間は出力の値だけを倍にする", () => {
    expect(scalePaintValue(["interpolate", ["linear"], ["zoom"], 9, 1, 15, 4], 0.5)).toEqual([
      "interpolate",
      ["linear"],
      ["zoom"],
      9,
      0.5,
      15,
      2,
    ]);
  });

  it("case は分岐の値と既定値を倍にする", () => {
    expect(scalePaintValue(["case", ["get", "a"], 7, 5], 0.8)).toEqual([
      "case",
      ["get", "a"],
      7 * 0.8,
      5 * 0.8,
    ]);
  });

  it("補間の中の case も倍にする", () => {
    const base = ["interpolate", ["linear"], ["zoom"], 10, ["case", ["get", "a"], 2, 1], 16, 4];
    expect(scalePaintValue(base, 0.5)).toEqual([
      "interpolate",
      ["linear"],
      ["zoom"],
      10,
      ["case", ["get", "a"], 1, 0.5],
      16,
      2,
    ]);
  });

  it("その他の式は掛け算で包み、倍率 1 では何も変えない", () => {
    const expr = ["+", 2, ["*", 5, ["get", "strength"]]];
    expect(scalePaintValue(expr, 0.75)).toEqual(["*", 0.75, expr]);
    expect(scalePaintValue(expr, 1)).toBe(expr);
  });
});
