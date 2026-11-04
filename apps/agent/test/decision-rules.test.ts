import type { BreakEvenResult, FlowOutlook } from "@repo/core";
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
  flowOutlook?: FlowOutlook | null;
  remainingBasis?: "knowledge" | "stated";
  statedResumeTime?: string | null;
}): RuleInput {
  const stated = input.statedResumeTime ?? null;
  return {
    estimate: {
      estimate: {
        eventType: input.eventType,
        phaseId: input.eventType ? "initial" : null,
        elapsedMinutes: input.eventType ? 3 : null,
        remaining: input.eventType || stated ? { p50: 50, p80: 125 } : null,
        confidence: input.confidence,
      },
      trainQueue: null,
      phaseName: null,
      phaseGuidance: null,
      phaseStartedAt: null,
      statedResumeTime: stated,
      statedExtended: false,
      remainingBasis: input.eventType
        ? (input.remainingBasis ?? "knowledge")
        : stated
          ? "stated"
          : null,
      skippedPhaseIds: [],
      firstTrainWait: null,
      boardableP50: null,
      boardableP80: null,
      typicalFlow: null,
      flowOutlook: input.flowOutlook ?? null,
      flowSentence: null,
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

  it("見込みの立てやすい事象は、分岐点まで時間があっても、見込みが後なら切り替える", () => {
    const result = buildResult({
      minutesFromNow: decisionParams.holdDecisionWindowMinutes + 26,
      marginP50Minutes: -24,
      marginP80Minutes: -82,
    });
    for (const confidence of ["low", "medium"] as const) {
      const outcome = applyDecisionRules(
        buildInput({ eventType: "person_accident", confidence, result, flowOutlook: "long" }),
      );
      expect(outcome).toEqual({
        action: "switch",
        reason: "resume_after_break_even",
        recommendedOptionId: "alt_1",
      });
    }
  });

  it("見込みの立てやすい事象でも、発表の見込みがあれば発表の時刻で比べる", () => {
    // 発表の見込みが分岐点をわずかに過ぎるだけなら、乗り換えるほどの差がないので待つ
    const result = buildResult({ minutesFromNow: 36, marginP50Minutes: -3, marginP80Minutes: -18 });
    const outcome = applyDecisionRules(
      buildInput({
        eventType: "person_accident",
        confidence: "high",
        result,
        flowOutlook: "long",
        remainingBasis: "stated",
      }),
    );
    expect(outcome.action).toBe("wait");
    expect(outcome.reason).toBe("resume_before_break_even");
  });

  it("原因が分からず見込みが無いときは、これまでどおり保留する", () => {
    const result = { ...nambaLate, resumeOutlook: null };
    const outcome = applyDecisionRules(buildInput({ eventType: null, confidence: "low", result }));
    expect(outcome).toEqual({ action: "hold", reason: "unknown_event", recommendedOptionId: null });
  });
});

// 原因が分からなくても、放送で聞いた再開見込みの時刻があれば、その時刻と分岐点を比べて言い切る
describe("原因が分からず、発表の再開見込みがある規則", () => {
  const stated = "2026-11-05T22:20:00+09:00";

  it("発表の時刻が分岐点より前なら、分岐点まで時間があっても待つ", () => {
    const result = buildResult({
      minutesFromNow: decisionParams.holdDecisionWindowMinutes + 26,
      marginP50Minutes: 21,
      marginP80Minutes: 11,
    });
    const outcome = applyDecisionRules(
      buildInput({ eventType: null, confidence: "medium", result, statedResumeTime: stated }),
    );
    expect(outcome).toEqual({
      action: "wait",
      reason: "stated_resume_before_break_even",
      recommendedOptionId: "wait",
    });
  });

  it("発表の時刻が分岐点より十分に後なら、分岐点まで時間があっても切り替える", () => {
    const result = buildResult({
      minutesFromNow: decisionParams.holdDecisionWindowMinutes + 26,
      marginP50Minutes: -(decisionParams.switchMarginMinutes + 1),
      marginP80Minutes: -(decisionParams.switchMarginMinutes + 11),
    });
    const outcome = applyDecisionRules(
      buildInput({ eventType: null, confidence: "medium", result, statedResumeTime: stated }),
    );
    expect(outcome).toEqual({
      action: "switch",
      reason: "stated_resume_after_break_even",
      recommendedOptionId: "alt_1",
    });
  });

  it("発表の時刻が無ければ、分岐点まで時間があるときは従来どおり保留する", () => {
    const result = buildResult({
      minutesFromNow: decisionParams.holdDecisionWindowMinutes + 26,
      marginP50Minutes: -24,
      marginP80Minutes: -82,
    });
    const outcome = applyDecisionRules(buildInput({ eventType: null, confidence: "low", result }));
    expect(outcome).toEqual({ action: "hold", reason: "unknown_event", recommendedOptionId: null });
  });
});

describe("発表の再開見込みで比べたときの文言", () => {
  const base = {
    language: "ja" as const,
    breakEvenMinutesFromNow: 36,
    breakEvenTime: "2026-11-05T22:41:00+09:00",
    resumeP50: "2026-11-05T22:20:00+09:00",
    resumeP80: "2026-11-05T22:30:00+09:00",
    deadline: null,
    bestOption: {
      kind: "transfer" as const,
      label: "Osaka Metro 四つ橋線",
      isTransferService: false,
    },
  };

  it("待つときは、発表の時刻と分岐点を並べ、見込みどおりならと添える", () => {
    const text = buildDecisionText({
      ...base,
      reason: "stated_resume_before_break_even",
      marginP50Minutes: 21,
    });
    expect(text.headline).toBe("あと36分は待てます");
    expect(text.reason).toBe(
      "発表の再開見込み22時20分が分岐点22時41分より早く、見込みどおりなら待つほうが早く着きます。",
    );
    expect([...text.reason].length).toBeLessThanOrEqual(reasonLimits.ja.max);
  });

  it("切り替えるときは、発表の時刻が分岐点より遅いことを書く", () => {
    const text = buildDecisionText({
      ...base,
      reason: "stated_resume_after_break_even",
      resumeP50: "2026-11-05T22:50:00+09:00",
      resumeP80: "2026-11-05T23:00:00+09:00",
      marginP50Minutes: -9,
    });
    expect(text.headline).toBe("いま別の路線に切り替えてください");
    expect(text.reason).toBe(
      "発表の再開見込み22時50分が分岐点22時41分より遅く、見込みどおりでも別の路線のほうが早く着くためです。",
    );
    expect([...text.reason].length).toBeLessThanOrEqual(reasonLimits.ja.max);
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
