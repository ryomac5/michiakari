import type { DurationDist } from "@repo/schema";
import { MONTE_CARLO_SAMPLE_COUNT, MONTE_CARLO_SEED } from "../params/estimation.ts";
import { fitDurationModel, sampleDuration } from "./duration-model.ts";
import { createMulberry32 } from "./random.ts";

// 残り時間の標本と分位点

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

// 昇順の標本から p50・p80（分、整数）を取る
export function summarizeSamples(sorted: readonly number[]): DurationDist {
  return {
    p50: Math.round(computeQuantile(sorted, 0.5)),
    p80: Math.round(computeQuantile(sorted, 0.8)),
  };
}

// 分布ごとの標本の控え。初列車待ちのように同じ分布を判断のたびに使うので、作り直さない
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
