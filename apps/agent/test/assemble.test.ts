import { describe, expect, it } from "vitest";
import { headlineLimits, reasonLimits } from "../src/config.ts";
import {
  assembleJudgment,
  checkDecisiveWording,
  checkHeadlineLength,
  checkReasonLength,
  checkSectionWording,
  extractTextNumbers,
  type SectionWordingContext,
} from "../src/judge/assemble.ts";
import { createEventSink } from "../src/judge/event-sink.ts";
import { createJudgeSession } from "../src/judge/session.ts";
import { formatClock } from "../src/judge/templates.ts";
import { DecisionSchema } from "../src/tools/emit-judgment.ts";
import { buildScenarioRequest, createTestDeps } from "./helpers.ts";

// assembleJudgment が数値をツールの結果から取り、決定に混ぜた数値を無視することを確かめる

const deps = createTestDeps();

async function prepareSession() {
  const scenario = [...deps.content.scenarios.values()][0];
  const entry = scenario?.timeline[0];
  if (!scenario || !entry) throw new Error("シナリオがありません");
  const request = buildScenarioRequest(scenario, entry, []);
  // 発表の引用の根拠は、種類の id で、種類の呼び名を含む原文の文から作る
  const eventType = scenario.event_type;
  const observation = {
    id: entry.id,
    observedAt: request.now,
    source: "scenario" as const,
    rawText: entry.text.ja,
    eventTypeCandidates: [{ eventType, confidence: "high" as const }],
    operator: null,
    line: null,
    section: null,
    statedResumeTime: null,
    transferServiceActive: null,
    detectedSignals: [],
  };
  const session = createJudgeSession(
    {
      request,
      observations: [observation],
      content: deps.content,
      provider: deps.provider,
      scenario,
      fetchRain: deps.fetchRain,
    },
    createEventSink(
      async () => {},
      () => request.now,
    ),
  );
  await session.executeTool("estimate_remaining", { eventType });
  await session.executeTool("find_alternatives", {});
  await session.executeTool("compute_break_even", {});
  const { estimate, alternatives, breakEven } = session.state;
  if (!estimate || !alternatives || !breakEven) throw new Error("ツールの結果がそろいません");
  return { session, results: { estimate, alternatives, breakEven }, signalId: eventType, request };
}

describe("assembleJudgment", () => {
  it("決定に混ぜた数値を無視し、ツールの結果の数値を使う", async () => {
    const { results, signalId } = await prepareSession();
    const tampered = {
      action: "hold",
      headline: "様子を見ましょう",
      reason: "理由",
      breakEvenExplanation: "説明",
      recommendedOptionId: null,
      evidence: [{ kind: "signal", id: signalId, description: "根拠" }],
      // Claude が数値を入れてきた場合
      estimate: {
        eventType: "x",
        phaseId: "y",
        elapsedMinutes: 999,
        remaining: { p50: 1, p80: 2 },
        confidence: "high",
      },
      breakEven: { time: "2000-01-01T00:00:00+09:00", explanation: "改ざん" },
      options: [],
      fareYen: 1,
    };
    const decision = DecisionSchema.parse(tampered);
    expect(Object.keys(decision).sort()).toEqual(
      [
        "action",
        "breakEvenExplanation",
        "evidence",
        "headline",
        "reason",
        "recommendedOptionId",
      ].sort(),
    );
    const judgment = assembleJudgment(
      results,
      { ...decision, ...tampered } as typeof decision,
      "ja",
    );
    expect(judgment.estimate).toEqual(results.estimate.estimate);
    expect(judgment.options).toEqual(results.alternatives.options);
    const r = results.breakEven.result;
    if (r.kind !== "future" && r.kind !== "passed") throw new Error("分岐点がありません");
    // 分岐点の時刻と再開の見込みの確率はツールの結果から取り、説明だけを決定から受け取る
    expect(judgment.breakEven).toEqual({
      time: r.time,
      explanation: "説明",
      resumeChance: results.breakEven.resumeChance,
    });
    expect(judgment.reason).toBe("理由");
    expect(judgment.disclaimer.length).toBeGreaterThan(0);
  });
});

describe("validateJudgment", () => {
  it("ツールの結果に無い根拠・時刻・推奨を指摘する", async () => {
    const { session, results } = await prepareSession();
    const judgment = assembleJudgment(
      results,
      {
        action: "switch",
        headline: "3時33分までに切り替える",
        reason: "理由",
        breakEvenExplanation: "説明",
        recommendedOptionId: "wait",
        evidence: [{ kind: "signal", id: "unknown_signal", description: "根拠" }],
      },
      "ja",
    );
    const { judgment: valid, errors } = session.checkJudgment(judgment, results);
    expect(valid).toBeNull();
    expect(errors.some((e) => e.includes("unknown_signal"))).toBe(true);
    expect(errors.some((e) => e.includes("3時33分"))).toBe(true);
    expect(errors.some((e) => e.includes("switch"))).toBe(true);
  });

  it("分・円・時だけの表記と英語の数値を、根拠の説明も含めて検査する", async () => {
    const { session, results, signalId } = await prepareSession();
    const fare = results.alternatives.options.find((o) => o.fareYen !== null)?.fareYen;
    if (fare === undefined || fare === null) throw new Error("運賃のある選択肢がありません");
    const judgment = assembleJudgment(
      results,
      {
        action: "hold",
        headline: `あと 7777分で再開します。タクシーは${fare.toLocaleString("ja-JP")}円です`,
        reason: "6661分後に再開するためです。",
        breakEvenExplanation: "3時ごろまで待ちましょう。about 999 min, ¥12,345 or 54321 yen",
        recommendedOptionId: null,
        evidence: [{ kind: "signal", id: signalId, description: "8881分で直ります" }],
      },
      "ja",
    );
    const { errors } = session.checkJudgment(judgment, results);
    const joined = errors.join("\n");
    for (const raw of ["7777分", "6661分", "3時", "999 min", "¥12,345", "54321 yen", "8881分"]) {
      expect(joined).toContain(raw);
    }
    expect(joined).not.toContain(`${fare.toLocaleString("ja-JP")}円`);
    // 数値の指摘は 1 件ずつ。再開の時間を言い切る言い方の指摘は別に数える
    expect(errors.filter((e) => e.startsWith("evidence[0].description の数値"))).toHaveLength(1);
    expect(errors.filter((e) => e.startsWith("reason の数値"))).toHaveLength(1);
  });

  it("ツールの結果の残り時間・徒歩・運賃の数値なら通る", async () => {
    const { session, results, signalId } = await prepareSession();
    const remaining = results.estimate.estimate.remaining;
    const option = results.alternatives.options.find((o) => o.kind === "transfer");
    const fare = results.alternatives.options.find((o) => o.fareYen !== null)?.fareYen;
    if (!remaining || !option || fare === undefined || fare === null)
      throw new Error("前提がそろいません");
    const judgment = assembleJudgment(
      results,
      {
        action: "hold",
        headline: `再開まで約${remaining.p50}分、遅いと${remaining.p80}分`,
        reason: `振替なら徒歩${option.walkMinutes}分で済むためです。`,
        breakEvenExplanation: `振替は徒歩${option.walkMinutes}分、タクシーは ¥${fare}`,
        recommendedOptionId: null,
        evidence: [{ kind: "signal", id: signalId, description: `about ${remaining.p50} min` }],
      },
      "ja",
    );
    expect(session.checkJudgment(judgment, results).errors).toEqual([]);
  });

  it("ツールの結果の時刻と根拠だけなら通る", async () => {
    const { session, results, signalId } = await prepareSession();
    const r = results.breakEven.result;
    if (r.kind !== "future" && r.kind !== "passed") throw new Error("分岐点がありません");
    const judgment = assembleJudgment(
      results,
      {
        action: "hold",
        headline: `${formatClock(r.time, "ja")}までに再開しなければ切り替えを考えましょう`,
        reason: r.resumeOutlook
          ? `再開見込み${formatClock(r.resumeOutlook.resumeP50, "ja")}頃と分岐点${formatClock(r.time, "ja")}を比べたためです。`
          : `分岐点${formatClock(r.time, "ja")}を見たためです。`,
        breakEvenExplanation: "説明",
        recommendedOptionId: null,
        evidence: [{ kind: "signal", id: signalId, description: "根拠" }],
      },
      "ja",
    );
    const checked = session.checkJudgment(judgment, results);
    expect(checked.errors).toEqual([]);
  });

  it("switch の推奨は、分岐点の計算が勧める代替手段にそろえる。選び直すと指摘する", async () => {
    const { session, results, signalId } = await prepareSession();
    const r = results.breakEven.result;
    if (r.kind !== "future" && r.kind !== "passed") throw new Error("分岐点がありません");
    const other = results.alternatives.options.find(
      (o) => o.kind !== "wait" && o.id !== r.bestAlternativeId,
    );
    if (!other) throw new Error("ほかの代替手段がありません");
    const buildSwitch = (recommendedOptionId: string) =>
      assembleJudgment(
        results,
        {
          action: "switch",
          headline: "いま切り替えてください",
          reason: "理由",
          breakEvenExplanation: "説明",
          recommendedOptionId,
          evidence: [{ kind: "signal", id: signalId, description: "根拠" }],
        },
        "ja",
      );
    const mismatch = "compute_break_even が勧める代替手段";
    const wrong = session.checkJudgment(buildSwitch(other.id), results).errors;
    expect(wrong.some((e) => e.includes(mismatch))).toBe(true);
    const right = session.checkJudgment(buildSwitch(r.bestAlternativeId), results).errors;
    expect(right.some((e) => e.includes(mismatch))).toBe(false);
  });
});

describe("checkHeadlineLength", () => {
  it("上限ちょうどは通し、超えたら指摘する", () => {
    for (const language of ["ja", "en"] as const) {
      const { max } = headlineLimits[language];
      expect(checkHeadlineLength("あ".repeat(max), language)).toEqual([]);
      expect(checkHeadlineLength("あ".repeat(max + 1), language)).toHaveLength(1);
    }
  });

  it("長すぎる見出しは判断の検証でも指摘する", async () => {
    const { session, results, signalId } = await prepareSession();
    const judgment = assembleJudgment(
      results,
      {
        action: "hold",
        headline: "あ".repeat(headlineLimits.ja.max + 1),
        reason: "理由",
        breakEvenExplanation: "説明",
        recommendedOptionId: null,
        evidence: [{ kind: "signal", id: signalId, description: "根拠" }],
      },
      "ja",
    );
    const { judgment: valid, errors } = session.checkJudgment(judgment, results);
    expect(valid).toBeNull();
    expect(errors.some((e) => e.startsWith("headline が長すぎます"))).toBe(true);
  });
});

describe("checkDecisiveWording", () => {
  it("判断しない旨の言い回しを指摘し、行動の言葉は通す", () => {
    for (const text of ["まだ判断できません", "判断を保留します", "原因は分かりません"]) {
      expect(checkDecisiveWording("headline", text, "ja")).toHaveLength(1);
    }
    for (const text of ["Too early to decide.", "Can't judge yet", "Holding off for now."]) {
      expect(checkDecisiveWording("headline", text, "en")).toHaveLength(1);
    }
    expect(checkDecisiveWording("headline", "21時05分までに動かなければ切り替える", "ja")).toEqual(
      [],
    );
    expect(
      checkDecisiveWording("headline", "Wait until 21:05. Switch if still stopped.", "en"),
    ).toEqual([]);
  });

  it("判断の検証でも指摘する", async () => {
    const { session, results, signalId } = await prepareSession();
    const judgment = assembleJudgment(
      results,
      {
        action: "hold",
        headline: "まだ判断できません",
        reason: "理由",
        breakEvenExplanation: "説明",
        recommendedOptionId: null,
        evidence: [{ kind: "signal", id: signalId, description: "根拠" }],
      },
      "ja",
    );
    const { judgment: valid, errors } = session.checkJudgment(judgment, results);
    expect(valid).toBeNull();
    expect(errors.some((e) => e.includes("判断しない旨"))).toBe(true);
  });
});

describe("checkSectionWording", () => {
  const none = { announcedSection: null, trainPosition: null };
  const between = {
    announcedSection: null,
    trainPosition: { previousStation: "大阪", nextStation: "塚本" },
  };
  const announced = {
    announcedSection: { fromStation: "大阪", toStation: "三ノ宮" },
    trainPosition: null,
  };
  const check = (text: string, context: SectionWordingContext, language: "ja" | "en" = "ja") =>
    checkSectionWording("reason", text, language, context);

  it("発表に無い駅の範囲を、記号でも言葉でも空白入りでも指摘する", () => {
    for (const text of [
      "大阪〜京都で見合わせています。",
      "大阪駅〜三ノ宮駅間は止まっています。",
      "大阪 〜 京都で見合わせています。",
      "大阪－京都は止まっています。",
      "大阪から京都まで運転を見合わせています。",
      "大阪から京都の間は不通です。",
      "大阪・京都間で見合わせています。",
      "大阪と京都の間で運転を見合わせています。",
    ]) {
      expect(check(text, none), text).toHaveLength(1);
    }
  });

  it("「の間」でも、利用者のいる 2 駅の位置を言う文でなければ指摘する", () => {
    // 駅の間にいない人
    expect(check("大阪〜京都の間で運転見合わせです。", none)).toHaveLength(1);
    // 別の駅の間
    expect(check("大阪〜京都の間で止まっています。", between)).toHaveLength(1);
    // 利用者のいる 2 駅でも、見合わせの区間として言えば指摘する
    expect(check("大阪〜塚本の間で運転を見合わせています。", between)).toHaveLength(1);
    // 利用者のいる 2 駅の位置を言う文は通す。向きが逆でも通す
    expect(check("大阪〜塚本の間で止まっています。", between)).toEqual([]);
    expect(check("塚本と大阪の間で列車が止まっています。", between)).toEqual([]);
  });

  it("発表の区間は通し、発表と違う範囲は指摘する", () => {
    expect(check("大阪〜三ノ宮で見合わせています。", announced)).toEqual([]);
    expect(check("大阪から三ノ宮まで運転を見合わせています。", announced)).toEqual([]);
    expect(check("大阪〜京都で見合わせています。", announced)).toHaveLength(1);
  });

  it("時刻や分の幅と、経路の道順は区間とみなさない", () => {
    for (const text of [
      "再開見込みは21時40分〜22時10分ごろです。",
      "多くの場合5〜10分で終わります。",
      "大阪から歩いて大阪梅田へ向かいます。",
      "大阪梅田から神戸三宮まで阪急神戸線で行けます。",
    ]) {
      expect(check(text, none), text).toEqual([]);
    }
  });

  it("英語でも、発表に区間が無ければ駅の範囲を指摘する", () => {
    expect(check("Osaka–Kyoto is suspended.", none, "en")).toHaveLength(1);
    expect(check("Service is suspended from Osaka to Kyoto.", none, "en")).toHaveLength(1);
    expect(check("Restart is likely 21:40–22:10.", none, "en")).toEqual([]);
    expect(check("Walk from Osaka to Osaka-umeda.", none, "en")).toEqual([]);
  });
});

describe("利用者に見せる文の言い回しの検査", () => {
  it("流れの言い方と発表に無い区間を、同じ文の集まりに順にかけ、同じ指摘は 1 度だけ返す", async () => {
    const { session, results, signalId } = await prepareSession();
    const evidence = { kind: "signal" as const, id: signalId, description: "大阪〜京都で見合わせ" };
    const judgment = assembleJudgment(
      results,
      {
        action: "hold",
        headline: "待つ",
        reason: "よくある流れです。大阪〜京都で見合わせています。",
        breakEvenExplanation: "説明",
        recommendedOptionId: null,
        evidence: [evidence, evidence, { kind: "signal", id: "unknown_signal", description: "x" }],
      },
      "ja",
    );
    // 存在しない根拠を 2 度並べ、同じ指摘が重なる場面を作る
    const doubled = {
      ...judgment,
      evidence: [...judgment.evidence, judgment.evidence.at(-1)],
    };
    const { judgment: valid, errors } = session.checkJudgment(doubled, results);
    expect(valid).toBeNull();
    expect(errors.some((e) => e.startsWith("reason の「よくある流れ」"))).toBe(true);
    expect(errors.some((e) => e.includes("reason の「大阪〜京都」は止まっている区間"))).toBe(true);
    expect(errors.some((e) => e.includes("evidence[0].description の「大阪〜京都」"))).toBe(true);
    expect(new Set(errors).size).toBe(errors.length);
  });
});

describe("checkReasonLength", () => {
  it("上限ちょうどは通し、超えたら指摘する", () => {
    for (const language of ["ja", "en"] as const) {
      const { max } = reasonLimits[language];
      expect(checkReasonLength("あ".repeat(max), language)).toEqual([]);
      expect(checkReasonLength("あ".repeat(max + 1), language)).toHaveLength(1);
    }
  });

  it("長すぎる理由は判断の検証でも指摘する", async () => {
    const { session, results, signalId } = await prepareSession();
    const judgment = assembleJudgment(
      results,
      {
        action: "hold",
        headline: "様子を見ましょう",
        reason: "あ".repeat(reasonLimits.ja.max + 1),
        breakEvenExplanation: "説明",
        recommendedOptionId: null,
        evidence: [{ kind: "signal", id: signalId, description: "根拠" }],
      },
      "ja",
    );
    const { judgment: valid, errors } = session.checkJudgment(judgment, results);
    expect(valid).toBeNull();
    expect(errors.some((e) => e.startsWith("reason が長すぎます"))).toBe(true);
  });
});

describe("extractTextNumbers", () => {
  it("時刻の中の分を分の数値として二重に拾わない", () => {
    const n = extractTextNumbers(
      "23時16分までに再開しなければ、徒歩12分の経路が早い。2時間5分かかる。8時ごろ",
    );
    expect(n.clocks.map((c) => c.minuteOfDay)).toEqual([23 * 60 + 16]);
    expect(n.minutes.map((m) => m.value)).toEqual([125, 12]);
    expect(n.hours.map((h) => h.hour)).toEqual([8]);
  });

  it("間に語が入る英語の分も分の数値として拾う", () => {
    const n = extractTextNumbers(
      "Wait 25 more minutes, or 10 min on foot. Another 5 minutes, then 3 additional mins and 7 extra minutes.",
    );
    expect(n.minutes.map((m) => m.value)).toEqual([25, 10, 5, 3, 7]);
  });
});
