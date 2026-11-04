import type { ResumeChance, ResumeChanceTick } from "@repo/schema";
import { computeQuantile } from "./remaining.ts";
import { diffMinutes, formatJstIso, parseIsoToMs } from "./time.ts";

// 時刻ごとの再開の見込みと、待ったほうが早く着く確率
// どちらも残り時間の推定と同じ標本から数える。分岐点の比べ方と食い違わないことを最優先にする
//
// 量の定義
// - 標本 s は「再開して実際に乗れる列車が来るまでの残り（分）」で、初列車待ちを含む
// - 待った場合の到着 T_wait = now + s + 再開後の乗車時間
// - 代替手段の到着 T_alt は find_alternatives が返した決まった値として扱い、ばらつきは持たせない
// - 待ったほうが早く着く確率は P(T_wait ≤ T_alt)。同着は待つ側に数える。乗り換えの手間が無いぶん待つほうが楽なため
//   分岐点 = T_alt − 乗車時間 − 初列車待ち(p50) なので、この確率は P(s ≤ 分岐点までの分 + 初列車待ち) と同じ値になる
// - 待って期限に間に合う確率は P(T_wait ≤ 期限)。同時刻は間に合うとみなし、checkDeadline と同じにする
// - 目盛りの「その時刻までに動いている」確率は、乗れる時刻から初列車待ち(p50)を引いた再開の時刻が目盛り以前である確率
//   再開見込み（ResumeOutlook）と同じ近似なので、p50 の目盛りはおよそ 5 割、p80 の目盛りはおよそ 8 割になる

const MS_PER_MINUTE = 60_000;
const JST_OFFSET_MS = 9 * 60 * MS_PER_MINUTE;

// 目盛りの刻みの候補（分）。見込みの幅に応じて、目盛りが多くなりすぎない最小のものを選ぶ
export const CHANCE_TICK_STEPS_MINUTES = [10, 15, 30, 60] as const;
export const CHANCE_TICK_COUNT = { min: 4, max: 6 } as const;
// 丸めで「9 割以上」とする境目
export const CHANCE_NEARLY_CERTAIN = 0.95;
// 目盛りの終わりに使う分位点。9 割の標本が動いている時刻を「ほぼ動いている」とみなし、そこまで覆う
// 95% 点にすると長引く側の裾で帯が間延びし、1 割から 9 割へ移る区間が粗くなる
export const CHANCE_TICK_END_QUANTILE = 0.9;
// これより小さい確率は「1 割未満」として扱う
export const CHANCE_FLOOR = 0.05;
// 分岐点が「ほぼ動いている」時刻よりこの分より後なら、目盛りに含めない。帯が間延びするため
const BREAK_EVEN_REACH_MINUTES = 60;

export type ResumeChanceInput = {
  now: string;
  // 再開して乗れるまでの残り時間の標本（分、昇順）
  samples: readonly number[];
  // 初列車待ちの p50。再開の時刻は、乗れる時刻からこの分だけ前とみなす（分岐点の比べ方と同じ）
  firstTrainWaitMinutes: number;
  // 再開後に乗ってから目的地に着くまでの分。経路が無ければ null
  waitRouteMinutesAfterResume: number | null;
  // いちばん早い代替手段の到着時刻。代替手段が無ければ null
  bestAlternativeArrival: string | null;
  // 分岐点（運転再開の期限）。近ければ目盛りがこの時刻を覆う。無ければ null
  breakEvenTime: string | null;
  deadline: string | null;
  // 発生とみなした時刻。分からなければ null
  onsetTime: string | null;
};

function assertSorted(samples: readonly number[]): void {
  if (samples.length === 0) throw new RangeError("標本が空です");
  for (let i = 1; i < samples.length; i++) {
    if ((samples[i] ?? 0) < (samples[i - 1] ?? 0)) throw new RangeError("標本が昇順ではありません");
  }
}

// 昇順の標本のうち minutes 以下の割合（0〜1）
export function computeChanceWithin(sorted: readonly number[], minutes: number): number {
  if (sorted.length === 0) throw new RangeError("標本が空です");
  if (!Number.isFinite(minutes)) return minutes > 0 ? 1 : 0;
  let low = 0;
  let high = sorted.length;
  while (low < high) {
    const mid = (low + high) >>> 1;
    if ((sorted[mid] ?? 0) <= minutes) low = mid + 1;
    else high = mid;
  }
  return low / sorted.length;
}

// 確率を 1 割単位に丸める。0.05 未満は 0（1 割未満）、0.95 以上は 10（9 割以上）。0 割と 10 割は出さない
export function roundChanceTenths(probability: number): number {
  if (!Number.isFinite(probability) || probability < 0 || probability > 1) {
    throw new RangeError(`確率は 0〜1: ${probability}`);
  }
  if (probability < CHANCE_FLOOR) return 0;
  if (probability >= CHANCE_NEARLY_CERTAIN) return 10;
  return Math.min(9, Math.max(1, Math.round(probability * 10)));
}

// 待ったほうが早く着く確率 P(T_wait ≤ T_alt)。T_alt は決まった値、同着は待つ側
export function computeWaitFasterProbability(input: {
  now: string;
  samples: readonly number[];
  waitRouteMinutesAfterResume: number;
  bestAlternativeArrival: string;
}): number {
  const limit =
    diffMinutes(input.now, input.bestAlternativeArrival) - input.waitRouteMinutesAfterResume;
  return computeChanceWithin(input.samples, limit);
}

// 待って期限に間に合う確率 P(T_wait ≤ 期限)。同時刻は間に合う
export function computeWaitOnTimeProbability(input: {
  now: string;
  samples: readonly number[];
  waitRouteMinutesAfterResume: number;
  deadline: string;
}): number {
  const limit = diffMinutes(input.now, input.deadline) - input.waitRouteMinutesAfterResume;
  return computeChanceWithin(input.samples, limit);
}

// 時刻 time までに動いている確率。乗れる時刻から初列車待ちを引いた再開の時刻が time 以前
export function computeMovingProbability(input: {
  now: string;
  samples: readonly number[];
  firstTrainWaitMinutes: number;
  time: string;
}): number {
  const limit = diffMinutes(input.now, input.time) + input.firstTrainWaitMinutes;
  return computeChanceWithin(input.samples, limit);
}

// 日本時間の切りのよい時刻に目盛りを置く。いまより後の最初の切りのよい時刻から始め、endMs を覆う
// 刻みは候補のうち、目盛りが最大数に収まる最小のもの。足りなければ最小数まで延ばす
export function listChanceTickTimes(
  nowMs: number,
  endMs: number,
): { stepMinutes: number; times: number[] } {
  const build = (stepMinutes: number, cap: boolean) => {
    const stepMs = stepMinutes * MS_PER_MINUTE;
    const first = Math.floor((nowMs + JST_OFFSET_MS) / stepMs) * stepMs - JST_OFFSET_MS + stepMs;
    const needed = Math.ceil((endMs - first) / stepMs) + 1;
    const count = Math.max(
      CHANCE_TICK_COUNT.min,
      cap ? Math.min(needed, CHANCE_TICK_COUNT.max) : needed,
    );
    return {
      stepMinutes,
      times: Array.from({ length: count }, (_, i) => first + i * stepMs),
    };
  };
  for (const step of CHANCE_TICK_STEPS_MINUTES) {
    const candidate = build(step, false);
    if (candidate.times.length <= CHANCE_TICK_COUNT.max) return candidate;
  }
  // 60 分刻みでも収まらなければ最大数で打ち切る
  return build(Math.max(...CHANCE_TICK_STEPS_MINUTES), true);
}

function assertMinutes(value: number, name: string): void {
  if (!Number.isFinite(value) || value < 0)
    throw new RangeError(`${name} は 0 以上の有限値: ${value}`);
}

// 目盛りの終わり。ほぼ動いている時刻まで覆い、分岐点が近ければそこまで延ばす
function selectTickEnd(input: ResumeChanceInput, nowMs: number): number {
  const nearlyCertainMinutes =
    computeQuantile(input.samples, CHANCE_TICK_END_QUANTILE) - input.firstTrainWaitMinutes;
  const nearlyCertainMs = nowMs + Math.max(0, nearlyCertainMinutes) * MS_PER_MINUTE;
  if (input.breakEvenTime === null) return nearlyCertainMs;
  const breakEvenMs = parseIsoToMs(input.breakEvenTime);
  const reachMs = nearlyCertainMs + BREAK_EVEN_REACH_MINUTES * MS_PER_MINUTE;
  return breakEvenMs > nearlyCertainMs && breakEvenMs <= reachMs ? breakEvenMs : nearlyCertainMs;
}

export function computeResumeChance(input: ResumeChanceInput): ResumeChance {
  assertSorted(input.samples);
  assertMinutes(input.firstTrainWaitMinutes, "初列車待ち");
  if (input.waitRouteMinutesAfterResume !== null) {
    assertMinutes(input.waitRouteMinutesAfterResume, "再開後の乗車時間");
  }
  const nowMs = parseIsoToMs(input.now);
  const onsetMs = input.onsetTime === null ? null : parseIsoToMs(input.onsetTime);
  const { stepMinutes, times } = listChanceTickTimes(nowMs, selectTickEnd(input, nowMs));
  const ticks: ResumeChanceTick[] = times.map((ms) => ({
    time: formatJstIso(ms),
    tenths: roundChanceTenths(
      computeMovingProbability({
        now: input.now,
        samples: input.samples,
        firstTrainWaitMinutes: input.firstTrainWaitMinutes,
        time: formatJstIso(ms),
      }),
    ),
    sinceOnsetMinutes:
      onsetMs === null ? null : Math.max(0, Math.round((ms - onsetMs) / MS_PER_MINUTE)),
  }));

  const waitRoute = input.waitRouteMinutesAfterResume;
  const waitFaster =
    waitRoute === null || input.bestAlternativeArrival === null
      ? null
      : roundChanceTenths(
          computeWaitFasterProbability({
            now: input.now,
            samples: input.samples,
            waitRouteMinutesAfterResume: waitRoute,
            bestAlternativeArrival: input.bestAlternativeArrival,
          }),
        );
  const hasDeadline = waitRoute !== null && input.deadline !== null;
  const waitOnTime =
    !hasDeadline || input.deadline === null || waitRoute === null
      ? null
      : roundChanceTenths(
          computeWaitOnTimeProbability({
            now: input.now,
            samples: input.samples,
            waitRouteMinutesAfterResume: waitRoute,
            deadline: input.deadline,
          }),
        );
  // 期限に間に合うには、この時刻までに動いている必要がある。分岐点と同じく、乗車時間と初列車待ちを差し引く
  const resumeByForDeadline =
    !hasDeadline || input.deadline === null || waitRoute === null
      ? null
      : formatJstIso(
          parseIsoToMs(input.deadline) - (waitRoute + input.firstTrainWaitMinutes) * MS_PER_MINUTE,
        );

  return {
    stepMinutes,
    ticks,
    waitFaster,
    waitOnTime,
    resumeByForDeadline,
    onsetTime: input.onsetTime,
  };
}

// 要点の 1 文に使う目盛り。5 割に達する最初の目盛り。無ければ最後の目盛り
export function selectKeyTick(ticks: readonly ResumeChanceTick[]): ResumeChanceTick | null {
  return ticks.find((t) => t.tenths >= 5) ?? ticks.at(-1) ?? null;
}
