import type { JudgmentSchema, ObservationSchema } from "@repo/schema";
import type { z } from "zod";
import { type EvidenceEntry, selectEvidenceEntries } from "./evidence-text";

type Judgment = z.infer<typeof JudgmentSchema>;
type Observation = z.infer<typeof ObservationSchema>;

const SUMMARY_MAX_CHARACTERS = 50;

// 変化のカードの「そこから読めること」。根拠の欄で手がかりの読みが付いた項目を使い、無ければ出さない
export function selectChangeEvidence(
  context: Parameters<typeof selectEvidenceEntries>[0],
): EvidenceEntry | null {
  return selectEvidenceEntries(context).find((entry) => entry.cueId !== null) ?? null;
}

// 発表の最初の一文を使う。確率は同じ指標の推定値をそのまま並べる
export function buildJudgmentChange(
  previous: Judgment | null,
  current: Judgment | null,
  announcement: Observation["rawText"] | null,
  evidence: EvidenceEntry | null = null,
) {
  if (!previous || !current || previous.action === current.action) return null;
  const sentence = announcement?.trim().split(/(?<=[。!?])\s*|(?<=\.)\s+/u)[0] ?? "";
  const characters = Array.from(sentence);
  const summary =
    characters.length > SUMMARY_MAX_CHARACTERS
      ? `${characters.slice(0, SUMMARY_MAX_CHARACTERS - 1).join("")}…`
      : sentence;

  return {
    before: previous.action,
    after: current.action,
    announcement: summary || null,
    evidence,
    beforeChance: previous.breakEven?.resumeChance?.waitFaster ?? null,
    afterChance: current.breakEven?.resumeChance?.waitFaster ?? null,
  };
}
