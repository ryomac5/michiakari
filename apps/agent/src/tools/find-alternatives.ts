import type { Observation, Section } from "@repo/schema";
import { SectionSchema } from "@repo/schema";
import { z } from "zod";
import type { AlternativesToolResult, EstimateToolResult, ToolContext } from "./types.ts";

export const FindAlternativesInputSchema = z.object({
  blockedLine: z
    .string()
    .nullable()
    .optional()
    .describe("止まっている路線名。省略すると観測から決める"),
  blockedSection: SectionSchema.nullable()
    .optional()
    .describe("止まっている区間。省略すると観測から決める"),
});

export const findAlternativesDefinition = {
  name: "find_alternatives",
  description:
    "現在地・行き先・止まっている区間・時刻から、待つ選択肢と代替手段（振替・徒歩・タクシー）の経路、到着時刻、運賃、徒歩時間をコードで計算する。estimate_phase_and_remaining の後に呼ぶ。",
  inputSchema: FindAlternativesInputSchema,
} as const;

// 新しい観測から順に、null でない値を探す
function findLatest<T>(
  observations: readonly Observation[],
  pick: (o: Observation) => T | null,
): T | null {
  const sorted = [...observations].sort(
    (a, b) => Date.parse(b.observedAt) - Date.parse(a.observedAt),
  );
  for (const o of sorted) {
    const value = pick(o);
    if (value !== null) return value;
  }
  return null;
}

export async function runFindAlternatives(
  ctx: ToolContext,
  estimate: EstimateToolResult,
  input: z.infer<typeof FindAlternativesInputSchema>,
): Promise<AlternativesToolResult> {
  const blockedLine = input.blockedLine ?? findLatest(ctx.observations, (o) => o.line);
  const blockedSection: Section | null =
    input.blockedSection ?? findLatest(ctx.observations, (o) => o.section);
  const result = await ctx.provider.findAlternatives({
    origin: ctx.request.origin,
    destination: ctx.request.destination,
    blockedLine,
    blockedSection,
    now: ctx.request.now,
    remaining: estimate.estimate.remaining,
    transferServiceActive: findLatest(ctx.observations, (o) => o.transferServiceActive),
    language: ctx.request.language,
  });
  return { ...result, blockedLine };
}
