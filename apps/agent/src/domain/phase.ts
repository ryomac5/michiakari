import { diffMinutes, estimateRemaining } from "@repo/core";
import type { Confidence, DurationDist, Knowledge, Observation } from "@repo/schema";

// 観測の列から事象種別・段階・残り時間を決める。数値の計算は core を呼ぶ

const CONFIDENCE_SCORE: Record<Confidence, number> = { high: 3, medium: 2, low: 1 };

// 観測の候補を確信度で重みづけして事象種別を選ぶ。同点なら新しい観測を優先する
export function selectEventType(
  observations: readonly Observation[],
  knowledge: ReadonlyMap<string, Knowledge>,
): string | null {
  const scores = new Map<string, { score: number; lastIndex: number }>();
  observations.forEach((o, index) => {
    for (const c of o.eventTypeCandidates) {
      if (!knowledge.has(c.eventType)) continue;
      const prev = scores.get(c.eventType) ?? { score: 0, lastIndex: -1 };
      scores.set(c.eventType, {
        score: prev.score + CONFIDENCE_SCORE[c.confidence],
        lastIndex: index,
      });
    }
  });
  let best: { eventType: string; score: number; lastIndex: number } | null = null;
  for (const [eventType, s] of scores) {
    if (!best || s.score > best.score || (s.score === best.score && s.lastIndex > best.lastIndex)) {
      best = { eventType, ...s };
    }
  }
  return best?.eventType ?? null;
}

export type PhaseDetection = {
  phaseIndex: number;
  phaseId: string;
  phaseStartedAt: string;
  elapsedMinutes: number;
  // この事象の兆候が一つでも観測されたか
  hasSignals: boolean;
  // 最後の段階の exit_signals が観測された。運転を再開したとみなす
  resumed: boolean;
};

function findSignalPhaseIndex(knowledge: Knowledge, signalId: string): number {
  return knowledge.phases.findIndex((p) => p.signals.some((s) => s.id === signalId));
}

// 観測された兆候のうち最も先の段階を現在の段階とする。段階の始まりはその段階の兆候を最初に観測した時刻
export function detectPhase(
  knowledge: Knowledge,
  observations: readonly Observation[],
  now: string,
): PhaseDetection {
  const hits = observations.flatMap((o) =>
    o.detectedSignals
      .filter((s) => s.eventType === knowledge.id)
      .map((s) => ({
        phaseIndex: findSignalPhaseIndex(knowledge, s.signalId),
        observedAt: o.observedAt,
      }))
      .filter((h) => h.phaseIndex >= 0),
  );
  const phaseIndex = hits.reduce((max, h) => Math.max(max, h.phaseIndex), 0);
  const startTimes = (hits.length > 0 ? hits.filter((h) => h.phaseIndex === phaseIndex) : [])
    .map((h) => h.observedAt)
    .concat(hits.length === 0 ? observations.map((o) => o.observedAt) : []);
  const phaseStartedAt = startTimes.reduce(
    (earliest, t) => (Date.parse(t) < Date.parse(earliest) ? t : earliest),
    startTimes[0] ?? now,
  );
  const phase = knowledge.phases[phaseIndex];
  if (!phase) throw new Error(`知見 ${knowledge.id} に段階がありません`);
  return {
    phaseIndex,
    phaseId: phase.id,
    phaseStartedAt,
    elapsedMinutes: Math.max(0, Math.floor(diffMinutes(phaseStartedAt, now))),
    hasSignals: hits.length > 0,
    resumed: checkResumed(knowledge, observations),
  };
}

function checkResumed(knowledge: Knowledge, observations: readonly Observation[]): boolean {
  const last = knowledge.phases.at(-1);
  if (!last) return false;
  return observations.some((o) =>
    o.detectedSignals.some(
      (s) => s.eventType === knowledge.id && last.exit_signals.includes(s.signalId),
    ),
  );
}

// 現在の段階から、exit_signals をたどって最も先へ進む経路の段階の位置を返す
export function findShortestPhasePath(knowledge: Knowledge, phaseIndex: number): number[] {
  const path = [phaseIndex];
  let current = phaseIndex;
  for (;;) {
    const phase = knowledge.phases[current];
    if (!phase) break;
    const next = phase.exit_signals
      .map((id) => findSignalPhaseIndex(knowledge, id))
      .filter((i) => i > current)
      .reduce((max, i) => Math.max(max, i), -1);
    const fallback = current + 1 < knowledge.phases.length ? current + 1 : -1;
    const step = next >= 0 ? next : fallback;
    if (step < 0) break;
    path.push(step);
    current = step;
  }
  return path;
}

export type RemainingEstimate = {
  remaining: DurationDist;
  basis: "knowledge" | "stated";
  // 短い経路で省いた段階
  skippedPhaseIds: string[];
};

// 段階が分岐するときは、p50 を省ける段階を省いた経路で、p80 をすべての段階を通る経路で求める
export function estimateBranchAwareRemaining(
  knowledge: Knowledge,
  detection: PhaseDetection,
): RemainingEstimate {
  const full = estimateRemaining(knowledge, detection.phaseId, detection.elapsedMinutes);
  const path = findShortestPhasePath(knowledge, detection.phaseIndex);
  const pathPhases = path.flatMap((i) => (knowledge.phases[i] ? [knowledge.phases[i]] : []));
  const skippedPhaseIds = knowledge.phases
    .slice(detection.phaseIndex)
    .filter((p) => !pathPhases.includes(p))
    .map((p) => p.id);
  if (skippedPhaseIds.length === 0) return { remaining: full, basis: "knowledge", skippedPhaseIds };
  const short = estimateRemaining(
    { ...knowledge, phases: pathPhases },
    detection.phaseId,
    detection.elapsedMinutes,
  );
  return {
    remaining: { p50: short.p50, p80: Math.max(full.p80, short.p80) },
    basis: "knowledge",
    skippedPhaseIds,
  };
}

// 再開後に乗れる列車が来るまでの待ち（分）。core に getFirstTrainWait が入ったら差し替える
export function extractFirstTrainWait(knowledge: Knowledge): DurationDist {
  return knowledge.after_resume.first_train_wait_minutes;
}

// 発表された再開見込み時刻に、再開後の初列車待ちを足す
export function estimateStatedRemaining(
  statedResumeTime: string,
  now: string,
  firstTrainWait: DurationDist,
): DurationDist {
  const untilResume = Math.max(0, Math.ceil(diffMinutes(now, statedResumeTime)));
  return { p50: untilResume + firstTrainWait.p50, p80: untilResume + firstTrainWait.p80 };
}

export type StatedResume = {
  time: string;
  // 以前の発表より後ろへずれたか
  extended: boolean;
};

// 観測時刻の順で最後に発表された再開見込み時刻を返す
export function findLatestStatedResume(observations: readonly Observation[]): StatedResume | null {
  const stated = [...observations]
    .sort((a, b) => Date.parse(a.observedAt) - Date.parse(b.observedAt))
    .flatMap((o) => (o.statedResumeTime ? [o.statedResumeTime] : []));
  const last = stated.at(-1);
  if (!last) return null;
  const extended = stated.slice(0, -1).some((t) => Date.parse(t) < Date.parse(last));
  return { time: last, extended };
}

export function decideEstimateConfidence(input: {
  detection: PhaseDetection;
  stated: StatedResume | null;
  statedIsFuture: boolean;
}): Confidence {
  if (input.stated && input.statedIsFuture && !input.stated.extended) return "high";
  if (!input.detection.hasSignals || (input.detection.phaseIndex === 0 && !input.statedIsFuture)) {
    return "low";
  }
  return "medium";
}
