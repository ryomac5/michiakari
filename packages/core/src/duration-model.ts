import type { DurationDist } from "@repo/schema";
import { MIN_MEDIAN_MINUTES } from "../params/estimation.ts";
import { type Random, sampleStandardNormal, sampleTruncatedStandardNormal } from "./random.ts";

// 所要時間の分布モデル。p50 と p80 から対数正規分布を当てはめる

// 標準正規分布の 80% 点
const Z_P80 = 0.8416212335729143;

export type DurationModel =
  | { kind: "constant"; minutes: number }
  | { kind: "lognormal"; mu: number; sigma: number };

// p50 = p80 なら定数、それ以外は mu = ln p50、sigma = (ln p80 − ln p50) / z0.8 の対数正規分布
export function fitDurationModel(dist: DurationDist): DurationModel {
  if (dist.p80 < dist.p50) {
    throw new RangeError(`p80 は p50 以上である必要があります: ${dist.p50}, ${dist.p80}`);
  }
  if (dist.p50 === dist.p80) return { kind: "constant", minutes: dist.p50 };
  const median = Math.max(dist.p50, MIN_MEDIAN_MINUTES);
  const mu = Math.log(median);
  const sigma = (Math.log(dist.p80) - mu) / Z_P80;
  return { kind: "lognormal", mu, sigma };
}

// 段階の所要時間を 1 つ標本化する
export function sampleDuration(model: DurationModel, random: Random): number {
  if (model.kind === "constant") return model.minutes;
  return Math.exp(model.mu + model.sigma * sampleStandardNormal(random));
}

// 「経過時間を超えた」条件付きの残り時間を 1 つ標本化する
export function sampleRemainingDuration(
  model: DurationModel,
  elapsedMinutes: number,
  random: Random,
): number {
  if (model.kind === "constant") return Math.max(model.minutes - elapsedMinutes, 0);
  if (elapsedMinutes <= 0) return sampleDuration(model, random);
  const lower = (Math.log(elapsedMinutes) - model.mu) / model.sigma;
  const z = sampleTruncatedStandardNormal(random, lower);
  return Math.max(Math.exp(model.mu + model.sigma * z) - elapsedMinutes, 0);
}
