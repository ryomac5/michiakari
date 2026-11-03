import { computeLateShare } from "@repo/core";
import type { Action, Knowledge } from "@repo/schema";
import { decisionParams } from "../config.ts";
import type { Decision } from "../tools/emit-judgment.ts";
import type { BreakEvenToolResult, EstimateToolResult, WeatherToolResult } from "../tools/types.ts";
import type { JudgmentToolResults } from "./assemble.ts";
import { buildComputedBreakEven, type JudgeSession } from "./session.ts";
import {
  buildDecisionText,
  buildNoAlternativeSentence,
  type DecisionReason,
  type DecisionTextInput,
} from "./templates.ts";

// 決定論モードの判断規則。API キーが無いときと Claude の失敗時に使う

export type RuleOutcome = {
  action: Action;
  reason: DecisionReason;
  recommendedOptionId: string | null;
};

export type RuleInput = JudgmentToolResults & {
  knowledge: Knowledge | null;
  weather: WeatherToolResult | null;
};

// 保留の代わりに切り替えを言い切るか。原因が分からないときと確信度が低いときの保留の前に確かめる
// 分岐点までまだ時間があれば、次の発表を待てるので保留を保つ
function decideSwitchInsteadOfHold(r: BreakEvenToolResult["result"]): DecisionReason | null {
  if (r.kind !== "future" || r.resumeOutlook === null) return null;
  if (r.minutesFromNow > decisionParams.holdDecisionWindowMinutes) return null;
  // p50 が分岐点より後なら、p80 まで含めて見込みの幅のすべてが分岐点より後
  if (r.resumeOutlook.marginP50Minutes < 0) return "resume_after_break_even";
  if (computeLateShare(r.resumeOutlook) >= decisionParams.lateShareToSwitch) {
    return "resume_mostly_after_break_even";
  }
  return null;
}

// 規則は上から順に当てはめる
export function applyDecisionRules(input: RuleInput): RuleOutcome {
  const { estimate, breakEven } = input;
  const r = breakEven.result;
  // 原因が分からなくても、分岐点を過ぎていれば代替手段のほうが早い。事象は決め打ちしない
  if (estimate.estimate.eventType === null) {
    if (r.kind === "passed") {
      return {
        action: "switch",
        reason: "break_even_passed",
        recommendedOptionId: r.bestAlternativeId,
      };
    }
    const late = decideSwitchInsteadOfHold(r);
    if (late && r.kind === "future") {
      return { action: "switch", reason: late, recommendedOptionId: r.bestAlternativeId };
    }
    return { action: "hold", reason: "unknown_event", recommendedOptionId: null };
  }
  if (r.kind === "no_route" || r.kind === "no_alternative") {
    return {
      action: "wait",
      reason: "no_alternative",
      recommendedOptionId: input.alternatives.waitOptionId,
    };
  }
  const switchTo = { recommendedOptionId: r.bestAlternativeId };
  // 分岐点を過ぎた: いま再開しても代替手段のほうが早い
  if (r.kind === "passed") return { action: "switch", reason: "break_even_passed", ...switchTo };
  // 気象が原因の事象で雨が続くあいだは、代替経路も同じ雨の影響を受けやすい
  if (input.knowledge?.external_factors.weather && input.weather?.summary.rainContinuing === true) {
    return { action: "hold", reason: "rain_continuing", recommendedOptionId: null };
  }
  // 見込みの幅が大きい段階では、分岐点が迫って見込みが後に寄っているときだけ切り替えを言い切る
  // 短く終わり見込みの立てやすい事象は、止まった直後でも保留せず、下の比較で待つか切り替えるかを決める
  if (estimate.estimate.confidence === "low") {
    const late = decideSwitchInsteadOfHold(r);
    if (late) return { action: "switch", reason: late, ...switchTo };
    if (estimate.flowOutlook !== "short") {
      return { action: "hold", reason: "low_confidence", recommendedOptionId: null };
    }
  }
  // 見込み時刻が延長されたあとは、さらに延びる余地を見て p80 で比べる
  if (estimate.statedExtended && r.resumeOutlook && r.resumeOutlook.marginP80Minutes < 0) {
    return { action: "switch", reason: "estimate_extended", ...switchTo };
  }
  // 再開して乗れる見込み（p50）が分岐点より十分に遅い
  if (r.resumeOutlook && r.resumeOutlook.marginP50Minutes < -decisionParams.switchMarginMinutes) {
    return { action: "switch", reason: "resume_after_break_even", ...switchTo };
  }
  // 待つと期限に間に合わず、代替手段なら間に合う
  const waitRow = breakEven.comparison.find((c) => c.scenario === "wait_p50");
  const bestRow = breakEven.comparison.find((c) => c.optionId === r.bestAlternativeId);
  if (waitRow?.deadline?.onTime === false && bestRow?.deadline?.onTime === true) {
    return { action: "switch", reason: "deadline_risk", ...switchTo };
  }
  return {
    action: "wait",
    reason: "resume_before_break_even",
    recommendedOptionId: input.alternatives.waitOptionId,
  };
}

// 流れの一文は、知見から見積もっているときだけ理由に置く。発表の見込みや再開の後は発表を優先する
function buildFlowText(estimate: EstimateToolResult): DecisionTextInput["flow"] {
  if (!estimate.flowOutlook || !estimate.flowSentence) return null;
  return {
    outlook: estimate.flowOutlook,
    sentence: estimate.flowSentence,
    inReason: estimate.remainingBasis === "knowledge",
  };
}

export function decideDeterministically(
  session: JudgeSession,
  results: JudgmentToolResults,
): Decision {
  const language = session.ctx.request.language;
  const eventType = results.estimate.estimate.eventType;
  const outcome = applyDecisionRules({
    ...results,
    knowledge: eventType ? (session.ctx.content.knowledge.get(eventType) ?? null) : null,
    weather: session.state.weather,
  });
  const r = results.breakEven.result;
  const hasBreakEven = r.kind === "future" || r.kind === "passed";
  const bestOption = hasBreakEven
    ? (results.alternatives.options.find((o) => o.id === r.bestAlternativeId) ?? null)
    : null;
  const computed = buildComputedBreakEven(results.breakEven, results.alternatives, language);
  const text = buildDecisionText({
    reason: outcome.reason,
    language,
    breakEvenMinutesFromNow: hasBreakEven ? r.minutesFromNow : null,
    breakEvenTime: hasBreakEven ? r.time : null,
    resumeP50: hasBreakEven ? (r.resumeOutlook?.resumeP50 ?? null) : null,
    resumeP80: hasBreakEven ? (r.resumeOutlook?.resumeP80 ?? null) : null,
    marginP50Minutes: hasBreakEven ? (r.resumeOutlook?.marginP50Minutes ?? null) : null,
    deadline: results.breakEven.deadline,
    bestOption,
    flow: buildFlowText(results.estimate),
  });
  return {
    action: outcome.action,
    headline: text.headline,
    reason: text.reason,
    breakEvenExplanation: computed?.explanation ?? buildNoAlternativeSentence(language),
    recommendedOptionId: outcome.recommendedOptionId,
    evidence: session.collectEvidenceRefs(),
  };
}
