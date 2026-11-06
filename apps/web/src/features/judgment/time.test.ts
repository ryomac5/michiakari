import { describe, expect, it } from "vitest";
import {
  computeCountdown,
  computeCountdownFrom,
  formatClockInSentence,
  formatClockTime,
  formatFare,
  formatIsoWithOffset,
  spellClockInSentence,
} from "./time";

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

describe("formatClockInSentence", () => {
  it("ja の文には「21時40分」、en の文には「21:40」を返す", () => {
    expect(formatClockInSentence("2026-11-05T12:40:00Z", "ja")).toBe("21時40分");
    expect(formatClockInSentence("2026-11-05T20:05:00+09:00", "ja")).toBe("20時05分");
    expect(formatClockInSentence("2026-11-05T00:05:00+09:00", "ja")).toBe("0時05分");
    expect(formatClockInSentence("2026-11-05T21:40:00+09:00", "en")).toBe("21:40");
  });
});

describe("spellClockInSentence", () => {
  it("「HH:MM」を ja の文では「21時40分」にし、en ではそのまま返す", () => {
    expect(spellClockInSentence("00:25", "ja")).toBe("0時25分");
    expect(spellClockInSentence("21:40", "en")).toBe("21:40");
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

describe("computeCountdownFrom", () => {
  // 基準時刻 21:26:18 で分岐点 21:49:00 なら、見出しは round(22.7) で「あと23分」
  const basis = "2026-11-05T21:26:18+09:00";
  const target = "2026-11-05T21:49:00+09:00";

  it("基準時刻の直後は、見出しと同じ四捨五入の分を返す", () => {
    const now = new Date("2026-11-05T21:26:20+09:00");
    expect(computeCountdownFrom(target, basis, now)).toMatchObject({
      kind: "minutes",
      hours: 0,
      minutes: 23,
      passed: false,
    });
    expect(computeCountdown(target, now).minutes).toBe(22);
  });

  it("基準時刻から 1 分経つごとに 1 分ずつ減る", () => {
    expect(computeCountdownFrom(target, basis, new Date("2026-11-05T21:27:17+09:00")).minutes).toBe(
      23,
    );
    expect(computeCountdownFrom(target, basis, new Date("2026-11-05T21:27:18+09:00")).minutes).toBe(
      22,
    );
    expect(computeCountdownFrom(target, basis, new Date("2026-11-05T21:48:18+09:00")).minutes).toBe(
      1,
    );
  });

  it("1 時間以上は時間と分に分け、残り 1 分未満は imminent、過ぎれば passed にする", () => {
    expect(computeCountdownFrom("2026-11-05T22:30:00+09:00", basis, new Date(basis))).toMatchObject(
      { kind: "hours", hours: 1, minutes: 4 },
    );
    expect(computeCountdownFrom("2026-11-05T21:26:40+09:00", basis, new Date(basis))).toMatchObject(
      { kind: "imminent", minutes: 0, passed: false },
    );
    expect(
      computeCountdownFrom(target, basis, new Date("2026-11-05T21:49:00+09:00")),
    ).toMatchObject({ kind: "passed", passed: true });
  });
});

describe("formatFare", () => {
  it("null は「—」、数値は円で表示する", () => {
    expect(formatFare(null, "ja")).toBe("—");
    expect(formatFare(11800, "ja")).toMatch(/11,800/);
    expect(formatFare(11800, "en")).toMatch(/11,800/);
  });
});
