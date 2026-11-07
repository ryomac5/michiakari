import type { BreakEvenResult, IncidentEstimateBasis, IncidentFlowOutlook } from "@repo/core";
import { type Confidence, ResumeChanceSchema } from "@repo/schema";
import { describe, expect, it } from "vitest";
import { decisionParams, reasonLimits } from "../src/config.ts";
import {
  applyDecisionRules,
  buildChanceText,
  type RuleInput,
} from "../src/judge/deterministic-decision.ts";
import { buildChanceSentence, buildDecisionText } from "../src/judge/templates.ts";
import { decisionChances } from "./fixtures/decision-chance.ts";

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
  flowOutlook?: IncidentFlowOutlook;
  remainingBasis?: IncidentEstimateBasis;
  statedResumeTime?: string | null;
}): RuleInput {
  const stated = input.statedResumeTime ?? null;
  return {
    estimate: {
      estimate: {
        eventType: input.eventType,
        phaseId: null,
        elapsedMinutes: 3,
        remaining: input.eventType || stated ? { p50: 50, p80: 125 } : null,
        confidence: input.confidence,
      },
      trainQueue: null,
      statedResumeTime: stated,
      statedExtended: false,
      remainingBasis: input.eventType
        ? (input.remainingBasis ?? "statistics")
        : stated
          ? "stated"
          : null,
      firstTrainWait: null,
      boardableP50: null,
      boardableP80: null,
      flowOutlook: input.flowOutlook ?? "unknown",
      withholdNumbers: false,
      weatherIncident: false,
      cues: [],
      protection: false,
      unaffectedTrack: null,
      resumeQueue: null,
      stopReasons: null,
    },
    alternatives: {
      options: [],
      waitOptionId: "wait",
      waitRouteMinutesAfterResume: 10,
      blockedLine: null,
      notes: [],
    },
    breakEven: { result: input.result, comparison: [], basisOptionIds: ["alt_1"], deadline: null },
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

  // 期待値を変えた: 以前は p50 が分岐点より 24 分後（動く見込みは 5 割未満）でも保留していた
  // 保留の見出しは「分岐点まで待つ」なので、動く見込みが低いのに待つと言い切っていた。窓が守るのは p50 が前の場合だけにする
  it("分岐点までまだ時間があれば、p50 が前で幅の大半が後でも保留を保つ", () => {
    const result = buildResult({
      minutesFromNow: decisionParams.holdDecisionWindowMinutes + 26,
      marginP50Minutes: 5,
      marginP80Minutes: -82,
    });
    for (const eventType of [null, "person_collision"]) {
      const outcome = applyDecisionRules(buildInput({ eventType, confidence: "low", result }));
      expect(outcome.action).toBe("hold");
    }
  });

  it("分岐点までまだ時間があっても、p50 が分岐点より後なら保留せず切り替える", () => {
    const result = buildResult({
      minutesFromNow: decisionParams.holdDecisionWindowMinutes + 26,
      marginP50Minutes: -24,
      marginP80Minutes: -82,
    });
    for (const eventType of [null, "person_collision"]) {
      const outcome = applyDecisionRules(buildInput({ eventType, confidence: "low", result }));
      expect(outcome).toEqual({
        action: "switch",
        reason: "resume_after_break_even",
        recommendedOptionId: "alt_1",
      });
    }
  });

  it("規則表で長く止まる種類は、分岐点まで時間があっても、統計値の見込みが後なら切り替える", () => {
    const result = buildResult({
      minutesFromNow: decisionParams.holdDecisionWindowMinutes + 26,
      marginP50Minutes: -24,
      marginP80Minutes: -82,
    });
    for (const confidence of ["low", "medium"] as const) {
      const outcome = applyDecisionRules(
        buildInput({ eventType: "person_collision", confidence, result, flowOutlook: "long" }),
      );
      expect(outcome).toEqual({
        action: "switch",
        reason: "resume_after_break_even",
        recommendedOptionId: "alt_1",
      });
    }
  });

  it("長く止まる種類でも、発表の見込みがあれば発表の時刻で比べる", () => {
    // 発表の時刻が分岐点より前なら、長く止まる種類でも統計値で切り替えず待つ
    const before = buildResult({ minutesFromNow: 36, marginP50Minutes: 3, marginP80Minutes: -7 });
    const input = (result: typeof before) =>
      buildInput({
        eventType: "person_collision",
        confidence: "high",
        result,
        flowOutlook: "long",
        remainingBasis: "stated",
      });
    expect(applyDecisionRules(input(before))).toMatchObject({
      action: "wait",
      reason: "resume_before_break_even",
    });
    // 発表の時刻が分岐点をわずかでも過ぎれば、見出しの時刻と食い違わないよう切り替える
    const after = buildResult({ minutesFromNow: 36, marginP50Minutes: -3, marginP80Minutes: -18 });
    expect(applyDecisionRules(input(after))).toMatchObject({
      action: "switch",
      reason: "resume_after_break_even",
    });
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

  it("発表の時刻が分岐点より少しでも後なら、乗り換えの余裕の分を見ずに切り替える", () => {
    const result = buildResult({
      minutesFromNow: decisionParams.holdDecisionWindowMinutes + 26,
      marginP50Minutes: -1,
      marginP80Minutes: -11,
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

  it("発表の時刻が分岐点と同じなら待つ", () => {
    const result = buildResult({
      minutesFromNow: decisionParams.holdDecisionWindowMinutes + 26,
      marginP50Minutes: 0,
      marginP80Minutes: -10,
    });
    const outcome = applyDecisionRules(
      buildInput({ eventType: null, confidence: "medium", result, statedResumeTime: stated }),
    );
    expect(outcome.action).toBe("wait");
  });

  it("原因が分かっていても、発表の時刻が分岐点より後なら待つと言わない", () => {
    const result = buildResult({
      minutesFromNow: decisionParams.holdDecisionWindowMinutes + 26,
      marginP50Minutes: -3,
      marginP80Minutes: -13,
    });
    const stays = applyDecisionRules(
      buildInput({
        eventType: "person_collision",
        confidence: "high",
        result,
        remainingBasis: "statistics",
      }),
    );
    // 統計値の見込みなら、乗り換えの手間の分だけ余裕を見て待つ
    expect(stays.action).toBe("wait");
    const outcome = applyDecisionRules(
      buildInput({
        eventType: "person_collision",
        confidence: "high",
        result,
        remainingBasis: "stated",
        statedResumeTime: stated,
      }),
    );
    expect(outcome).toEqual({
      action: "switch",
      reason: "resume_after_break_even",
      recommendedOptionId: "alt_1",
    });
  });

  // 期待値は保留のまま、入力を変えた: p50 が分岐点より後の入力は、時間の窓に関わらず切り替えるようにしたため
  // 保留が残るのは p50 が分岐点より前の場合なので、その入力で発表の時刻が無いときの保留を確かめる
  it("発表の時刻が無ければ、分岐点まで時間があるときは従来どおり保留する", () => {
    const result = buildResult({
      minutesFromNow: decisionParams.holdDecisionWindowMinutes + 26,
      marginP50Minutes: 5,
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
    expect(text.headline).toBe("22時41分まで待つ。動かなければ電車を乗り換える");
    expect(text.reason).toBe("発表どおり22時20分に再開すれば、待つほうが早く着きます。");
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
    expect(text.headline).toBe("電車を乗り換える");
    // 発表の時刻でも待つより遅いことを、どちらが早く着くかの比較で書く
    expect(text.reason).toBe("発表どおり22時50分に再開しても、乗り換えのほうが早く着きます。");
    expect([...text.reason].length).toBeLessThanOrEqual(reasonLimits.ja.max);
  });

  it("発表時刻と分岐点の根拠を残したまま確率の一文が90字以内に収まる", () => {
    const text = buildDecisionText({
      ...base,
      reason: "stated_resume_after_break_even",
      resumeP50: "2026-11-05T22:50:00+09:00",
      marginP50Minutes: -9,
      chance: {
        ...decisionChances.close,
        comparisonTime: base.breakEvenTime,
        keyTick: null,
      },
    });
    expect(text.reason).toBe(
      "発表どおり22時50分に再開しても、乗り換えのほうが早く着きます。22時41分までに動く見込みは2割です。",
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
    expect(text.headline).toBe("電車を乗り換える");
    expect(text.reason).toBe(
      "待つより乗り換えのほうが早く着く見込みです。再開の見込みは22時35分〜23時15分ごろです。",
    );
    expect([...text.reason].length).toBeLessThanOrEqual(reasonLimits.ja.max);
  });
});

describe("期限が理由でタクシーを勧めるときの判断", () => {
  // 分岐点は、待っても期限に間に合う最後の再開の時刻。待って期限に間に合う見込みかで、待つか切り替えるかを決める
  const deadline = "2026-11-05T23:50:00+09:00";
  const byDeadline = (input: {
    kind?: "future" | "passed";
    minutesFromNow: number;
    marginP50Minutes: number;
    marginP80Minutes: number;
  }): Extract<BreakEvenResult, { kind: "future" | "passed" }> => ({
    ...buildResult(input),
    kind: input.kind ?? "future",
    deadlineBasis: deadline,
  });

  it("待って期限に間に合う見込みなら、タクシーを勧める場面でも待つ。見込みの幅の後ろが間に合わなくてもよい", () => {
    const result = byDeadline({ minutesFromNow: 45, marginP50Minutes: 16, marginP80Minutes: -75 });
    const outcome = applyDecisionRules(
      buildInput({ eventType: "vehicle_failure", confidence: "medium", result }),
    );
    expect(outcome).toEqual({
      action: "wait",
      reason: "resume_before_break_even",
      recommendedOptionId: "wait",
    });
  });

  it("待って期限に間に合わない見込みなら、タクシーへ切り替える", () => {
    const result = byDeadline({ minutesFromNow: 20, marginP50Minutes: -20, marginP80Minutes: -90 });
    const outcome = applyDecisionRules(
      buildInput({ eventType: "vehicle_failure", confidence: "medium", result }),
    );
    expect(outcome).toEqual({
      action: "switch",
      reason: "resume_after_break_even",
      recommendedOptionId: "alt_1",
    });
  });

  it("期限から求めた分岐点を過ぎていれば、いま再開しても間に合わないので切り替える", () => {
    const result = byDeadline({
      kind: "passed",
      minutesFromNow: -10,
      marginP50Minutes: -40,
      marginP80Minutes: -90,
    });
    const outcome = applyDecisionRules(
      buildInput({ eventType: "vehicle_failure", confidence: "medium", result }),
    );
    expect(outcome.action).toBe("switch");
    expect(outcome.reason).toBe("break_even_passed");
  });
});

describe("結論の根拠と確率の比較時点", () => {
  it("確率の固定データは境界のスキーマを満たす", () => {
    for (const chance of Object.values(decisionChances)) {
      expect(ResumeChanceSchema.parse(chance)).toEqual(chance);
    }
  });

  it("期限で切り替えるときは早着確率ではなく期限内到着確率を述べる", () => {
    const input = buildInput({
      eventType: "vehicle_failure",
      confidence: "high",
      result: buildResult({
        minutesFromNow: 30,
        marginP50Minutes: 10,
        marginP80Minutes: 5,
      }),
    });
    input.breakEven.deadline = "2026-11-05T23:00:00+09:00";
    input.breakEven.comparison = [
      {
        scenario: "wait_p50",
        optionId: "wait",
        arrivalTime: "2026-11-05T23:05:00+09:00",
        minutesFromNow: 35,
        deadline: { onTime: false, marginMinutes: -5 },
      },
      {
        scenario: "alternative",
        optionId: "alt_1",
        arrivalTime: "2026-11-05T22:55:00+09:00",
        minutesFromNow: 25,
        deadline: { onTime: true, marginMinutes: 5 },
      },
    ];
    input.breakEven.resumeChance = decisionChances.deadline;
    const outcome = applyDecisionRules(input);
    expect(outcome).toMatchObject({ action: "switch", reason: "deadline_risk" });
    const chance = buildChanceText(input.breakEven, outcome.reason);
    if (!chance) throw new Error("比較時点の確率がありません");
    const sentence = buildChanceSentence(chance, "ja");
    expect(sentence).toContain("22時50分");
    expect(sentence).toContain("2割");
    expect(sentence).not.toContain("1割");
  });

  it("乗り換えの差が小さく待つときは低い確率を一般的な待つ価値と言い換えない", () => {
    const input = buildInput({
      eventType: "vehicle_failure",
      confidence: "high",
      result: buildResult({
        minutesFromNow: 30,
        marginP50Minutes: -1,
        marginP80Minutes: -10,
      }),
    });
    input.breakEven.resumeChance = decisionChances.close;
    const outcome = applyDecisionRules(input);
    expect(outcome.action).toBe("wait");
    const chance = buildChanceText(input.breakEven, outcome.reason);
    if (!chance) throw new Error("比較時点の確率がありません");
    const sentence = buildChanceSentence(chance, "ja");
    expect(sentence).toBe("22時41分までに動く見込みは2割です。");
    expect(buildChanceSentence(chance, "en")).toBe("The chance of a restart by 22:41 is 20%.");
    expect(sentence).not.toContain("待ったほうが早く着く見込み");
  });
  it("見込みの幅の大半が後なら分岐点後の遅めの再開時点を述べる", () => {
    const input = buildInput({
      eventType: "vehicle_failure",
      confidence: "low",
      result: buildResult({
        minutesFromNow: 4,
        marginP50Minutes: 2,
        marginP80Minutes: -18,
      }),
    });
    input.breakEven.resumeChance = decisionChances.mostlyLate;
    if (input.breakEven.result.kind !== "future" || !input.breakEven.result.resumeOutlook) {
      throw new Error("再開見込みがありません");
    }
    input.breakEven.result.resumeOutlook.resumeP50 = "2026-11-05T22:39:00+09:00";
    input.breakEven.result.resumeOutlook.resumeP80 = "2026-11-05T22:59:00+09:00";
    const outcome = applyDecisionRules(input);
    expect(outcome).toMatchObject({ action: "switch", reason: "resume_mostly_after_break_even" });
    const chance = buildChanceText(input.breakEven, outcome.reason);
    if (!chance) throw new Error("比較時点の確率がありません");
    const sentence = buildChanceSentence(chance, "ja");
    expect(sentence).toBe("遅めに見ると、23時00分までに動く見込みは9割です。");
    expect(buildChanceSentence(chance, "en")).toBe(
      "Looking later, the chance of a restart by 23:00 is 90%.",
    );
    expect(chance.waitFaster).toBeNull();
    expect(sentence).not.toContain("待ったほうが早く着く見込み");
  });

  it("延長後の遅めの見込みで切り替えるときも分岐点後の確率を述べる", () => {
    const input = buildInput({
      eventType: "vehicle_failure",
      confidence: "high",
      remainingBasis: "stated",
      result: buildResult({ minutesFromNow: 4, marginP50Minutes: 2, marginP80Minutes: -18 }),
    });
    input.estimate.statedExtended = true;
    input.breakEven.resumeChance = decisionChances.mostlyLate;
    const outcome = applyDecisionRules(input);
    expect(outcome).toMatchObject({ action: "switch", reason: "estimate_extended" });
    const chance = buildChanceText(input.breakEven, outcome.reason);
    if (!chance) throw new Error("比較時点の確率がありません");
    expect(chance.waitFaster).toBeNull();
    expect(chance.waitOnTime).toBeNull();
    expect(buildChanceSentence(chance, "ja")).toBe(
      "遅めに見ると、23時00分までに動く見込みは9割です。",
    );
  });

  it.each([false, true])("目盛りが7割まででも確率文を残す。見込み延長=%s", (extended) => {
    const input = buildInput({
      eventType: "vehicle_failure",
      confidence: extended ? "high" : "low",
      remainingBasis: extended ? "stated" : "statistics",
      result: buildResult({ minutesFromNow: 4, marginP50Minutes: 2, marginP80Minutes: -18 }),
    });
    input.estimate.statedExtended = extended;
    input.breakEven.resumeChance = decisionChances.cappedLate;
    const outcome = applyDecisionRules(input);
    expect(outcome).toMatchObject({
      action: "switch",
      reason: extended ? "estimate_extended" : "resume_mostly_after_break_even",
    });
    const chance = buildChanceText(input.breakEven, outcome.reason);
    if (!chance) throw new Error("比較時点の確率がありません");
    expect(chance.waitFaster).toBeNull();
    expect(chance.waitOnTime).toBeNull();
    expect(buildChanceSentence(chance, "ja")).toBe(
      "遅めに見ると、22時50分までに動く見込みは6割です。",
    );
    expect(buildChanceSentence(chance, "en")).toBe(
      "Looking later, the chance of a restart by 22:50 is 60%.",
    );
  });
});

describe("再開後の詰まりの規則と、雨の保留", () => {
  // 境目まで時間があり、再開の見込みは境目より前。詰まりが無ければ待つ場面
  const early = buildResult({ minutesFromNow: 40, marginP50Minutes: 20, marginP80Minutes: 5 });
  const queue = {
    closesUp: true,
    trainsInQueue: 2,
    waitRange: { minMinutes: 6, maxMinutes: 10 },
    queueAnnounced: true,
    worthAlightingAtNextStation: true,
  };
  const rain = {
    source: "scenario" as const,
    stationName: null,
    readings: [],
    summary: { latest: null, trend: "rising" as const, rainContinuing: true },
  };

  function buildQueueInput(withRain: boolean): RuleInput {
    const input = buildInput({ eventType: "heavy_rain", confidence: "medium", result: early });
    input.estimate.weatherIncident = true;
    input.estimate.resumeQueue = queue;
    return { ...input, weather: withRain ? rain : null };
  }

  it("雨が続くあいだの保留は、詰まりで降りる価値があっても切り替えに変えない", () => {
    expect(applyDecisionRules(buildQueueInput(true))).toEqual({
      action: "hold",
      reason: "rain_continuing",
      recommendedOptionId: null,
    });
  });

  it("雨の保留が無ければ、詰まりで降りる価値があるとき待つ代わりに切り替える", () => {
    expect(applyDecisionRules(buildQueueInput(false))).toEqual({
      action: "switch",
      reason: "queue_after_resume",
      recommendedOptionId: "alt_1",
    });
  });
});

describe("線路に降りる案内の規則", () => {
  it("降りる案内があれば、見込みや分岐点より先に係員の案内に従う結論にする", () => {
    const input = buildInput({
      eventType: "person_collision",
      confidence: "low",
      result: nambaLate,
    });
    input.estimate.cues = ["evacuation_on_track"];
    expect(applyDecisionRules(input)).toEqual({
      action: "hold",
      reason: "follow_staff",
      recommendedOptionId: null,
    });
    const text = buildDecisionText({
      reason: "follow_staff",
      language: "ja",
      breakEvenMinutesFromNow: 3,
      breakEvenTime: "2026-11-05T22:41:00+09:00",
      resumeP50: null,
      resumeP80: null,
      marginP50Minutes: null,
      deadline: null,
      deadlineBasis: null,
      bestOption: null,
      flow: null,
      chance: null,
    });
    expect(text.headline).toBe("係員の案内に従う");
    expect(text.reason).not.toMatch(/\d{1,2}:\d{2}/);
  });
});
