import { type BreakEven, BreakEvenSchema, type DurationDist, type RouteOption } from "@repo/schema";
import { formatJstIso, parseIsoToMs } from "./time.ts";

// 分岐点: 「この時刻までに再開しなければ代替手段のほうが早い」境目

const MS_PER_MINUTE = 60_000;

export type AlternativeArrival = Pick<RouteOption, "id" | "arrivalTime">;

export type BreakEvenInput = {
  now: string;
  // 再開して乗れるまでの残り時間。事象を特定できないときは null
  remaining: DurationDist | null;
  // 再開後に乗ってから目的地に着くまでの分
  waitRouteMinutesAfterResume: number;
  // 運転再開から実際に乗れる列車が来るまでの分（after_resume.first_train_wait_minutes の p50）
  firstTrainWaitMinutes: number;
  alternatives: readonly AlternativeArrival[];
};

// 運転再開の見込み時刻と境目の差。margin は 境目 − 再開見込み（分）。正なら待つほうが早い見込み
export type ResumeOutlook = {
  resumeP50: string;
  resumeP80: string;
  marginP50Minutes: number;
  marginP80Minutes: number;
};

export type BreakEvenResult =
  | {
      // future: 境目はまだ先。passed: いま再開しても代替手段のほうが早い
      kind: "future" | "passed";
      // 運転再開の期限
      time: string;
      minutesFromNow: number;
      bestAlternativeId: string;
      bestAlternativeArrival: string;
      resumeOutlook: ResumeOutlook | null;
    }
  | { kind: "no_alternative" };

export type DeadlineCheck = {
  onTime: boolean;
  // 期限 − 到着（分、切り捨て）。負なら遅れる
  marginMinutes: number;
};

function assertNonNegativeMinutes(minutes: number, name: string): void {
  if (!Number.isFinite(minutes) || minutes < 0) {
    throw new RangeError(`${name} は 0 以上の有限値: ${minutes}`);
  }
}

// 到着が最も早い代替手段を返す。同着なら先に並んだもの
export function selectBestAlternative(
  alternatives: readonly AlternativeArrival[],
): AlternativeArrival | null {
  let best: AlternativeArrival | null = null;
  for (const alt of alternatives) {
    if (best === null || parseIsoToMs(alt.arrivalTime) < parseIsoToMs(best.arrivalTime)) {
      best = alt;
    }
  }
  return best;
}

// 待つ場合の到着時刻 = 現在 + 残り時間 + 再開後の乗車時間
export function computeWaitArrival(
  now: string,
  remainingMinutes: number,
  waitRouteMinutesAfterResume: number,
): string {
  assertNonNegativeMinutes(remainingMinutes, "残り時間");
  assertNonNegativeMinutes(waitRouteMinutesAfterResume, "再開後の乗車時間");
  const ms = parseIsoToMs(now) + (remainingMinutes + waitRouteMinutesAfterResume) * MS_PER_MINUTE;
  return formatJstIso(ms);
}

// 再開見込み = 現在 + 残り（乗れるまで）− 初列車待ち。現在より前にはしない
function buildResumeOutlook(
  nowMs: number,
  breakEvenMs: number,
  remaining: DurationDist,
  firstTrainWaitMinutes: number,
): ResumeOutlook {
  const toResumeMs = (minutes: number) =>
    Math.max(nowMs + (minutes - firstTrainWaitMinutes) * MS_PER_MINUTE, nowMs);
  const resumeP50Ms = toResumeMs(remaining.p50);
  const resumeP80Ms = toResumeMs(remaining.p80);
  // 差は乗れる時刻どうしで測る。現在で打ち切る前の 境目 − 再開見込み と同じ値
  const boardingDeadlineMs = breakEvenMs + firstTrainWaitMinutes * MS_PER_MINUTE;
  return {
    resumeP50: formatJstIso(resumeP50Ms),
    resumeP80: formatJstIso(resumeP80Ms),
    marginP50Minutes: Math.round(
      (boardingDeadlineMs - nowMs - remaining.p50 * MS_PER_MINUTE) / MS_PER_MINUTE,
    ),
    marginP80Minutes: Math.round(
      (boardingDeadlineMs - nowMs - remaining.p80 * MS_PER_MINUTE) / MS_PER_MINUTE,
    ),
  };
}

// 境目 = 最良の代替手段の到着 − 再開後の乗車時間 − 初列車待ち（運転再開の期限）
export function computeBreakEven(input: BreakEvenInput): BreakEvenResult {
  assertNonNegativeMinutes(input.waitRouteMinutesAfterResume, "再開後の乗車時間");
  assertNonNegativeMinutes(input.firstTrainWaitMinutes, "初列車待ち");
  const nowMs = parseIsoToMs(input.now);
  const best = selectBestAlternative(input.alternatives);
  if (best === null) return { kind: "no_alternative" };

  const breakEvenMs =
    parseIsoToMs(best.arrivalTime) -
    (input.waitRouteMinutesAfterResume + input.firstTrainWaitMinutes) * MS_PER_MINUTE;
  return {
    kind: breakEvenMs > nowMs ? "future" : "passed",
    time: formatJstIso(breakEvenMs),
    minutesFromNow: Math.round((breakEvenMs - nowMs) / MS_PER_MINUTE),
    bestAlternativeId: best.id,
    bestAlternativeArrival: formatJstIso(parseIsoToMs(best.arrivalTime)),
    resumeOutlook:
      input.remaining === null
        ? null
        : buildResumeOutlook(nowMs, breakEvenMs, input.remaining, input.firstTrainWaitMinutes),
  };
}

// Judgment.breakEven に入れる形に変換する。説明文はエージェントが書く
export function convertToBreakEven(result: BreakEvenResult, explanation: string): BreakEven | null {
  if (result.kind === "no_alternative") return null;
  return BreakEvenSchema.parse({ time: result.time, explanation });
}

// 到着時刻が期限に間に合うか判定する。同時刻は間に合う
export function checkDeadline(arrivalIso: string, deadlineIso: string): DeadlineCheck {
  const diffMs = parseIsoToMs(deadlineIso) - parseIsoToMs(arrivalIso);
  return { onTime: diffMs >= 0, marginMinutes: Math.floor(diffMs / MS_PER_MINUTE) };
}
