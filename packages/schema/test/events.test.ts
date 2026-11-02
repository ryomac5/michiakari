import { describe, expect, it } from "vitest";
import { z } from "zod";
import { JudgmentEventSchema } from "../src/index.ts";
import { validJudgment, validObservation } from "./fixtures/api.ts";

const base = { seq: 0, at: "2026-11-05T22:55:00+09:00" };

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
    expect(schema.oneOf).toHaveLength(7);
  });
});
