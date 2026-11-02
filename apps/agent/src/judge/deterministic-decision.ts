import type { Action, Knowledge } from "@repo/schema";
import { decisionParams } from "../config.ts";
import type { Decision } from "../tools/emit-judgment.ts";
import type { WeatherToolResult } from "../tools/types.ts";
import type { JudgmentToolResults } from "./assemble.ts";
import { buildComputedBreakEven, type JudgeSession } from "./session.ts";
import { buildDecisionText, buildNoAlternativeSentence, type DecisionReason } from "./templates.ts";

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

// 規則は上から順に当てはめる
export function applyDecisionRules(input: RuleInput): RuleOutcome {
  const { estimate, breakEven } = input;
  const r = breakEven.result;
  if (estimate.estimate.eventType === null) {
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
  // 見込みの幅が大きい段階では断言しない
  if (estimate.estimate.confidence === "low") {
    return { action: "hold", reason: "low_confidence", recommendedOptionId: null };
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
