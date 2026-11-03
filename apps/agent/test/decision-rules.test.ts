import type { BreakEvenResult } from "@repo/core";
import type { Confidence } from "@repo/schema";
import { describe, expect, it } from "vitest";
import { decisionParams, reasonLimits } from "../src/config.ts";
import { applyDecisionRules, type RuleInput } from "../src/judge/deterministic-decision.ts";
import { buildDecisionText } from "../src/judge/templates.ts";

// 決定論モードの判断規則。保留より先に切り替えを言い切る場面を確かめる
// 時刻と分は架空の場面。難波で原因が分からず止まった夜を模す

function buildResult(input: {
  minutesFromNow: number;
  marginP50Minutes: number;
  marginP80Minutes: number;
}): Extract<BreakEvenResult, { kind: "future" | "passed" }> {
  return {
    kind: "future",
    time: "2026-11-05T22:41:00+09:00",
    minutesFromNow: input.minutesFromNow,
    bestAlternativeId: "alt_1",
    bestAlternativeArrival: "2026-11-05T23:20:00+09:00",
    resumeOutlook: {
      resumeP50: "2026-11-05T23:24:00+09:00",
      resumeP80: "2026-11-06T00:39:00+09:00",
      marginP50Minutes: input.marginP50Minutes,
      marginP80Minutes: input.marginP80Minutes,
    },
  };
}

function buildInput(input: {
  eventType: string | null;
  confidence: Confidence;
  result: BreakEvenResult;
}): RuleInput {
  return {
    estimate: {
      estimate: {
        eventType: input.eventType,
        phaseId: input.eventType ? "initial" : null,
        elapsedMinutes: input.eventType ? 3 : null,
        remaining: input.eventType ? { p50: 50, p80: 125 } : null,
        confidence: input.confidence,
      },
      phaseName: null,
      phaseGuidance: null,
      phaseStartedAt: null,
      statedResumeTime: null,
      statedExtended: false,
      remainingBasis: input.eventType ? "knowledge" : null,
      skippedPhaseIds: [],
      firstTrainWait: null,
      boardableP50: null,
      boardableP80: null,
    },
    alternatives: {
      options: [],
      waitOptionId: "wait",
      waitRouteMinutesAfterResume: 10,
      blockedLine: null,
      notes: [],
    },
    breakEven: { result: input.result, comparison: [], basisOptionIds: ["alt_1"], deadline: null },
    knowledge: null,
    weather: null,
  };
}

// 分岐点まで 3 分。再開見込みの幅のすべてが分岐点より後
const nambaLate = buildResult({ minutesFromNow: 3, marginP50Minutes: -43, marginP80Minutes: -118 });

describe("保留より先に切り替えを返す規則", () => {
  it("原因が分からず、見込みが分岐点より全部後なら切り替える", () => {
    const outcome = applyDecisionRules(
      buildInput({ eventType: null, confidence: "low", result: nambaLate }),
    );
    expect(outcome).toEqual({
      action: "switch",
      reason: "resume_after_break_even",
      recommendedOptionId: "alt_1",
    });
  });

  it("確信度が低くても、見込みが分岐点より全部後なら切り替える", () => {
    const outcome = applyDecisionRules(
      buildInput({ eventType: "vehicle_failure", confidence: "low", result: nambaLate }),
    );
    expect(outcome.action).toBe("switch");
    expect(outcome.reason).toBe("resume_after_break_even");
    expect(outcome.recommendedOptionId).toBe("alt_1");
  });

  it("分岐点まで数分で、見込みの幅の大半が後なら切り替える", () => {
    const result = buildResult({ minutesFromNow: 4, marginP50Minutes: 10, marginP80Minutes: -30 });
    const outcome = applyDecisionRules(
      buildInput({ eventType: "vehicle_failure", confidence: "low", result }),
    );
    expect(outcome.action).toBe("switch");
    expect(outcome.reason).toBe("resume_mostly_after_break_even");
  });

  it("分岐点まで数分でも、見込みの幅の半分ほどが前なら保留する", () => {
    const result = buildResult({ minutesFromNow: 4, marginP50Minutes: 20, marginP80Minutes: -20 });
    const outcome = applyDecisionRules(
      buildInput({ eventType: "vehicle_failure", confidence: "low", result }),
    );
    expect(outcome).toEqual({
      action: "hold",
      reason: "low_confidence",
      recommendedOptionId: null,
    });
  });

  it("分岐点までまだ時間があれば、見込みが後でも保留を保つ", () => {
    const result = buildResult({
      minutesFromNow: decisionParams.holdDecisionWindowMinutes + 26,
      marginP50Minutes: -24,
      marginP80Minutes: -82,
    });
    for (const eventType of [null, "person_accident"]) {
      const outcome = applyDecisionRules(buildInput({ eventType, confidence: "low", result }));
      expect(outcome.action).toBe("hold");
    }
  });

  it("原因が分からず見込みが無いときは、これまでどおり保留する", () => {
    const result = { ...nambaLate, resumeOutlook: null };
    const outcome = applyDecisionRules(buildInput({ eventType: null, confidence: "low", result }));
    expect(outcome).toEqual({ action: "hold", reason: "unknown_event", recommendedOptionId: null });
  });
});

describe("大半が後のときの文言", () => {
  it("切り替えの見出しと、分岐点までの分と見込みの幅を比べる理由を返す", () => {
    const text = buildDecisionText({
      reason: "resume_mostly_after_break_even",
      language: "ja",
      breakEvenMinutesFromNow: 4,
      breakEvenTime: "2026-11-05T22:41:00+09:00",
      resumeP50: "2026-11-05T22:35:00+09:00",
      resumeP80: "2026-11-05T23:15:00+09:00",
      marginP50Minutes: 10,
      deadline: null,
      bestOption: { kind: "transfer", label: "Osaka Metro 四つ橋線", isTransferService: false },
    });
    expect(text.headline).toBe("いま別の路線に切り替えてください");
    expect(text.reason).toContain("あと4分");
    expect([...text.reason].length).toBeLessThanOrEqual(reasonLimits.ja.max);
  });
});
