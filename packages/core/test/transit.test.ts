import { describe, expect, it } from "vitest";
import { LINE_TYPES, TIMES_OF_DAY } from "../params/transit.ts";
import { classifyTimeOfDay, computeRideMinutes, computeWaitMinutes } from "../src/transit.ts";

describe("computeRideMinutes", () => {
  it("距離 0 なら 0 分", () => {
    expect(computeRideMinutes(0, "jr_rapid")).toBe(0);
  });

  it("距離 ÷ 表定速度を分に直す", () => {
    expect(computeRideMinutes(10, "jr_rapid")).toBe(10);
    expect(computeRideMinutes(16, "subway")).toBe(30);
  });

  it("端数は切り上げる", () => {
    expect(computeRideMinutes(1, "subway")).toBe(2);
  });

  it("速い路線種別ほど短い", () => {
    expect(computeRideMinutes(20, "jr_rapid")).toBeLessThan(computeRideMinutes(20, "jr_local"));
    expect(computeRideMinutes(20, "private_express")).toBeLessThan(
      computeRideMinutes(20, "private_local"),
    );
  });

  it("負または有限でない距離は例外", () => {
    expect(() => computeRideMinutes(-1, "subway")).toThrow(RangeError);
    expect(() => computeRideMinutes(Number.NaN, "subway")).toThrow(RangeError);
  });
});

describe("computeWaitMinutes", () => {
  it("運転間隔の半分を返す", () => {
    expect(computeWaitMinutes("subway", "rush")).toBe(2);
    expect(computeWaitMinutes("jr_rapid", "late_night")).toBe(10);
  });

  it("端数は切り上げる", () => {
    expect(computeWaitMinutes("subway", "daytime")).toBe(4);
  });

  it("ラッシュは日中より待ちが短く、深夜は長い", () => {
    for (const line of LINE_TYPES) {
      expect(computeWaitMinutes(line, "rush")).toBeLessThanOrEqual(
        computeWaitMinutes(line, "daytime"),
      );
      expect(computeWaitMinutes(line, "late_night")).toBeGreaterThanOrEqual(
        computeWaitMinutes(line, "daytime"),
      );
    }
  });

  it("すべての路線種別と時間帯で正の整数", () => {
    for (const line of LINE_TYPES) {
      for (const time of TIMES_OF_DAY) {
        const minutes = computeWaitMinutes(line, time);
        expect(Number.isInteger(minutes)).toBe(true);
        expect(minutes).toBeGreaterThan(0);
      }
    }
  });
});

describe("classifyTimeOfDay", () => {
  it.each([
    ["00:00", "late_night"],
    ["04:59", "late_night"],
    ["05:00", "night"],
    ["06:59", "night"],
    ["07:00", "rush"],
    ["09:29", "rush"],
    ["09:30", "daytime"],
    ["16:59", "daytime"],
    ["17:00", "rush"],
    ["19:29", "rush"],
    ["19:30", "night"],
    ["22:59", "night"],
    ["23:00", "late_night"],
    ["23:59", "late_night"],
  ])("%s は %s", (time, expected) => {
    expect(classifyTimeOfDay(`2026-11-05T${time}:00+09:00`)).toBe(expected);
  });

  it("UTC の入力も日本時間で判定する", () => {
    expect(classifyTimeOfDay("2026-11-05T14:30:00Z")).toBe("late_night");
  });
});
