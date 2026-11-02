import {
  compareReplayOutcome,
  OUTCOME_SMALL_DIFF_MINUTES,
  type ReplayDecision,
  type ReplayOutcome,
} from "@repo/core";
import { type Judgment, resolveDeadline } from "@repo/schema";
import { findCatalogEvent, type KnowledgeCatalog } from "@/features/knowledge/catalog";
import type { ReplayScenario } from "./scenario";

// リプレイの結末に使う値を、agent から受け取った判断だけで組み立てる

export type ReplayDecisionRecord = ReplayDecision & { eventType: string | null };

function findEarliestArrival(options: Judgment["options"]): string | null {
  let best: string | null = null;
  for (const o of options) {
    if (best === null || Date.parse(o.arrivalTime) < Date.parse(best)) best = o.arrivalTime;
  }
  return best;
}

// 待つ選択肢の再開後の乗車分 = 待つ区間以外の区間の和。経路を引けず乗車の区間が無ければ null
function sumWaitRideMinutes(judgment: Judgment): number | null {
  const wait = judgment.options.find((o) => o.kind === "wait");
  const legs = wait?.legs.filter((l) => l.mode !== "wait") ?? [];
  if (legs.length === 0) return null;
  return legs.reduce((total, l) => total + l.minutes, 0);
}

// 観測 1 件の判断を、結末の計算に渡す記録にする
export function buildReplayDecision(judgment: Judgment, observedAt: string): ReplayDecisionRecord {
  const recommended = judgment.options.find((o) => o.id === judgment.recommendedOptionId);
  return {
    observedAt,
    action: judgment.action,
    recommendedArrival: recommended?.arrivalTime ?? null,
    waitRideMinutesAfterResume: sumWaitRideMinutes(judgment),
    bestAlternativeArrival: findEarliestArrival(judgment.options.filter((o) => o.kind !== "wait")),
    eventType: judgment.estimate.eventType,
  };
}

// 初列車待ちは、判断が特定した事象の知見から取る。分岐点の図と同じ求め方
function resolveFirstTrainWait(
  decisions: readonly ReplayDecisionRecord[],
  catalog: KnowledgeCatalog,
): number {
  const eventType = decisions.findLast((d) => d.eventType !== null)?.eventType ?? null;
  return findCatalogEvent(catalog, eventType)?.firstTrainWaitMinutes ?? 0;
}

// 結末を求める。正解が無いシナリオや、判断が一つも無いときは null
export function selectReplayOutcome(
  scenario: ReplayScenario,
  decisions: readonly ReplayDecisionRecord[],
  catalog: KnowledgeCatalog,
): ReplayOutcome | null {
  if (decisions.length === 0) return null;
  const deadline = scenario.user.constraints.deadline;
  return compareReplayOutcome({
    decisions,
    resumeOffsetMinutes: scenario.resumeOffsetMinutes,
    startTime: scenario.start_time,
    firstTrainWaitMinutes: resolveFirstTrainWait(decisions, catalog),
    deadline: deadline ? resolveDeadline(scenario.start_time, deadline) : null,
  });
}

export type OutcomeSummaryKey =
  | "followedEarlierMadeIt"
  | "followedEarlier"
  | "waitedEarlier"
  | "aboutSame"
  | "waitWon"
  | "switchWouldWin"
  | "neverSwitched";

export type OutcomeDeadlineKey =
  | "both"
  | "followedOnly"
  | "waitedOnly"
  | "neither"
  | "sameOnTime"
  | "sameLate";

export type OutcomeSummary = {
  key: OutcomeSummaryKey;
  minutes: number;
  // 期限が無い、または要約の文に含めたときは null
  deadlineKey: OutcomeDeadlineKey | null;
};

function selectDeadlineKey(outcome: ReplayOutcome): OutcomeDeadlineKey | null {
  const followed = outcome.followedDeadline?.onTime;
  const waited = outcome.waitedDeadline?.onTime;
  if (followed === undefined || waited === undefined) return null;
  if (outcome.verdict === "never_switched") return followed ? "sameOnTime" : "sameLate";
  if (followed && waited) return "both";
  if (followed) return "followedOnly";
  return waited ? "waitedOnly" : "neither";
}

// 結末の一行の要約に使う文言の種類と分を選ぶ
export function selectOutcomeSummary(outcome: ReplayOutcome): OutcomeSummary {
  const deadlineKey = selectDeadlineKey(outcome);
  const minutes = Math.abs(outcome.diffMinutes);
  switch (outcome.verdict) {
    case "followed_earlier":
      return deadlineKey === "followedOnly"
        ? { key: "followedEarlierMadeIt", minutes, deadlineKey: null }
        : { key: "followedEarlier", minutes, deadlineKey };
    case "waited_earlier":
      return { key: "waitedEarlier", minutes, deadlineKey };
    case "about_same":
      return { key: "aboutSame", minutes, deadlineKey };
    case "never_switched": {
      // 正なら待つ判断のほうが、最初の時点で切り替えるより早かった
      const advantage = outcome.alternativeDiffMinutes;
      if (advantage !== null && advantage > 0) {
        return { key: "waitWon", minutes: advantage, deadlineKey };
      }
      if (advantage !== null && -advantage >= OUTCOME_SMALL_DIFF_MINUTES) {
        return { key: "switchWouldWin", minutes: -advantage, deadlineKey };
      }
      return { key: "neverSwitched", minutes: 0, deadlineKey };
    }
  }
}
