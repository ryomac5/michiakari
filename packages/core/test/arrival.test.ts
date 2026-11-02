import type { RouteLeg } from "@repo/schema";
import { describe, expect, it } from "vitest";
import { computeArrival, sumLegMinutes } from "../src/arrival.ts";
import {
  addMinutesToIso,
  diffMinutes,
  formatJstIso,
  getJstMinuteOfDay,
  parseIsoToMs,
} from "../src/time.ts";

describe("時刻の補助", () => {
  it("UTC の入力を +09:00 に直す", () => {
    expect(formatJstIso(parseIsoToMs("2026-11-05T13:30:00Z"))).toBe("2026-11-05T22:30:00+09:00");
  });

  it("オフセットのない日時は拒否する", () => {
    expect(() => parseIsoToMs("2026-11-05T22:30:00")).toThrow(RangeError);
    expect(() => parseIsoToMs("not a date")).toThrow(RangeError);
  });

  it("分を足すと日付をまたぐ", () => {
    expect(addMinutesToIso("2026-11-05T23:50:00+09:00", 15)).toBe("2026-11-06T00:05:00+09:00");
  });

  it("差を分で返す", () => {
    expect(diffMinutes("2026-11-05T23:50:00+09:00", "2026-11-06T00:20:00+09:00")).toBe(30);
  });

  it("日本時間の 0 時からの分を返す", () => {
    expect(getJstMinuteOfDay("2026-11-05T15:00:00Z")).toBe(0);
    expect(getJstMinuteOfDay("2026-11-05T23:59:00+09:00")).toBe(23 * 60 + 59);
  });
});

describe("computeArrival", () => {
  const legs: RouteLeg[] = [
    { mode: "walk", from: "甲駅", to: "乙駅", minutes: 8 },
    { mode: "wait", from: "乙駅", to: "乙駅", minutes: 4 },
    { mode: "ride", from: "乙駅", to: "丙駅", minutes: 23, line: "架空線" },
  ];

  it("出発時刻に分数の和を足す", () => {
    expect(computeArrival("2026-11-05T22:00:00+09:00", legs)).toBe("2026-11-05T22:35:00+09:00");
  });

  it("区間がなければ出発時刻のまま", () => {
    expect(computeArrival("2026-11-05T22:00:00+09:00", [])).toBe("2026-11-05T22:00:00+09:00");
  });

  it("0 分の区間は時刻を変えない", () => {
    expect(computeArrival("2026-11-05T22:00:00+09:00", [{ minutes: 0 }])).toBe(
      "2026-11-05T22:00:00+09:00",
    );
  });

  it("日付をまたぐ", () => {
    expect(computeArrival("2026-11-05T23:50:00+09:00", legs)).toBe("2026-11-06T00:25:00+09:00");
  });

  it("年をまたぐ", () => {
    expect(computeArrival("2026-12-31T23:59:00+09:00", [{ minutes: 1 }])).toBe(
      "2027-01-01T00:00:00+09:00",
    );
  });

  it("UTC の出発時刻でも +09:00 で返す", () => {
    expect(computeArrival("2026-11-05T13:00:00Z", [{ minutes: 30 }])).toBe(
      "2026-11-05T22:30:00+09:00",
    );
  });

  it("負の分数は例外", () => {
    expect(() => sumLegMinutes([{ minutes: -1 }])).toThrow(RangeError);
    expect(() => computeArrival("2026-11-05T22:00:00+09:00", [{ minutes: Number.NaN }])).toThrow(
      RangeError,
    );
  });
});
