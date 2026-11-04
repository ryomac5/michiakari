import type { DurationDist, Knowledge } from "@repo/schema";
import { MONTE_CARLO_SAMPLE_COUNT, MONTE_CARLO_SEED } from "../params/estimation.ts";
import {
  type DurationModel,
  fitDurationModel,
  sampleDuration,
  sampleRemainingDuration,
} from "./duration-model.ts";
import { createMulberry32 } from "./random.ts";

// 再開して実際に乗れる列車が来るまでの残り時間の推定

// 段階 ID の位置を返す。見つからなければ例外
export function findPhaseIndex(knowledge: Knowledge, phaseId: string): number {
  const index = knowledge.phases.findIndex((p) => p.id === phaseId);
  if (index < 0) {
    throw new RangeError(`知見 ${knowledge.id} に段階 ${phaseId} がありません`);
  }
  return index;
}

// 知見から「運転再開から実際に乗れる列車が来るまで」の分布を取り出す
export function getFirstTrainWait(knowledge: Knowledge): DurationDist {
  return knowledge.after_resume.first_train_wait_minutes;
}

// 昇順に並んだ標本の分位点を線形補間で返す
export function computeQuantile(sorted: readonly number[], q: number): number {
  if (sorted.length === 0) throw new RangeError("標本が空です");
  const position = (sorted.length - 1) * q;
  const lowerIndex = Math.floor(position);
  const upperIndex = Math.ceil(position);
  const lower = sorted[lowerIndex] ?? 0;
  const upper = sorted[upperIndex] ?? lower;
  return lower + (upper - lower) * (position - lowerIndex);
}

// 知見の typical_floor_minutes から、運転再開までの残りの下限（分）を返す
// 下限は発生からの分なので、発生からの経過を差し引く。下限が無い知見や下限を過ぎたあとは 0
export function computeResumeFloorRemaining(
  knowledge: Knowledge,
  elapsedSinceOnsetMinutes: number,
): number {
  if (!Number.isFinite(elapsedSinceOnsetMinutes) || elapsedSinceOnsetMinutes < 0) {
    throw new RangeError(`発生からの経過は 0 以上の有限値: ${elapsedSinceOnsetMinutes}`);
  }
  const floor = knowledge.predictability?.typical_floor_minutes;
  return floor === undefined ? 0 : Math.max(0, floor - elapsedSinceOnsetMinutes);
}

export type RemainingOptions = {
  // 運転再開までの残りの下限（分）。初列車待ちを含まない。既定は 0
  resumeFloorMinutes?: number;
};

// 現在の段階の条件付き残り、以降の段階の全量、再開後の初列車待ちを足した和の標本を作る
// 再開までの部分が下限より短い標本だけを下限に切り上げる。長い側の形は変えない
function sampleTotalRemaining(
  current: DurationModel,
  later: readonly DurationModel[],
  firstTrainWait: DurationModel,
  elapsedInPhaseMinutes: number,
  resumeFloorMinutes: number,
): number[] {
  const random = createMulberry32(MONTE_CARLO_SEED);
  const samples: number[] = new Array(MONTE_CARLO_SAMPLE_COUNT);
  for (let i = 0; i < MONTE_CARLO_SAMPLE_COUNT; i++) {
    let untilResume = sampleRemainingDuration(current, elapsedInPhaseMinutes, random);
    for (const model of later) untilResume += sampleDuration(model, random);
    samples[i] = Math.max(untilResume, resumeFloorMinutes) + sampleDuration(firstTrainWait, random);
  }
  return samples;
}

// 段階と段階内の経過分から、残り時間の標本（分、昇順）を返す。estimateRemaining はこの標本の分位点を取る
// 確率の計算（resume-chance.ts）も同じ標本を使う
export function sampleRemaining(
  knowledge: Knowledge,
  phaseId: string,
  elapsedInPhaseMinutes: number,
  options: RemainingOptions = {},
): number[] {
  if (!Number.isFinite(elapsedInPhaseMinutes) || elapsedInPhaseMinutes < 0) {
    throw new RangeError(`経過時間は 0 以上の有限値: ${elapsedInPhaseMinutes}`);
  }
  const resumeFloorMinutes = options.resumeFloorMinutes ?? 0;
  if (!Number.isFinite(resumeFloorMinutes) || resumeFloorMinutes < 0) {
    throw new RangeError(`再開までの下限は 0 以上の有限値: ${resumeFloorMinutes}`);
  }
  const index = findPhaseIndex(knowledge, phaseId);
  const models = knowledge.phases.map((p) => fitDurationModel(p.duration_minutes));
  const current = models[index];
  if (current === undefined) throw new RangeError(`段階 ${phaseId} のモデルがありません`);
  return sampleTotalRemaining(
    current,
    models.slice(index + 1),
    fitDurationModel(getFirstTrainWait(knowledge)),
    elapsedInPhaseMinutes,
    resumeFloorMinutes,
  ).sort((a, b) => a - b);
}

// 昇順の標本から p50・p80（分、整数）を取る
export function summarizeSamples(sorted: readonly number[]): DurationDist {
  return {
    p50: Math.round(computeQuantile(sorted, 0.5)),
    p80: Math.round(computeQuantile(sorted, 0.8)),
  };
}

// 段階と段階内の経過分から、残り時間の p50・p80（分、整数）を返す
export function estimateRemaining(
  knowledge: Knowledge,
  phaseId: string,
  elapsedInPhaseMinutes: number,
  options: RemainingOptions = {},
): DurationDist {
  return summarizeSamples(sampleRemaining(knowledge, phaseId, elapsedInPhaseMinutes, options));
}

// 分布ごとの標本の控え。知見の初列車待ちのように同じ分布を判断のたびに使うので、作り直さない
const durationSamplesCache = new WeakMap<DurationDist, readonly number[]>();

function sampleDurationDistBase(dist: DurationDist): readonly number[] {
  const cached = durationSamplesCache.get(dist);
  if (cached) return cached;
  const model = fitDurationModel(dist);
  const random = createMulberry32(MONTE_CARLO_SEED);
  const samples: number[] = new Array(MONTE_CARLO_SAMPLE_COUNT);
  for (let i = 0; i < MONTE_CARLO_SAMPLE_COUNT; i++) samples[i] = sampleDuration(model, random);
  samples.sort((a, b) => a - b);
  durationSamplesCache.set(dist, samples);
  return samples;
}

// 所要時間の分布から標本（分、昇順）を作る。offsetMinutes を足して返す
// 発表された見込み時刻までの分に初列車待ちを足す場合や、再開後の初列車待ちだけが残る場合に使う
export function sampleDurationDist(dist: DurationDist, offsetMinutes = 0): number[] {
  if (!Number.isFinite(offsetMinutes) || offsetMinutes < 0) {
    throw new RangeError(`足す分は 0 以上の有限値: ${offsetMinutes}`);
  }
  return sampleDurationDistBase(dist).map((v) => v + offsetMinutes);
}
