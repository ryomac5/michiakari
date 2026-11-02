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

// 段階の位置から exit_signals をたどり、最も先の段階へ進む経路の段階の位置を返す
// exit_signals が後の段階を指さなければ、次の段階へ進む
export function findShortestPhasePath(knowledge: Knowledge, phaseIndex: number): number[] {
  if (!knowledge.phases[phaseIndex]) {
    throw new RangeError(`知見 ${knowledge.id} に位置 ${phaseIndex} の段階がありません`);
  }
  const path = [phaseIndex];
  for (let current = phaseIndex; ; ) {
    const phase = knowledge.phases[current];
    if (!phase) break;
    const jump = phase.exit_signals
      .map((id) => findSignalPhaseIndex(knowledge, id))
      .filter((i) => i > current)
      .reduce((max, i) => Math.max(max, i), -1);
    const next = jump >= 0 ? jump : current + 1 < knowledge.phases.length ? current + 1 : -1;
    if (next < 0) break;
    path.push(next);
    current = next;
  }
  return path;
}

// p50 は省ける段階を省いた経路で、p80 はすべての段階を通る経路で求める
// 段階が分岐しない知見では estimateRemaining と同じ値になる
export function estimateBranchAwareRemaining(
  knowledge: Knowledge,
  phaseId: string,
  elapsedInPhaseMinutes: number,
): BranchAwareRemaining {
  const index = findPhaseIndex(knowledge, phaseId);
  const full = estimateRemaining(knowledge, phaseId, elapsedInPhaseMinutes);
  const pathPhases = findShortestPhasePath(knowledge, index).flatMap((i) => {
    const phase = knowledge.phases[i];
    return phase ? [phase] : [];
  });
  const skippedPhaseIds = knowledge.phases
    .slice(index)
    .filter((p) => !pathPhases.includes(p))
    .map((p) => p.id);
  if (skippedPhaseIds.length === 0) return { remaining: full, skippedPhaseIds };

  const short = estimateRemaining(
    { ...knowledge, phases: pathPhases },
    phaseId,
    elapsedInPhaseMinutes,
  );
  return { remaining: { p50: short.p50, p80: Math.max(full.p80, short.p80) }, skippedPhaseIds };
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
