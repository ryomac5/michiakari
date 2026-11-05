import type { DurationDist, Knowledge } from "@repo/schema";
import { STATED_RESUME_SLACK_MINUTES } from "../params/estimation.ts";
import {
  computeQuantile,
  computeResumeFloorRemaining,
  findPhaseIndex,
  getFirstTrainWait,
  sampleRemaining,
  summarizeSamples,
} from "./remaining.ts";
import { diffMinutes } from "./time.ts";

// 段階の分岐と発表された見込み時刻を考えた残り時間の推定

export type BranchAwareRemaining = {
  remaining: DurationDist;
  // 短い経路で省いた段階の id
  skippedPhaseIds: string[];
  // 確率の計算に使う、乗れるまでの残り時間の標本（分、昇順）。再開までの下限を当ててある
  // 分岐しない知見では estimateRemaining と同じ標本。分岐する知見では mergeBranchSamples でつなぐ
  samples: number[];
};

function findSignalPhaseIndex(knowledge: Knowledge, signalId: string): number {
  return knowledge.phases.findIndex((p) => p.signals.some((s) => s.id === signalId));
}

export type PhasePaths = {
  // 段階の所要時間の p50 の合計が最小の経路
  shortest: number[];
  // 段階の所要時間の p50 の合計が最大の経路
  longest: number[];
};

// 次の段階へのフォールスルーと、exit_signals が指す後の段階を、次に進める候補とする
function listNextPhaseIndexes(knowledge: Knowledge, current: number): number[] {
  const phase = knowledge.phases[current];
  if (!phase) return [];
  const jumps = phase.exit_signals
    .map((id) => findSignalPhaseIndex(knowledge, id))
    .filter((i) => i > current);
  const fallthrough = current + 1 < knowledge.phases.length ? [current + 1] : [];
  return [...new Set([...fallthrough, ...jumps])].sort((a, b) => a - b);
}

// 段階の位置から最後の段階までの経路をすべて列挙する。段階は先へしか進まないので有限
export function enumeratePhasePaths(knowledge: Knowledge, phaseIndex: number): number[][] {
  if (!knowledge.phases[phaseIndex]) {
    throw new RangeError(`知見 ${knowledge.id} に位置 ${phaseIndex} の段階がありません`);
  }
  const next = listNextPhaseIndexes(knowledge, phaseIndex);
  if (next.length === 0) return [[phaseIndex]];
  return next.flatMap((i) =>
    enumeratePhasePaths(knowledge, i).map((rest) => [phaseIndex, ...rest]),
  );
}

function sumPathP50(knowledge: Knowledge, path: readonly number[]): number {
  return path.reduce((sum, i) => sum + (knowledge.phases[i]?.duration_minutes.p50 ?? 0), 0);
}

// p50 の合計が最小の経路と最大の経路を返す。同じ合計なら先に列挙したもの
export function findPhasePaths(knowledge: Knowledge, phaseIndex: number): PhasePaths {
  const paths = enumeratePhasePaths(knowledge, phaseIndex);
  let shortest = paths[0] ?? [phaseIndex];
  let longest = shortest;
  for (const path of paths) {
    if (sumPathP50(knowledge, path) < sumPathP50(knowledge, shortest)) shortest = path;
    if (sumPathP50(knowledge, path) > sumPathP50(knowledge, longest)) longest = path;
  }
  return { shortest, longest };
}

function selectPhases(knowledge: Knowledge, path: readonly number[]): Knowledge {
  return {
    ...knowledge,
    phases: path.flatMap((i) => {
      const phase = knowledge.phases[i];
      return phase ? [phase] : [];
    }),
  };
}

export type BranchAwareOptions = {
  // 発生からの経過分。与えると知見の typical_floor_minutes を再開までの下限として当てる
  elapsedSinceOnsetMinutes?: number;
};

// 分岐する知見の 2 つの経路の標本を 1 つにつなぐ
// p50 までは最短の経路の標本に従い、p80 からは p80 が大きいほうの経路の標本に従う。あいだは時間に対して直線で結ぶ
// つないだ標本の p50 と p80 は estimateBranchAwareRemaining の値と一致するので、確率が分岐点の比べ方と食い違わない
export function mergeBranchSamples(
  shortest: readonly number[],
  longest: readonly number[],
): number[] {
  const median = computeQuantile(shortest, 0.5);
  const upper =
    computeQuantile(longest, 0.8) >= computeQuantile(shortest, 0.8) ? longest : shortest;
  const p80 = computeQuantile(upper, 0.8);
  const count = shortest.length;
  const merged: number[] = new Array(count);
  for (let i = 0; i < count; i++) {
    const q = (i + 0.5) / count;
    merged[i] =
      q <= 0.5
        ? computeQuantile(shortest, q)
        : q >= 0.8
          ? computeQuantile(upper, q)
          : median + ((q - 0.5) / 0.3) * (p80 - median);
  }
  return merged;
}

function isSamePath(a: readonly number[], b: readonly number[]): boolean {
  return a.length === b.length && a.every((v, i) => v === b[i]);
}

// p50 は p50 の合計が最小の経路で、p80 は最大の経路で求める
// 段階が分岐しない知見では estimateRemaining と同じ値になる
// 段階を飛ばす短い経路でも、再開までが知見の下限を下回らないようにする
export function estimateBranchAwareRemaining(
  knowledge: Knowledge,
  phaseId: string,
  elapsedInPhaseMinutes: number,
  options: BranchAwareOptions = {},
): BranchAwareRemaining {
  const index = findPhaseIndex(knowledge, phaseId);
  const resumeFloorMinutes =
    options.elapsedSinceOnsetMinutes === undefined
      ? 0
      : computeResumeFloorRemaining(knowledge, options.elapsedSinceOnsetMinutes);
  const { shortest, longest } = findPhasePaths(knowledge, index);
  const skippedPhaseIds = knowledge.phases
    .slice(index)
    .filter((_, offset) => !shortest.includes(index + offset))
    .map((p) => p.id);
  const shortSamples = sampleRemaining(
    selectPhases(knowledge, shortest),
    phaseId,
    elapsedInPhaseMinutes,
    { resumeFloorMinutes },
  );
  const samePath = isSamePath(shortest, longest);
  const longSamples = samePath
    ? shortSamples
    : sampleRemaining(selectPhases(knowledge, longest), phaseId, elapsedInPhaseMinutes, {
        resumeFloorMinutes,
      });
  const short = summarizeSamples(shortSamples);
  const long = summarizeSamples(longSamples);
  return {
    remaining: { p50: short.p50, p80: Math.max(long.p80, short.p80) },
    skippedPhaseIds,
    samples: samePath ? shortSamples : mergeBranchSamples(shortSamples, longSamples),
  };
}

// 発表された再開見込み時刻までの分（切り上げ、0 以上）
function computeMinutesUntilStated(statedResumeTime: string, now: string): number {
  return Math.max(0, Math.ceil(diffMinutes(now, statedResumeTime)));
}

// 発表された再開見込み時刻までの分に、再開後の初列車待ちを足す
export function estimateStatedRemaining(
  knowledge: Knowledge,
  statedResumeTime: string,
  now: string,
): DurationDist {
  const untilResume = computeMinutesUntilStated(statedResumeTime, now);
  const wait = getFirstTrainWait(knowledge);
  return { p50: untilResume + wait.p50, p80: untilResume + wait.p80 };
}

// 原因が分からず知見が無いときの、発表された再開見込み時刻からの残り時間
// p50 は発表の時刻どおり、p80 は STATED_RESUME_SLACK_MINUTES だけ延びる余地を持たせる
export function estimateStatedRemainingWithoutKnowledge(
  statedResumeTime: string,
  now: string,
): DurationDist {
  const untilResume = computeMinutesUntilStated(statedResumeTime, now);
  return { p50: untilResume, p80: untilResume + STATED_RESUME_SLACK_MINUTES };
}
