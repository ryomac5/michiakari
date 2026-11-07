import {
  compareReplayOutcome,
  type ReplayDecision,
  type ReplayOutcome,
  selectBestAlternative,
} from "@repo/core";
import { type Judgment, resolveDeadline } from "@repo/schema";
import { estimateFirstTrainWait } from "@/features/judgment/break-even-timeline";
import type { ReplayScenario } from "./scenario";

// リプレイの結末に使う値を、agent から受け取った判断だけで組み立てる

export type ReplayDecisionRecord = ReplayDecision & { eventType: string | null };

// 切り替えた場合に比べる代替手段の到着。分岐点と同じく、core が勧める代替手段の到着を使う
// 鉄道の代替のうちいちばん早いものを勧め、タクシーは鉄道の代替が無いときと期限に間に合わないときだけ
export function findSwitchArrival(
  options: Judgment["options"],
  deadline: string | null,
): string | null {
  const alternatives = options.filter((o) => o.kind !== "wait");
  return selectBestAlternative(alternatives, deadline)?.arrivalTime ?? null;
}

// 待つ選択肢の再開後の乗車分 = 待つ区間以外の区間の和。経路を引けず乗車の区間が無ければ null
function sumWaitRideMinutes(judgment: Judgment): number | null {
  const wait = judgment.options.find((o) => o.kind === "wait");
  const legs = wait?.legs.filter((l) => l.mode !== "wait") ?? [];
  if (legs.length === 0) return null;
  return legs.reduce((total, l) => total + l.minutes, 0);
}

// 観測 1 件の判断を、結末の計算に渡す記録にする。期限は勧める代替手段を選ぶのに使う
export function buildReplayDecision(
  judgment: Judgment,
  observedAt: string,
  deadline: string | null = null,
): ReplayDecisionRecord {
  const recommended = judgment.options.find((o) => o.id === judgment.recommendedOptionId);
  return {
    observedAt,
    action: judgment.action,
    recommendedArrival: recommended?.arrivalTime ?? null,
    waitRideMinutesAfterResume: sumWaitRideMinutes(judgment),
    bestAlternativeArrival: findSwitchArrival(judgment.options, deadline),
    eventType: judgment.estimate.eventType,
  };
}

// 初列車待ちは、判断が特定した事象から分岐点の図と同じく core の規則表で引く
function selectFirstTrainWait(decisions: readonly ReplayDecisionRecord[]): number {
  const eventType = decisions.findLast((d) => d.eventType !== null)?.eventType ?? null;
  return estimateFirstTrainWait(eventType);
}

// 結末を求める。正解が無いシナリオや、判断が一つも無いときは null
export function selectReplayOutcome(
  scenario: ReplayScenario,
  decisions: readonly ReplayDecisionRecord[],
): ReplayOutcome | null {
  if (decisions.length === 0) return null;
  const deadline = scenario.user.constraints.deadline;
  return compareReplayOutcome({
    decisions,
    resumeOffsetMinutes: scenario.resumeOffsetMinutes,
    startTime: scenario.start_time,
    firstTrainWaitMinutes: selectFirstTrainWait(decisions),
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
  | "waitAboutSame"
  | "neverSwitched";

export type OutcomeDeadlineKey =
  | "both"
  | "followedOnly"
  | "waitedOnly"
  | "switchedOnly"
  | "neither"
  | "sameOnTime"
  | "sameLate";

export type OutcomeSummary = {
  key: OutcomeSummaryKey;
  // 並べる 2 人の到着の差。core の diffMinutes の絶対値
  minutes: number;
  // 比べる相手が切り替えた時刻。待ち続けた人と比べるときは null
  counterpartSwitchedAt: string | null;
  // 期限が無い、または要約の文に含めたときは null
  deadlineKey: OutcomeDeadlineKey | null;
};

// 比べる相手が従った人と同じ待ち続けた人か。待つ判断で代替手段が無いとき
function isSameTraveler(outcome: ReplayOutcome): boolean {
  return outcome.followed.switchedAt === null && outcome.counterpart.switchedAt === null;
}

function selectDeadlineKey(outcome: ReplayOutcome): OutcomeDeadlineKey | null {
  const followed = outcome.followed.deadline?.onTime;
  const counterpart = outcome.counterpart.deadline?.onTime;
  if (followed === undefined || counterpart === undefined) return null;
  if (isSameTraveler(outcome)) return followed ? "sameOnTime" : "sameLate";
  if (followed && counterpart) return "both";
  if (followed) return "followedOnly";
  if (!counterpart) return "neither";
  return outcome.counterpart.switchedAt === null ? "waitedOnly" : "switchedOnly";
}

// 判断に従って切り替えた人を、待ち続けた人と比べる文
function selectSwitchSummaryKey(
  outcome: ReplayOutcome,
  deadlineKey: OutcomeDeadlineKey | null,
): OutcomeSummaryKey {
  switch (outcome.verdict) {
    case "followed_earlier":
      return deadlineKey === "followedOnly" ? "followedEarlierMadeIt" : "followedEarlier";
    case "counterpart_earlier":
      return "waitedEarlier";
    case "about_same":
      return "aboutSame";
  }
}

// 待つ判断に従った人を、最初に切り替えた人と比べる文
function selectWaitSummaryKey(outcome: ReplayOutcome): OutcomeSummaryKey {
  switch (outcome.verdict) {
    case "followed_earlier":
      return "waitWon";
    case "counterpart_earlier":
      return "switchWouldWin";
    case "about_same":
      return "waitAboutSame";
  }
}

// 結末の一行の要約に使う文言の種類と分を選ぶ。比べる相手と分は、カードに並べる 2 人と同じ
export function selectOutcomeSummary(outcome: ReplayOutcome): OutcomeSummary {
  const deadlineKey = selectDeadlineKey(outcome);
  const base = {
    minutes: Math.abs(outcome.diffMinutes),
    counterpartSwitchedAt: outcome.counterpart.switchedAt,
  };
  if (isSameTraveler(outcome)) return { ...base, key: "neverSwitched", deadlineKey };
  if (outcome.followed.switchedAt === null) {
    return { ...base, key: selectWaitSummaryKey(outcome), deadlineKey };
  }
  const key = selectSwitchSummaryKey(outcome, deadlineKey);
  return { ...base, key, deadlineKey: key === "followedEarlierMadeIt" ? null : deadlineKey };
}
