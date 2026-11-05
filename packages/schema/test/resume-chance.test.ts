import { describe, expect, it } from "vitest";
import { z } from "zod";
import {
  BreakEvenSchema,
  JudgmentSchema,
  type ResumeChance,
  ResumeChanceSchema,
} from "../src/index.ts";
import { validJudgment } from "./fixtures/api.ts";

// 時刻ごとの再開の見込み。BreakEven の任意項目として受け入れる

const at = (clock: string) => `2026-11-05T${clock}:00+09:00`;

const validChance: ResumeChance = {
  stepMinutes: 15,
  ticks: [
    { time: at("23:00"), tenths: 0, sinceOnsetMinutes: 20 },
    { time: at("23:15"), tenths: 3, sinceOnsetMinutes: 35 },
    { time: at("23:30"), tenths: 6, sinceOnsetMinutes: 50 },
    { time: at("23:45"), tenths: 10, sinceOnsetMinutes: 65 },
  ],
  waitFaster: 3,
  waitOnTime: null,
  resumeByForDeadline: null,
  onsetTime: at("22:40"),
};

describe("ResumeChanceSchema", () => {
  it("合格例を受け入れ、BreakEven の任意項目として持てる", () => {
    expect(ResumeChanceSchema.safeParse(validChance).success).toBe(true);
    if (!validJudgment.breakEven) throw new Error("fixture");
    const breakEven = { ...validJudgment.breakEven, resumeChance: validChance };
    expect(BreakEvenSchema.safeParse(breakEven).success).toBe(true);
    expect(JudgmentSchema.safeParse({ ...validJudgment, breakEven }).success).toBe(true);
    // 無くてもよい
    expect(BreakEvenSchema.safeParse(validJudgment.breakEven).success).toBe(true);
  });

  it("確率は 0〜10 の整数に限る", () => {
    for (const tenths of [-1, 11, 2.5]) {
      const ticks = validChance.ticks.map((t, i) => (i === 0 ? { ...t, tenths } : t));
      expect(ResumeChanceSchema.safeParse({ ...validChance, ticks }).success).toBe(false);
      expect(ResumeChanceSchema.safeParse({ ...validChance, waitFaster: tenths }).success).toBe(
        false,
      );
    }
  });

  it("目盛りは 4〜6 個に限る", () => {
    const [first] = validChance.ticks;
    if (!first) throw new Error("fixture");
    expect(
      ResumeChanceSchema.safeParse({ ...validChance, ticks: validChance.ticks.slice(0, 3) })
        .success,
    ).toBe(false);
    const seven = [...validChance.ticks, first, first, first];
    expect(ResumeChanceSchema.safeParse({ ...validChance, ticks: seven }).success).toBe(false);
  });

  it("発生が分からなければ、目盛りの発生からの分も null にできる", () => {
    const unknownOnset = {
      ...validChance,
      onsetTime: null,
      ticks: validChance.ticks.map((t) => ({ ...t, sinceOnsetMinutes: null })),
    };
    expect(ResumeChanceSchema.safeParse(unknownOnset).success).toBe(true);
  });

  it("z.toJSONSchema で例外なく変換できる", () => {
    const schema = z.toJSONSchema(JudgmentSchema);
    expect(schema.type).toBe("object");
  });
});
