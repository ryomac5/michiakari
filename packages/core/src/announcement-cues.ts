import type { Observation } from "@repo/schema";
import {
  ANNOUNCEMENT_CUE_IDS,
  ANNOUNCEMENT_CUE_PATTERNS,
  type AnnouncementCueId,
  CONDITIONAL_SENSITIVE_CUES,
  CONDITIONAL_SENTENCE_MARKERS,
  NEGATION_PATTERNS,
  NEGATION_SENSITIVE_CUES,
  PROHIBITION_PATTERNS,
  PROHIBITION_SENSITIVE_CUES,
} from "../params/announcement-cues.ts";

// 放送と発表の文から、行動を変える手がかりを拾う

function splitSentences(text: string): string[] {
  return text.split(/[。.\n]/).filter((s) => s.trim().length > 0);
}

function checkConditionalSentence(sentence: string): boolean {
  return CONDITIONAL_SENTENCE_MARKERS.some((m) => sentence.includes(m));
}

function checkNegatedSentence(sentence: string): boolean {
  return NEGATION_PATTERNS.some((p) => p.test(sentence));
}

function checkProhibitedSentence(sentence: string): boolean {
  return PROHIBITION_PATTERNS.some((p) => p.test(sentence));
}

// 条件付きの文、否定の文、止める文では、それぞれに弱い手がかりを数えない
function detectSentenceCues(sentence: string): AnnouncementCueId[] {
  const conditional = checkConditionalSentence(sentence);
  const negated = checkNegatedSentence(sentence);
  const prohibited = checkProhibitedSentence(sentence);
  return ANNOUNCEMENT_CUE_IDS.filter(
    (id) =>
      !(conditional && CONDITIONAL_SENSITIVE_CUES.has(id)) &&
      !(negated && NEGATION_SENSITIVE_CUES.has(id)) &&
      !(prohibited && PROHIBITION_SENSITIVE_CUES.has(id)) &&
      ANNOUNCEMENT_CUE_PATTERNS[id].some((p) => p.test(sentence)),
  );
}

// 文から手がかりの id を拾う。並びは ANNOUNCEMENT_CUE_IDS の順で、重複しない
export function detectAnnouncementCues(text: string): AnnouncementCueId[] {
  const found = new Set(splitSentences(text).flatMap(detectSentenceCues));
  return ANNOUNCEMENT_CUE_IDS.filter((id) => found.has(id));
}

function listObservationTexts(o: Observation): string[] {
  return [o.rawText ?? "", ...o.detectedSignals.map((s) => s.quote)];
}

// 観測の列から手がかりの id を拾う。原文と兆候の引用を見る
export function detectObservationCues(observations: readonly Observation[]): AnnouncementCueId[] {
  const found = new Set(
    observations.flatMap((o) => listObservationTexts(o).flatMap(detectAnnouncementCues)),
  );
  return ANNOUNCEMENT_CUE_IDS.filter((id) => found.has(id));
}

// 線路の安全が確かめられた兆候があるか。再開の見込みの時刻か、再開が近いと言い切る放送で判定する
// 「〜次第」の条件付きの文は数えない
export function checkTrackCleared(observations: readonly Observation[]): boolean {
  return (
    observations.some((o) => o.statedResumeTime !== null) ||
    detectObservationCues(observations).includes("track_cleared")
  );
}

// 点検の文と並べて見る、再開に向けた手がかり
const RESUME_SIGNAL_CUES: readonly AnnouncementCueId[] = [
  "resumed",
  "resume_soon",
  "track_cleared",
  "inspection_ongoing",
];

// 点検が続いているか。点検か再開に向けた手がかりを含む観測のうち、いちばん新しいもので決める
export function checkInspectionPending(observations: readonly Observation[]): boolean {
  const latest = [...observations]
    .sort((a, b) => Date.parse(a.observedAt) - Date.parse(b.observedAt))
    .map((o) => detectObservationCues([o]))
    .findLast((cues) => cues.some((c) => RESUME_SIGNAL_CUES.includes(c)));
  return latest?.includes("inspection_ongoing") ?? false;
}

// 点検が終わるまでは、再開が近い手がかりを数えない。再開した手がかりは残す
export function filterCuesDuringInspection(
  cues: readonly AnnouncementCueId[],
  inspectionPending: boolean,
): AnnouncementCueId[] {
  if (!inspectionPending) return [...cues];
  return cues.filter((c) => c !== "resume_soon" && c !== "track_cleared");
}
