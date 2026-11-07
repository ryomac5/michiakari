import type { Observation } from "@repo/schema";
import { formatIsoWithOffset } from "@/features/judgment/time";

// 車内で「信号を受信したため緊急停止」の放送を聞いたかの答え
export const protectionAnswerIds = ["heard", "notHeard", "unsure"] as const;
export type ProtectionAnswer = (typeof protectionAnswerIds)[number];

export const protectionObservationId = "entry-protection-broadcast";
// 聞いたと答えた人の放送として、判断に送る文
export const protectionBroadcastText = "危険を知らせる信号を受信したため、緊急停止しました";

// 聞いたなら、車内の放送の観測を 1 つ返す。聞いていないか覚えていなければ何も返さない
// 放送は止まったときに流れるので、見た時刻は止まってからの分だけ前にする
export function buildProtectionObservations(
  answer: ProtectionAnswer | null,
  now: Date,
  elapsedMinutes: number | null = null,
): Observation[] {
  if (answer !== "heard") return [];
  const observedAt = new Date(now.getTime() - (elapsedMinutes ?? 0) * 60_000);
  return [
    {
      id: protectionObservationId,
      observedAt: formatIsoWithOffset(observedAt),
      source: "selection",
      kind: "station_broadcast",
      rawText: protectionBroadcastText,
      eventTypeCandidates: [],
      operator: null,
      line: null,
      section: null,
      statedResumeTime: null,
      transferServiceActive: null,
      detectedSignals: [],
    },
  ];
}
