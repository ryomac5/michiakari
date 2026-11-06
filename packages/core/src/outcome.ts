import type { Action } from "@repo/schema";
import { checkDeadline, type DeadlineCheck } from "./break-even.ts";
import { addMinutesToIso, formatJstIso, parseIsoToMs } from "./time.ts";

// リプレイの結末: 判断に従った人と、その判断と逆を選んだ人の到着時刻を、実際の再開時刻で比べる
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

// 結末に並べる 1 人分
export type OutcomeTraveler = {
  // 切り替えた時刻。再開を待って乗ったなら null
  switchedAt: string | null;
  arrival: string;
  // 期限が無ければ null
  deadline: DeadlineCheck | null;
};

// followed_earlier: 従った人が早い。counterpart_earlier: 比べる相手が早い。about_same: 差が小さい
export type ReplayOutcomeVerdict = "followed_earlier" | "counterpart_earlier" | "about_same";

export type ReplayOutcome = {
  resumedAt: string;
  // 判断に従った人。切り替えの判断があれば、最初に切り替えを勧めた時点で移った人
  followed: OutcomeTraveler;
  // 比べる相手。切り替えた判断なら待ち続けた人、最後まで待つ判断なら最初の観測で切り替えた人
  // 待つ判断で代替手段が無ければ待ち続けた人とし、従った人と同じ時刻に着く
  counterpart: OutcomeTraveler;
  // 相手の到着 − 従った人の到着（分）。正なら従った人が早い
  diffMinutes: number;
  verdict: ReplayOutcomeVerdict;
};

type SwitchPoint = { observedAt: string; arrival: string };

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

// 最初に切り替えを勧めた時点。従った人は、その判断のおすすめの経路に乗る
// 後で待つの判断が出ても、すでに移った人は戻らない。再開した後の判断は、すでに乗れているので数えない
function findFirstSwitch(
  decisions: readonly ReplayDecision[],
  resumedMs: number,
): SwitchPoint | null {
  for (const d of decisions) {
    if (parseIsoToMs(d.observedAt) >= resumedMs) break;
    if (d.action === "switch" && d.recommendedArrival !== null) {
      return { observedAt: d.observedAt, arrival: d.recommendedArrival };
    }
  }
  return null;
}

// 最初の観測で、最も早い代替手段へ切り替えた場合。代替手段が無ければ null
// 結末のカードで待った人と比べる相手はこの人とする。比べ方は開発者が確かめた
function findSwitchAtStart(decisions: readonly ReplayDecision[]): SwitchPoint | null {
  const first = decisions[0];
  if (!first?.bestAlternativeArrival) return null;
  return { observedAt: first.observedAt, arrival: first.bestAlternativeArrival };
}

function selectVerdict(diffMinutes: number): ReplayOutcomeVerdict {
  if (Math.abs(diffMinutes) < OUTCOME_SMALL_DIFF_MINUTES) return "about_same";
  return diffMinutes > 0 ? "followed_earlier" : "counterpart_earlier";
}

function buildTraveler(
  switchedAt: string | null,
  arrival: string,
  deadline: string | null,
): OutcomeTraveler {
  const normalized = formatJstIso(parseIsoToMs(arrival));
  return {
    switchedAt: switchedAt === null ? null : formatJstIso(parseIsoToMs(switchedAt)),
    arrival: normalized,
    deadline: deadline === null ? null : checkDeadline(normalized, deadline),
  };
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

  const waited = buildTraveler(
    null,
    addMinutesToIso(resumedAt, input.firstTrainWaitMinutes + rideMinutes),
    input.deadline,
  );
  // 切り替えた判断なら待ち続けた人と比べ、最後まで待つ判断なら最初に切り替えた人と比べる
  const switchTurn = findFirstSwitch(decisions, resumedMs);
  const switchAtStart = switchTurn ? null : findSwitchAtStart(decisions);
  const followed = switchTurn
    ? buildTraveler(switchTurn.observedAt, switchTurn.arrival, input.deadline)
    : waited;
  const counterpart = switchAtStart
    ? buildTraveler(switchAtStart.observedAt, switchAtStart.arrival, input.deadline)
    : waited;
  const diffMinutes = diffRoundedMinutes(followed.arrival, counterpart.arrival);

  return { resumedAt, followed, counterpart, diffMinutes, verdict: selectVerdict(diffMinutes) };
}
