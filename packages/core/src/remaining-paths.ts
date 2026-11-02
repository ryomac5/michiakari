import type { DurationDist, Knowledge } from "@repo/schema";
import { estimateRemaining, findPhaseIndex, getFirstTrainWait } from "./remaining.ts";
import { diffMinutes } from "./time.ts";

// 段階の分岐と発表された見込み時刻を考えた残り時間の推定

export type BranchAwareRemaining = {
  remaining: DurationDist;
  // 短い経路で省いた段階の id
  skippedPhaseIds: string[];
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

// p50 は p50 の合計が最小の経路で、p80 は最大の経路で求める
// 段階が分岐しない知見では estimateRemaining と同じ値になる
export function estimateBranchAwareRemaining(
  knowledge: Knowledge,
  phaseId: string,
  elapsedInPhaseMinutes: number,
): BranchAwareRemaining {
  const index = findPhaseIndex(knowledge, phaseId);
  const { shortest, longest } = findPhasePaths(knowledge, index);
  const skippedPhaseIds = knowledge.phases
    .slice(index)
    .filter((_, offset) => !shortest.includes(index + offset))
    .map((p) => p.id);
  const short = estimateRemaining(
    selectPhases(knowledge, shortest),
    phaseId,
    elapsedInPhaseMinutes,
  );
  const long = estimateRemaining(selectPhases(knowledge, longest), phaseId, elapsedInPhaseMinutes);
  return { remaining: { p50: short.p50, p80: Math.max(long.p80, short.p80) }, skippedPhaseIds };
}

// 発表された再開見込み時刻までの分（切り上げ、0 以上）に、再開後の初列車待ちを足す
export function estimateStatedRemaining(
  knowledge: Knowledge,
  statedResumeTime: string,
  now: string,
): DurationDist {
  const untilResume = Math.max(0, Math.ceil(diffMinutes(now, statedResumeTime)));
  const wait = getFirstTrainWait(knowledge);
  return { p50: untilResume + wait.p50, p80: untilResume + wait.p80 };
}
