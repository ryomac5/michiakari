import { describe, expect, it } from "vitest";
import { z } from "zod";
import { JudgmentEventSchema } from "../src/index.ts";
import { validJudgment, validObservation } from "./fixtures/api.ts";

const base = { seq: 0, at: "2026-11-05T22:55:00+09:00" };

const weatherChecked = {
  type: "weather_checked",
  source: "scenario",
  readings: [
    { time: "2026-11-05T18:00:00+09:00", rainfall10minMm: 6 },
    { time: "2026-11-05T18:10:00+09:00", rainfall10minMm: 9 },
  ],
  warnings: ["大雨警報"],
  trend: "rising",
  summary: "直近の10分雨量は9mmで、強まっています。",
};

// 開始時刻から 10 分ごとの雨量を n 件並べる
function buildReadings(n: number, startIso = "2026-11-05T12:00:00+09:00") {
  const start = Date.parse(startIso);
  return Array.from({ length: n }, (_, i) => ({
    time: new Date(start + i * 600_000).toISOString().replace("Z", "+00:00"),
    rainfall10minMm: i % 5,
  }));
}

describe("JudgmentEventSchema", () => {
  it.each([
    { type: "observation_parsed", observation: validObservation },
    {
      type: "signal_detected",
      signal: { eventType: "sample_event", signalId: "work_started", quote: "対応を始めました" },
    },
    { type: "phase_estimated", estimate: validJudgment.estimate },
    { type: "alternatives_computed", options: validJudgment.options },
    { type: "break_even_computed", breakEven: validJudgment.breakEven },
    { type: "break_even_computed", breakEven: null },
    { type: "judgment_ready", judgment: validJudgment },
    { type: "error", message: "タイムアウト", retryable: true },
    { type: "progress", message: "知見を確かめています", stage: "knowledge" },
    { type: "progress", message: "考えています" },
    weatherChecked,
    { ...weatherChecked, source: "jma", readings: [], warnings: [], trend: "unknown" },
    {
      ...weatherChecked,
      readings: [{ time: "2026-11-05T18:00:00+09:00", rainfall10minMm: null }],
    },
  ])("$type を受け入れる", (event) => {
    expect(JudgmentEventSchema.safeParse({ ...base, ...event }).success).toBe(true);
  });

  it("未知の type を拒否する", () => {
    expect(JudgmentEventSchema.safeParse({ ...base, type: "unknown" }).success).toBe(false);
  });

  it("seq と at を全イベントで必須にする", () => {
    const event = { type: "error", message: "x", retryable: false };
    expect(JudgmentEventSchema.safeParse({ ...event, at: base.at }).success).toBe(false);
    expect(JudgmentEventSchema.safeParse({ ...event, seq: 1 }).success).toBe(false);
    expect(JudgmentEventSchema.safeParse({ ...event, seq: -1, at: base.at }).success).toBe(false);
  });

  it("signal_detected で兆候を展開した旧形式を拒否する", () => {
    const event = {
      ...base,
      type: "signal_detected",
      eventType: "sample_event",
      signalId: "work_started",
      quote: "対応を始めました",
    };
    expect(JudgmentEventSchema.safeParse(event).success).toBe(false);
  });

  it("type に合わない中身を拒否する", () => {
    const event = { ...base, type: "judgment_ready", judgment: { action: "wait" } };
    expect(JudgmentEventSchema.safeParse(event).success).toBe(false);
  });

  it("z.toJSONSchema で例外なく変換できる", () => {
    const schema = z.toJSONSchema(JudgmentEventSchema);
    expect(schema.oneOf).toHaveLength(9);
  });

  it("progress は空の文と未知の段階を拒否する", () => {
    expect(JudgmentEventSchema.safeParse({ ...base, type: "progress", message: "" }).success).toBe(
      false,
    );
    const unknownStage = { ...base, type: "progress", message: "x", stage: "unknown" };
    expect(JudgmentEventSchema.safeParse(unknownStage).success).toBe(false);
  });

  it("weather_checked は 36 件・6 時間までの昇順の雨量を受け入れる", () => {
    const ok = { ...base, ...weatherChecked, readings: buildReadings(36) };
    expect(JudgmentEventSchema.safeParse(ok).success).toBe(true);
    const tooMany = { ...base, ...weatherChecked, readings: buildReadings(37) };
    expect(JudgmentEventSchema.safeParse(tooMany).success).toBe(false);
  });

  it("weather_checked は 6 時間を超える幅と逆順の雨量を拒否する", () => {
    const wide = {
      ...base,
      ...weatherChecked,
      readings: [
        { time: "2026-11-05T12:00:00+09:00", rainfall10minMm: 1 },
        { time: "2026-11-05T18:10:00+09:00", rainfall10minMm: 2 },
      ],
    };
    expect(JudgmentEventSchema.safeParse(wide).success).toBe(false);
    const reversed = {
      ...base,
      ...weatherChecked,
      readings: [...weatherChecked.readings].reverse(),
    };
    expect(JudgmentEventSchema.safeParse(reversed).success).toBe(false);
  });

  it("weather_checked は未知の出典・傾向、負の雨量、空の要約を拒否する", () => {
    const cases = [
      { source: "jma_amedas" },
      { trend: "up" },
      { readings: [{ time: "2026-11-05T18:00:00+09:00", rainfall10minMm: -1 }] },
      { summary: "" },
    ];
    for (const patch of cases) {
      expect(JudgmentEventSchema.safeParse({ ...base, ...weatherChecked, ...patch }).success).toBe(
        false,
      );
    }
  });
});
