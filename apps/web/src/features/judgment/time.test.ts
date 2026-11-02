import { describe, expect, it } from "vitest";
import { computeCountdown, formatClockTime, formatFare, formatIsoWithOffset } from "./time";

describe("formatIsoWithOffset", () => {
  it("時差付きの ISO 8601 を返し、同じ時刻を指す", () => {
    const date = new Date("2026-11-05T13:40:05Z");
    const iso = formatIsoWithOffset(date);
    expect(iso).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}[+-]\d{2}:\d{2}$/);
    expect(Date.parse(iso)).toBe(date.getTime());
  });
});

describe("formatClockTime", () => {
  it("日本時間の HH:MM を返す", () => {
    expect(formatClockTime("2026-11-05T12:40:00Z", "ja")).toBe("21:40");
    expect(formatClockTime("2026-11-05T21:40:00+09:00", "en")).toBe("21:40");
  });
});

describe("computeCountdown", () => {
  const now = new Date("2026-11-05T21:26:18+09:00");

  it("目標時刻までの残りを分で返し、端数の秒は切り捨てる", () => {
    expect(computeCountdown("2026-11-05T21:40:00+09:00", now)).toEqual({
      totalSeconds: 822,
      passed: false,
      kind: "minutes",
      hours: 0,
      minutes: 13,
    });
  });

  it("1 時間以上は時間と分に分ける", () => {
    expect(computeCountdown("2026-11-05T22:30:00+09:00", now)).toMatchObject({
      kind: "hours",
      hours: 1,
      minutes: 3,
    });
  });

  it("1 分未満は imminent にする", () => {
    expect(computeCountdown("2026-11-05T21:27:00+09:00", now)).toMatchObject({
      kind: "imminent",
      passed: false,
      minutes: 0,
    });
  });

  it("過ぎていれば passed にする", () => {
    expect(computeCountdown("2026-11-05T21:20:00+09:00", now)).toMatchObject({
      kind: "passed",
      passed: true,
    });
    expect(computeCountdown("2026-11-05T21:26:18+09:00", now).kind).toBe("passed");
  });
});

describe("formatFare", () => {
  it("null は「—」、数値は円で表示する", () => {
    expect(formatFare(null, "ja")).toBe("—");
    expect(formatFare(11800, "ja")).toMatch(/11,800/);
    expect(formatFare(11800, "en")).toMatch(/11,800/);
  });
});
