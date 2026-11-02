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

// 現在の段階の条件付き残り、以降の段階の全量、再開後の初列車待ちを足した和の標本を作る
function sampleTotalRemaining(
  current: DurationModel,
  later: readonly DurationModel[],
  firstTrainWait: DurationModel,
  elapsedInPhaseMinutes: number,
): number[] {
  const random = createMulberry32(MONTE_CARLO_SEED);
  const samples: number[] = new Array(MONTE_CARLO_SAMPLE_COUNT);
  for (let i = 0; i < MONTE_CARLO_SAMPLE_COUNT; i++) {
    let total = sampleRemainingDuration(current, elapsedInPhaseMinutes, random);
    for (const model of later) total += sampleDuration(model, random);
    total += sampleDuration(firstTrainWait, random);
    samples[i] = total;
  }
  return samples;
}

// 段階と段階内の経過分から、残り時間の p50・p80（分、整数）を返す
export function estimateRemaining(
  knowledge: Knowledge,
  phaseId: string,
  elapsedInPhaseMinutes: number,
): DurationDist {
  if (!Number.isFinite(elapsedInPhaseMinutes) || elapsedInPhaseMinutes < 0) {
    throw new RangeError(`経過時間は 0 以上の有限値: ${elapsedInPhaseMinutes}`);
  }
  const index = findPhaseIndex(knowledge, phaseId);
  const models = knowledge.phases.map((p) => fitDurationModel(p.duration_minutes));
  const current = models[index];
  if (current === undefined) throw new RangeError(`段階 ${phaseId} のモデルがありません`);
  const samples = sampleTotalRemaining(
    current,
    models.slice(index + 1),
    fitDurationModel(getFirstTrainWait(knowledge)),
    elapsedInPhaseMinutes,
  ).sort((a, b) => a - b);
  return {
    p50: Math.round(computeQuantile(samples, 0.5)),
    p80: Math.round(computeQuantile(samples, 0.8)),
  };
}
