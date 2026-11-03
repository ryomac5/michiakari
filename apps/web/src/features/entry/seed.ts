import type { Observation } from "@repo/schema";
import type { OriginLine } from "@/features/judgment/session";
import { formatIsoWithOffset } from "@/features/judgment/time";

export const entryLineObservationId = "entry-line";

// 入口で利用者が選んだ「止まっている路線」を観測にする
// 運行の状態は利用者の申告として扱い、事象の種類や兆候は持たせない
// 止まってからの分が分かれば、止まっているのを見た時刻をその分だけ前にする。段階の経過はこの時刻から数える
export function buildLineObservation(
  line: OriginLine,
  now: Date,
  elapsedMinutes: number | null = null,
): Observation {
  const observedAt = new Date(now.getTime() - (elapsedMinutes ?? 0) * 60_000);
  return {
    id: entryLineObservationId,
    observedAt: formatIsoWithOffset(observedAt),
    source: "selection",
    eventTypeCandidates: [],
    operator: line.operator.ja,
    line: line.observedName,
    section: null,
    statedResumeTime: null,
    transferServiceActive: null,
    detectedSignals: [],
  };
}
