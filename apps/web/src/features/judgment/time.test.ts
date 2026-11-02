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

  it("目標時刻までの残りを m:ss で返す", () => {
    expect(computeCountdown("2026-11-05T21:40:00+09:00", now)).toEqual({
      totalSeconds: 822,
      passed: false,
      label: "13:42",
    });
  });

  it("1 時間以上は h:mm:ss で返す", () => {
    expect(computeCountdown("2026-11-05T22:30:00+09:00", now).label).toBe("1:03:42");
  });

  it("過ぎていれば passed にし、表示は 0:00 にする", () => {
    expect(computeCountdown("2026-11-05T21:20:00+09:00", now)).toMatchObject({
      passed: true,
      label: "0:00",
    });
  });
});

describe("formatFare", () => {
  it("null は「—」、数値は円で表示する", () => {
    expect(formatFare(null, "ja")).toBe("—");
    expect(formatFare(11800, "ja")).toMatch(/11,800/);
    expect(formatFare(11800, "en")).toMatch(/11,800/);
  });
});
