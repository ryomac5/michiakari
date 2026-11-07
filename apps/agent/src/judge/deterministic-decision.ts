import { computeLateShare, selectKeyTick } from "@repo/core";
import type { Action } from "@repo/schema";
import { decisionParams } from "../config.ts";
import type { Decision } from "../tools/emit-judgment.ts";
import type { BreakEvenToolResult, EstimateToolResult, WeatherToolResult } from "../tools/types.ts";
import type { JudgmentToolResults } from "./assemble.ts";
import { buildTrainQueueText, checkInCarBetweenStations } from "./in-car.ts";
import { buildComputedBreakEven, type JudgeSession } from "./session.ts";
import {
  buildDecisionText,
  buildInCarDecisionText,
  buildNoAlternativeSentence,
  type ChanceTextInput,
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
  weather: WeatherToolResult | null;
};

// 保留の代わりに切り替えを言い切るか。原因が分からないときと確信度が低いときの保留の前に確かめる
// 分岐点までまだ時間があれば、次の発表を待てるので保留を保つ
// 見込みの立てやすい事象は、時間の窓を待たずに確かめる（ignoreWindow）
function decideSwitchInsteadOfHold(
  r: BreakEvenToolResult["result"],
  ignoreWindow = false,
): DecisionReason | null {
  if (r.kind !== "future" || r.resumeOutlook === null) return null;
  if (!ignoreWindow && r.minutesFromNow > decisionParams.holdDecisionWindowMinutes) return null;
  // p50 が分岐点より後なら、p80 まで含めて見込みの幅のすべてが分岐点より後
  if (r.resumeOutlook.marginP50Minutes < 0) return "resume_after_break_even";
  if (computeLateShare(r.resumeOutlook) >= decisionParams.lateShareToSwitch) {
    return "resume_mostly_after_break_even";
  }
  return null;
}

// 待つと期限に間に合わず、代替手段なら間に合うか
function checkDeadlineRisk(breakEven: BreakEvenToolResult, bestAlternativeId: string): boolean {
  const waitRow = breakEven.comparison.find((c) => c.scenario === "wait_p50");
  const bestRow = breakEven.comparison.find((c) => c.optionId === bestAlternativeId);
  return waitRow?.deadline?.onTime === false && bestRow?.deadline?.onTime === true;
}

// 原因が分からなくても、発表の再開見込みがあれば、その時刻と分岐点を比べて待つか切り替えるかを言い切る
// 見込みは発表の時刻どおりを p50、延びる余地を p80 とする。保留にはしない
function decideByStatedResume(
  input: RuleInput,
  r: Extract<BreakEvenToolResult["result"], { kind: "future" | "passed" }>,
): RuleOutcome {
  const switchTo = { recommendedOptionId: r.bestAlternativeId };
  const outlook = r.resumeOutlook;
  if (outlook) {
    if (input.estimate.statedExtended && outlook.marginP80Minutes < 0) {
      return { action: "switch", reason: "estimate_extended", ...switchTo };
    }
    if (outlook.marginP50Minutes < -decisionParams.switchMarginMinutes) {
      return { action: "switch", reason: "stated_resume_after_break_even", ...switchTo };
    }
  }
  if (checkDeadlineRisk(input.breakEven, r.bestAlternativeId)) {
    return { action: "switch", reason: "deadline_risk", ...switchTo };
  }
  return {
    action: "wait",
    reason: "stated_resume_before_break_even",
    recommendedOptionId: input.alternatives.waitOptionId,
  };
}

// 再開後に先の列車が詰まり、次の駅で降りて乗り換える価値があれば、待つ・保留の代わりに切り替える
// 次の駅まで行かせることが優先されるので、いま乗っていなければ駅にいる人が乗り換える形になる
function applyResumeQueueRule(input: RuleInput, outcome: RuleOutcome): RuleOutcome {
  const r = input.breakEven.result;
  if (outcome.action === "switch" || !input.estimate.resumeQueue?.worthAlightingAtNextStation)
    return outcome;
  if (r.kind !== "future" && r.kind !== "passed") return outcome;
  return {
    action: "switch",
    reason: "queue_after_resume",
    recommendedOptionId: r.bestAlternativeId,
  };
}

// 規則を当てはめ、最後に再開後の詰まりを見る
export function applyDecisionRules(input: RuleInput): RuleOutcome {
  return applyResumeQueueRule(input, applyIncidentRules(input));
}

// 規則は上から順に当てはめる
function applyIncidentRules(input: RuleInput): RuleOutcome {
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
    // 発表の再開見込みがあるときは、その時刻を見込みとして分岐点と比べる
    if (estimate.remainingBasis === "stated") {
      if (r.kind === "future") return decideByStatedResume(input, r);
      return {
        action: "wait",
        reason: "no_alternative",
        recommendedOptionId: input.alternatives.waitOptionId,
      };
    }
    // 原因の統計値から見込みが出ていれば、境目が迫って見込みが後に寄っているときだけ切り替える
    // 統計値は段階が分からず長引いた事例に偏るので、それ以外は知見が無いときと同じく保留する
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
  // 天気の事象で雨が続くあいだは、代替経路も同じ雨の影響を受けやすい
  if (estimate.weatherIncident && input.weather?.summary.rainContinuing === true) {
    return { action: "hold", reason: "rain_continuing", recommendedOptionId: null };
  }
  // 規則表で長く止まる種類は、発生直後から言い切る。統計値の再開の見込みが分岐点より後なら、時間の窓を待たずに切り替える
  // 発表された見込みがあるときは、下の規則で発表の時刻と比べる
  if (checkLongIncident(estimate) && estimate.remainingBasis === "statistics") {
    const late = decideSwitchInsteadOfHold(r, true);
    if (late) return { action: "switch", reason: late, ...switchTo };
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
  if (checkDeadlineRisk(breakEven, r.bestAlternativeId)) {
    return { action: "switch", reason: "deadline_risk", ...switchTo };
  }
  return {
    action: "wait",
    reason: "resume_before_break_even",
    recommendedOptionId: input.alternatives.waitOptionId,
  };
}

// 規則表で長く止まる種類か。とても長いものも含む
function checkLongIncident(estimate: EstimateToolResult): boolean {
  return estimate.flowOutlook === "long" || estimate.flowOutlook === "very_long";
}

// 規則表の、短く終わるか長くかかるかの区別。見出しの言い方を選ぶのに使う。分からなければ null
function buildFlowText(estimate: EstimateToolResult): DecisionTextInput["flow"] {
  if (estimate.flowOutlook === "short") return { outlook: "short" };
  return checkLongIncident(estimate) ? { outlook: "long" } : null;
}

// 理由と同じ比較時点の確率を添える。期限の判断では早着より期限内到着を優先する
export function buildChanceText(
  breakEven: BreakEvenToolResult,
  reason: DecisionReason,
): ChanceTextInput | null {
  const chance = breakEven.resumeChance ?? null;
  if (!chance) return null;
  const r = breakEven.result;
  const hasBreakEven = r.kind === "future" || r.kind === "passed";
  const laterOutlook =
    reason === "resume_mostly_after_break_even" ||
    (reason === "estimate_extended" && chance.waitFaster !== null);
  const key = selectKeyTick(chance.ticks, laterOutlook && hasBreakEven ? r.time : undefined);
  return {
    laterOutlook,
    comparisonTime: hasBreakEven ? r.time : null,
    deadlineResumeTime: chance.resumeByForDeadline,
    waitFaster: reason === "deadline_risk" || laterOutlook ? null : chance.waitFaster,
    waitOnTime: laterOutlook ? null : chance.waitOnTime,
    keyTick: key ? { time: key.time, tenths: key.tenths } : null,
  };
}

export function decideDeterministically(
  session: JudgeSession,
  results: JudgmentToolResults,
): Decision {
  const language = session.ctx.request.language;
  // 駅間の車内では、結論は車内で待つだけにする。境目の比較で切り替えを勧めない。次の駅が分からなくても同じ
  if (checkInCarBetweenStations(session.ctx.request)) {
    const text = buildInCarDecisionText({
      language,
      queue: buildTrainQueueText(results.estimate),
      worthAlighting: results.estimate.resumeQueue?.worthAlightingAtNextStation === true,
    });
    return {
      action: "wait",
      headline: text.headline,
      reason: text.reason,
      breakEvenExplanation: buildNoAlternativeSentence(language),
      recommendedOptionId: null,
      evidence: session.collectEvidenceRefs(),
    };
  }
  const outcome = applyDecisionRules({ ...results, weather: session.state.weather });
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
    deadlineBasis: hasBreakEven ? (r.deadlineBasis ?? null) : null,
    bestOption,
    flow: buildFlowText(results.estimate),
    // 詰まりで切り替えるときは、待つほうが早い確率が理由と食い違うので添えない
    chance:
      outcome.reason === "queue_after_resume"
        ? null
        : buildChanceText(results.breakEven, outcome.reason),
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
