import type { JudgmentSchema, ObservationSchema } from "@repo/schema";
import type { z } from "zod";

type Judgment = z.infer<typeof JudgmentSchema>;
type Observation = z.infer<typeof ObservationSchema>;

const SUMMARY_MAX_CHARACTERS = 50;

// 発表の最初の一文を使う。確率は同じ指標の推定値をそのまま並べる
export function buildJudgmentChange(
  previous: Judgment | null,
  current: Judgment | null,
  announcement: Observation["rawText"] | null,
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
    beforeChance: previous.breakEven?.resumeChance?.waitFaster ?? null,
    afterChance: current.breakEven?.resumeChance?.waitFaster ?? null,
  };
}
