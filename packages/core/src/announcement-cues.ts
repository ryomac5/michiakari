import type { Observation } from "@repo/schema";
import {
  ANNOUNCEMENT_CUE_IDS,
  ANNOUNCEMENT_CUE_PATTERNS,
  type AnnouncementCueId,
  CLAUSE_SEPARATORS,
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

function splitClauses(sentence: string): string[] {
  return sentence.split(CLAUSE_SEPARATORS).filter((c) => c.trim().length > 0);
}

function checkNegatedClause(clause: string): boolean {
  return NEGATION_PATTERNS.some((p) => p.test(clause));
}

function checkProhibitedSentence(sentence: string): boolean {
  return PROHIBITION_PATTERNS.some((p) => p.test(sentence));
}

// 節の中で手がかりの言い回しに当たるか。否定は同じ節の中だけに効かせる
function matchClauseCue(id: AnnouncementCueId, clause: string): boolean {
  if (NEGATION_SENSITIVE_CUES.has(id) && checkNegatedClause(clause)) return false;
  return ANNOUNCEMENT_CUE_PATTERNS[id].some((p) => p.test(clause));
}

// 条件付きの文と止める文では、それぞれに弱い手がかりを数えない。否定は節ごとに見る
// 節をまたぐ言い回しも拾えるよう、否定の無い文は文全体でも照合する
function detectSentenceCues(sentence: string): AnnouncementCueId[] {
  const conditional = checkConditionalSentence(sentence);
  const prohibited = checkProhibitedSentence(sentence);
  const clauses = splitClauses(sentence);
  const sentenceNegated = checkNegatedClause(sentence);
  return ANNOUNCEMENT_CUE_IDS.filter(
    (id) =>
      !(conditional && CONDITIONAL_SENSITIVE_CUES.has(id)) &&
      !(prohibited && PROHIBITION_SENSITIVE_CUES.has(id)) &&
      (clauses.some((c) => matchClauseCue(id, c)) ||
        (!sentenceNegated && matchClauseCue(id, sentence))),
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

// その手がかりを含む観測のうち、いちばん新しい観測の時刻（ミリ秒）。無ければ null
function findLatestCueTime(
  observations: readonly Observation[],
  cue: AnnouncementCueId,
  detect: (o: Observation) => readonly AnnouncementCueId[],
): number | null {
  const times = observations
    .filter((o) => detect(o).includes(cue))
    .map((o) => Date.parse(o.observedAt));
  return times.length > 0 ? Math.max(...times) : null;
}

// 線路に降りる案内と再開の放送が両方あれば、観測の時刻が新しいほうだけを残す
// 同じ時刻なら降りる案内を残し、数字を出さない側に倒す。detect は観測 1 件の手がかりを返す
export function resolveEvacuationCues(
  observations: readonly Observation[],
  cues: readonly AnnouncementCueId[],
  detect: (o: Observation) => readonly AnnouncementCueId[] = (o) => detectObservationCues([o]),
): AnnouncementCueId[] {
  if (!cues.includes("evacuation_on_track") || !cues.includes("resumed")) return [...cues];
  const evacuatedAt = findLatestCueTime(observations, "evacuation_on_track", detect);
  const resumedAt = findLatestCueTime(observations, "resumed", detect);
  const resumedLater = resumedAt !== null && (evacuatedAt === null || resumedAt > evacuatedAt);
  const dropped = resumedLater ? "evacuation_on_track" : "resumed";
  return cues.filter((c) => c !== dropped);
}
