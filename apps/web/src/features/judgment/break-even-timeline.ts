import type { Action, DurationDist, Judgment } from "@repo/schema";

// 分岐点の時間軸の図に使う表示用の値。判断の数値は agent の値をそのまま使い、位置と区間だけを求める

const MS_PER_MINUTE = 60_000;
const JST_OFFSET_MS = 9 * 60 * MS_PER_MINUTE;
// 目盛りの間隔の候補（分）。軸の長さに対して目盛りが多くなりすぎない最小のものを選ぶ
const tickStepsMinutes = [10, 15, 30, 60, 120] as const;
const maxTicks = 6;
// 期限が帯や分岐点からこれ以上離れていれば軸に入れない。軸が縮みすぎるため
const maxDeadlineReachMinutes = 120;

// 再開見込みの帯と分岐点の位置関係
// before: 帯がすべて分岐点より前 / straddle: 帯が分岐点をまたぐ / after: 帯がすべて分岐点より後
export type ResumeRelation = "before" | "straddle" | "after";

export type BreakEvenTimelineInput = {
  // 判断の基準時刻。残り時間はこの時刻から数える
  asOf: string;
  // 画面上の現在。リプレイではシナリオ内の時刻
  now: Date;
  breakEvenTime: string;
  // 再開して乗れるまでの残り時間（分）
  remaining: DurationDist;
  // 再開から乗れる列車が来るまでの目安（分）。表示上の近似に使う
  firstTrainWaitMinutes: number;
  deadline: string | null;
};

// 判断から図に使う値を選ぶ。現在だけは画面の時計から渡す
// action は結論の行動。切り替えでは見込みの図に期限の印を出さない
export type TimelineBasis = Omit<BreakEvenTimelineInput, "now"> & { action: Action };

export type TimelineTick = { ms: number; position: number };

export type BreakEvenTimeline = {
  relation: ResumeRelation;
  startMs: number;
  endMs: number;
  resumeP50Ms: number;
  resumeP80Ms: number;
  breakEvenMs: number;
  // 0〜1 の横位置
  positions: {
    now: number;
    breakEven: number;
    resumeP50: number;
    resumeP80: number;
    deadline: number | null;
  };
  // 帯のうち分岐点より前と後の区間。無ければ null
  bandBefore: { from: number; to: number } | null;
  bandAfter: { from: number; to: number } | null;
  ticks: TimelineTick[];
};

// 再開見込み = 基準時刻 + 乗れるまでの残り − 初列車待ち。基準時刻より前にはしない
export function computeResumeWindow(
  asOf: string,
  remaining: DurationDist,
  firstTrainWaitMinutes: number,
): { p50Ms: number; p80Ms: number } {
  const asOfMs = Date.parse(asOf);
  const toMs = (minutes: number) =>
    Math.max(asOfMs, asOfMs + (minutes - firstTrainWaitMinutes) * MS_PER_MINUTE);
  return { p50Ms: toMs(remaining.p50), p80Ms: toMs(remaining.p80) };
}

export function classifyResumeRelation(
  resume: { p50Ms: number; p80Ms: number },
  breakEvenMs: number,
): ResumeRelation {
  if (resume.p80Ms <= breakEvenMs) return "before";
  if (resume.p50Ms > breakEvenMs) return "after";
  return "straddle";
}

// 日本時間の区切りに合わせた目盛り
export function listTicks(startMs: number, endMs: number): number[] {
  const spanMinutes = (endMs - startMs) / MS_PER_MINUTE;
  const step =
    tickStepsMinutes.find((s) => spanMinutes / s <= maxTicks) ?? tickStepsMinutes.at(-1) ?? 60;
  const stepMs = step * MS_PER_MINUTE;
  const first = Math.ceil((startMs + JST_OFFSET_MS) / stepMs) * stepMs - JST_OFFSET_MS;
  const ticks: number[] = [];
  for (let ms = first; ms <= endMs; ms += stepMs) ticks.push(ms);
  return ticks;
}

function selectDeadlineOnAxis(
  deadline: string | null,
  startMs: number,
  coreEndMs: number,
): number | null {
  if (deadline === null) return null;
  const ms = Date.parse(deadline);
  return ms >= startMs && ms <= coreEndMs + maxDeadlineReachMinutes * MS_PER_MINUTE ? ms : null;
}

// 再開から乗れる列車が来るまでの仮の目安（分）。知見の抜粋をやめる前と同じ値を置く
// TODO: packages/core の resolveFirstTrainWait ができたら置き換える
const provisionalFirstTrainWaitMinutes: Readonly<Record<string, number>> = {
  person_accident: 10,
  in_car_response: 2,
  vehicle_failure: 5,
  heavy_rain: 15,
};

// 事象が分からなければ 0 とみなす。図の説明に「おおよそ」と添える
export function estimateFirstTrainWait(eventType: string | null): number {
  return eventType === null ? 0 : (provisionalFirstTrainWaitMinutes[eventType] ?? 0);
}

export function selectTimelineBasis(
  settled: { judgment: Judgment; at: string } | null,
  deadline: string | null,
): TimelineBasis | null {
  if (settled === null) return null;
  const { breakEven, estimate } = settled.judgment;
  if (breakEven === null || estimate.remaining === null) return null;
  return {
    asOf: settled.at,
    breakEvenTime: breakEven.time,
    remaining: estimate.remaining,
    firstTrainWaitMinutes: estimateFirstTrainWait(estimate.eventType),
    deadline,
    action: settled.judgment.action,
  };
}

export function buildBreakEvenTimeline(input: BreakEvenTimelineInput): BreakEvenTimeline {
  const asOfMs = Date.parse(input.asOf);
  const nowMs = input.now.getTime();
  const breakEvenMs = Date.parse(input.breakEvenTime);
  const resume = computeResumeWindow(input.asOf, input.remaining, input.firstTrainWaitMinutes);

  // 軸は基準時刻から、帯・分岐点・期限のうち最も遅いものまで。両端に少し余白を取る
  const rawStart = Math.min(asOfMs, nowMs, breakEvenMs);
  const coreEnd = Math.max(resume.p80Ms, breakEvenMs, nowMs);
  const deadlineMs = selectDeadlineOnAxis(input.deadline, rawStart, coreEnd);
  const rawEnd = Math.max(coreEnd, deadlineMs ?? coreEnd);
  const span = Math.max(rawEnd - rawStart, 30 * MS_PER_MINUTE);
  const startMs = rawStart - span * 0.04;
  const endMs = rawStart + span * 1.08;
  const toPosition = (ms: number) => Math.min(1, Math.max(0, (ms - startMs) / (endMs - startMs)));

  const p50 = toPosition(resume.p50Ms);
  const p80 = toPosition(resume.p80Ms);
  const be = toPosition(breakEvenMs);

  return {
    relation: classifyResumeRelation(resume, breakEvenMs),
    startMs,
    endMs,
    resumeP50Ms: resume.p50Ms,
    resumeP80Ms: resume.p80Ms,
    breakEvenMs,
    positions: {
      now: toPosition(nowMs),
      breakEven: be,
      resumeP50: p50,
      resumeP80: p80,
      deadline: deadlineMs === null ? null : toPosition(deadlineMs),
    },
    bandBefore: p50 < be ? { from: p50, to: Math.min(p80, be) } : null,
    bandAfter: p80 > be ? { from: Math.max(p50, be), to: p80 } : null,
    ticks: listTicks(startMs, endMs).map((ms) => ({ ms, position: toPosition(ms) })),
  };
}
