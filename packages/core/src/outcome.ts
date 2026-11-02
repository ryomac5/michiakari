import type { Action } from "@repo/schema";
import { checkDeadline, type DeadlineCheck } from "./break-even.ts";
import { addMinutesToIso, formatJstIso, parseIsoToMs } from "./time.ts";

// リプレイの結末: 判断に従った人と待ち続けた人の到着時刻を、実際の再開時刻で比べる
// 値はリプレイ中に記録した判断のものだけを使い、新しい推定はしない

const MS_PER_MINUTE = 60_000;
// この分未満の差は「ほぼ同じ」とみなす
export const OUTCOME_SMALL_DIFF_MINUTES = 5;

// 観測 1 件ごとの判断の記録
export type ReplayDecision = {
  observedAt: string;
  action: Action;
  // 推奨した選択肢の到着時刻。推奨が無ければ null
  recommendedArrival: string | null;
  // 待つ選択肢の、再開後に乗ってから着くまでの分。経路を引けなければ null
  waitRideMinutesAfterResume: number | null;
  // 代替手段のうち最も早い到着。代替手段が無ければ null
  bestAlternativeArrival?: string | null;
};

export type ReplayOutcomeInput = {
  decisions: readonly ReplayDecision[];
  // ground_truth.resume_offset_minutes。正解が無ければ null
  resumeOffsetMinutes: number | null;
  startTime: string;
  firstTrainWaitMinutes: number;
  deadline: string | null;
};

// followed_earlier: 従った人が早い。waited_earlier: 待った人が早い
// about_same: 差が小さい。never_switched: 最後まで切り替えの判断が出なかった
export type ReplayOutcomeVerdict =
  | "followed_earlier"
  | "waited_earlier"
  | "about_same"
  | "never_switched";

export type ReplayOutcome = {
  resumedAt: string;
  // 判断に従って切り替えた時刻。切り替えなければ null
  switchedAt: string | null;
  followedArrival: string;
  waitedArrival: string;
  // 待ち続けた人の到着 − 判断に従った人の到着（分）。正なら従った人が早い
  diffMinutes: number;
  // 期限が無ければ null
  followedDeadline: DeadlineCheck | null;
  waitedDeadline: DeadlineCheck | null;
  // 最後まで待つ判断だった場合に、最初の判断の時点で切り替えていたときの到着
  firstAlternativeArrival: string | null;
  // 待ち続けた人の到着 − 最初の時点で切り替えた場合の到着（分）。比べられなければ null
  alternativeDiffMinutes: number | null;
  verdict: ReplayOutcomeVerdict;
};

function diffRoundedMinutes(fromIso: string, toIso: string): number {
  return Math.round((parseIsoToMs(toIso) - parseIsoToMs(fromIso)) / MS_PER_MINUTE);
}

// 再開後の乗車分は、実際の再開時刻以前で最後の判断の値を使う。無ければ最初に得られた値
function pickWaitRideMinutes(
  decisions: readonly ReplayDecision[],
  resumedMs: number,
): number | null {
  const known = decisions.filter((d) => d.waitRideMinutesAfterResume !== null);
  const beforeResume = known.filter((d) => parseIsoToMs(d.observedAt) <= resumedMs);
  return (beforeResume.at(-1) ?? known[0])?.waitRideMinutesAfterResume ?? null;
}

// 最初に switch が出た判断。再開した後の判断は、従った人がすでに乗れているので数えない
function findFirstSwitch(
  decisions: readonly ReplayDecision[],
  resumedMs: number,
): (ReplayDecision & { recommendedArrival: string }) | null {
  for (const d of decisions) {
    if (parseIsoToMs(d.observedAt) >= resumedMs) break;
    if (d.action === "switch" && d.recommendedArrival !== null) {
      return { ...d, recommendedArrival: d.recommendedArrival };
    }
  }
  return null;
}

function selectVerdict(switched: boolean, diffMinutes: number): ReplayOutcomeVerdict {
  if (!switched) return "never_switched";
  if (Math.abs(diffMinutes) < OUTCOME_SMALL_DIFF_MINUTES) return "about_same";
  return diffMinutes > 0 ? "followed_earlier" : "waited_earlier";
}

// 結末を求める。正解が無い、または再開後の乗車分が記録に無いときは null
export function compareReplayOutcome(input: ReplayOutcomeInput): ReplayOutcome | null {
  if (input.resumeOffsetMinutes === null) return null;
  if (!Number.isFinite(input.firstTrainWaitMinutes) || input.firstTrainWaitMinutes < 0) {
    throw new RangeError(`初列車待ちは 0 以上の有限値: ${input.firstTrainWaitMinutes}`);
  }
  const decisions = [...input.decisions].sort(
    (a, b) => parseIsoToMs(a.observedAt) - parseIsoToMs(b.observedAt),
  );
  const resumedAt = addMinutesToIso(input.startTime, input.resumeOffsetMinutes);
  const resumedMs = parseIsoToMs(resumedAt);
  const rideMinutes = pickWaitRideMinutes(decisions, resumedMs);
  if (rideMinutes === null) return null;

  const waitedArrival = addMinutesToIso(resumedAt, input.firstTrainWaitMinutes + rideMinutes);
  const firstSwitch = findFirstSwitch(decisions, resumedMs);
  const followedArrival = firstSwitch
    ? formatJstIso(parseIsoToMs(firstSwitch.recommendedArrival))
    : waitedArrival;
  const diffMinutes = diffRoundedMinutes(followedArrival, waitedArrival);
  const firstAlternative = decisions[0]?.bestAlternativeArrival ?? null;

  return {
    resumedAt,
    switchedAt: firstSwitch ? formatJstIso(parseIsoToMs(firstSwitch.observedAt)) : null,
    followedArrival,
    waitedArrival,
    diffMinutes,
    followedDeadline:
      input.deadline === null ? null : checkDeadline(followedArrival, input.deadline),
    waitedDeadline: input.deadline === null ? null : checkDeadline(waitedArrival, input.deadline),
    firstAlternativeArrival: firstAlternative ? formatJstIso(parseIsoToMs(firstAlternative)) : null,
    alternativeDiffMinutes: firstAlternative
      ? diffRoundedMinutes(waitedArrival, firstAlternative)
      : null,
    verdict: selectVerdict(firstSwitch !== null, diffMinutes),
  };
}
