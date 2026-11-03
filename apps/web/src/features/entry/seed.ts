import type { Observation } from "@repo/schema";
import type { OriginLine } from "@/features/judgment/session";
import { formatIsoWithOffset } from "@/features/judgment/time";

export const entryLineObservationId = "entry-line";

// 入口で利用者が選んだ「止まっている路線」を観測にする
// 運行の状態は利用者の申告として扱い、事象の種類や兆候は持たせない
export function buildLineObservation(line: OriginLine, now: Date): Observation {
  return {
    id: entryLineObservationId,
    observedAt: formatIsoWithOffset(now),
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
