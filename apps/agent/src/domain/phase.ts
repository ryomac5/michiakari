import { diffMinutes, selectObservedEventType } from "@repo/core";
import type { Confidence, Knowledge, Observation, PredictabilityLevel } from "@repo/schema";
import { confidenceParams } from "../config.ts";

// 観測の列から事象種別と段階を決める。残り時間の計算は core が受け持つ

const CONFIDENCE_SCORE: Record<Confidence, number> = { high: 3, medium: 2, low: 1 };

// 観測の候補から事象種別を選ぶ。選び方は core の 1 か所にあり、画面も同じ関数を使う
export function selectEventType(
  observations: readonly Observation[],
  knowledge: ReadonlyMap<string, Knowledge>,
): string | null {
  return selectObservedEventType(observations, (id) => knowledge.has(id));
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

// 発生時刻は観測から分からないので、最初の観測の時刻を発生とみなす。観測が無ければ現在
export function findOnsetTime(observations: readonly Observation[], now: string): string {
  return observations.reduce(
    (earliest, o) => (Date.parse(o.observedAt) < Date.parse(earliest) ? o.observedAt : earliest),
    now,
  );
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

// 原因が観測から特定できたか。事象の兆候を観測したか、事象を確信度高で読み取った
export function checkEventIdentified(
  eventType: string,
  detection: PhaseDetection,
  observations: readonly Observation[],
): boolean {
  if (detection.hasSignals) return true;
  return observations.some((o) =>
    o.eventTypeCandidates.some((c) => c.eventType === eventType && c.confidence === "high"),
  );
}

function decideBaseConfidence(input: {
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

// 見込みが立てやすい事象で原因が特定できていれば、発生直後でも確信度を下限より下げない
export function decideEstimateConfidence(input: {
  detection: PhaseDetection;
  stated: StatedResume | null;
  statedIsFuture: boolean;
  predictability: PredictabilityLevel | null;
  identified: boolean;
}): Confidence {
  const base = decideBaseConfidence(input);
  const floor = confidenceParams.floorWhenPredictable;
  const predictable = input.predictability === confidenceParams.predictableLevel;
  if (!predictable || !input.identified) return base;
  return CONFIDENCE_SCORE[base] < CONFIDENCE_SCORE[floor] ? floor : base;
}

// 線路の安全が確かめられた兆候の判定は core の手がかりの照合に移した
export { checkTrackCleared } from "@repo/core";
