import { type BreakEven, BreakEvenSchema, type DurationDist, type RouteOption } from "@repo/schema";
import { formatJstIso, parseIsoToMs } from "./time.ts";

// 分岐点: 「この時刻までに再開しなければ代替手段のほうが早い」境目

const MS_PER_MINUTE = 60_000;

// kind を省いた候補は、タクシー以外の代替（鉄道の乗り継ぎ）として扱う
export type AlternativeArrival = Pick<RouteOption, "id" | "arrivalTime"> &
  Partial<Pick<RouteOption, "kind" | "transferFare">>;

export type BreakEvenInput = {
  now: string;
  // 再開して乗れるまでの残り時間。事象を特定できないときは null
  remaining: DurationDist | null;
  // 再開後に乗ってから目的地に着くまでの分
  waitRouteMinutesAfterResume: number;
  // 運転再開から実際に乗れる列車が来るまでの分（after_resume.first_train_wait_minutes の p50）
  firstTrainWaitMinutes: number;
  // 待つ選択肢を含めない代替手段
  alternatives: readonly AlternativeArrival[];
  // 目的地への到着の期限。タクシーを勧めるかの判定に使う。無ければ省くか null
  deadline?: string | null;
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
      // 期限が理由でタクシーを勧めるときだけ持つ。time を求めた期限
      // このとき time は、待っても期限に間に合う最後の再開の時刻で、タクシーの到着から求めたものではない
      deadlineBasis?: string;
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

// 同着のときの順。振替の対象で追加の運賃がかからないもの、費用が分からないもの、運賃がかかるものの順
const FARE_ORDER = { covered: 0, unknown: 1, fare_required: 2 } as const;

function rankFare(alt: AlternativeArrival): number {
  return FARE_ORDER[alt.transferFare ?? "unknown"];
}

// 到着が最も早い候補を返す。同着なら追加の費用がかからないもの、それも同じなら先に並んだもの
function pickEarliest<T extends AlternativeArrival>(candidates: readonly T[]): T | null {
  let best: T | null = null;
  for (const alt of candidates) {
    if (best === null) {
      best = alt;
      continue;
    }
    const diff = parseIsoToMs(alt.arrivalTime) - parseIsoToMs(best.arrivalTime);
    if (diff < 0 || (diff === 0 && rankFare(alt) < rankFare(best))) best = alt;
  }
  return best;
}

// 勧める代替手段を選んだ理由。分岐点の求め方がこれで変わる
// fastest_rail: 鉄道の代替のうち、到着がいちばん早いもの
// no_rail: 鉄道の代替が無く、タクシーしか無い
// rail_misses_deadline: 鉄道の代替では期限に間に合わず、タクシーなら間に合う
export type AlternativeChoiceReason = "fastest_rail" | "no_rail" | "rail_misses_deadline";

export type AlternativeChoice<T extends AlternativeArrival> = {
  alternative: T;
  reason: AlternativeChoiceReason;
};

// 勧める代替手段を、選んだ理由と一緒に返す。待つ選択肢は渡さない。この決まりは core のここ 1 か所に置く
// 鉄道の代替（タクシー以外。近距離の全区間徒歩を含む）のうち、いちばん早いものを勧める
// タクシーを勧めるのは、鉄道の代替が無いときと、鉄道の代替では期限に間に合わずタクシーなら間に合うときだけ
export function chooseBestAlternative<T extends AlternativeArrival>(
  alternatives: readonly T[],
  deadline: string | null = null,
): AlternativeChoice<T> | null {
  const rail = pickEarliest(alternatives.filter((a) => a.kind !== "taxi"));
  const taxi = pickEarliest(alternatives.filter((a) => a.kind === "taxi"));
  if (rail === null) return taxi === null ? null : { alternative: taxi, reason: "no_rail" };
  if (taxi !== null && deadline !== null) {
    const railMisses = !checkDeadline(rail.arrivalTime, deadline).onTime;
    const taxiMakesIt = checkDeadline(taxi.arrivalTime, deadline).onTime;
    if (railMisses && taxiMakesIt) return { alternative: taxi, reason: "rail_misses_deadline" };
  }
  return { alternative: rail, reason: "fastest_rail" };
}

export function selectBestAlternative<T extends AlternativeArrival>(
  alternatives: readonly T[],
  deadline: string | null = null,
): T | null {
  return chooseBestAlternative(alternatives, deadline)?.alternative ?? null;
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

// 駅間の車内で乗ったまま待つ場合の到着時刻
// 降りる駅に着く見込みと、再開して前の列車が発車した見込みの遅いほうから、残りの経路を乗る
export function computeInCarWaitArrival(input: {
  now: string;
  remainingMinutes: number;
  extraWaitMinutes: number;
  // 降りる駅に着く見込みの時刻
  alightArrival: string;
  // 降りる駅から行き先までの乗車時間
  routeMinutes: number;
}): string {
  assertNonNegativeMinutes(input.remainingMinutes, "残り時間");
  assertNonNegativeMinutes(input.extraWaitMinutes, "前の列車の発車を待つ時間");
  assertNonNegativeMinutes(input.routeMinutes, "再開後の乗車時間");
  const resumed =
    parseIsoToMs(input.now) + (input.remainingMinutes + input.extraWaitMinutes) * MS_PER_MINUTE;
  const start = Math.max(parseIsoToMs(input.alightArrival), resumed);
  return formatJstIso(start + input.routeMinutes * MS_PER_MINUTE);
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

// 再開見込みの幅（p50〜p80）のうち分岐点より後にある割合（0〜1）
// p50 が分岐点より後なら 1、p80 が分岐点より前なら 0。幅が無いときは p50 で決める
export function computeLateShare(
  outlook: Pick<ResumeOutlook, "marginP50Minutes" | "marginP80Minutes">,
): number {
  const { marginP50Minutes: m50, marginP80Minutes: m80 } = outlook;
  if (m50 < 0) return 1;
  if (m80 >= 0) return 0;
  return -m80 / (m50 - m80);
}

// 境目 = 勧める代替手段の到着 − 再開後の乗車時間 − 初列車待ち（運転再開の期限）
// 期限が理由でタクシーを勧めるときは、タクシーの到着ではなく期限を使う。知りたいのは「タクシーより早いか」ではなく
// 「待っても期限に間に合うか」なので、境目は待っても期限に間に合う最後の再開の時刻になる
export function computeBreakEven(input: BreakEvenInput): BreakEvenResult {
  assertNonNegativeMinutes(input.waitRouteMinutesAfterResume, "再開後の乗車時間");
  assertNonNegativeMinutes(input.firstTrainWaitMinutes, "初列車待ち");
  const nowMs = parseIsoToMs(input.now);
  const choice = chooseBestAlternative(input.alternatives, input.deadline ?? null);
  if (choice === null) return { kind: "no_alternative" };
  const best = choice.alternative;
  const deadlineBasis = choice.reason === "rail_misses_deadline" ? (input.deadline ?? null) : null;

  const breakEvenMs =
    parseIsoToMs(deadlineBasis ?? best.arrivalTime) -
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
    ...(deadlineBasis === null ? {} : { deadlineBasis: formatJstIso(parseIsoToMs(deadlineBasis)) }),
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
