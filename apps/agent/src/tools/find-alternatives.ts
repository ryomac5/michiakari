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
    "現在地・行き先・止まっている区間・時刻から、待つ選択肢と代替手段（振替・徒歩・タクシー）の経路、到着時刻、運賃、徒歩時間をコードで計算する。estimate_phase_and_remaining の後に呼ぶ。駅間の車内の利用者なら、次の駅に着く見込みの時刻から探す。その結果はいまの選択肢として示さず、切り替えも勧めない。着いた後の次の一手はサーバーが決める。",
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

// 発表で分かった止まっている区間。新しい観測を優先する
export function findAnnouncedSection(observations: readonly Observation[]): Section | null {
  return findLatest(observations, (o) => o.section);
}

// 駅間の車内の人のための、代わりの手段から外す範囲の仮定。来た側の駅から行き先まで、行き先が駅でなければ次の駅まで
// 出発地は次の駅なので、これが無いと来た側の駅へ戻る経路を代替手段に数えてしまう
// 根拠は利用者がそこにいることだけで、見合わせの広さではない。画面にも判断の文にも区間として出さない
function buildAssumedTrainSection(ctx: ToolContext): Section | null {
  const position = ctx.request.trainPosition;
  if (position?.kind !== "between_stations" || !position.previousStation) return null;
  const destination = ctx.request.destination;
  const toStation =
    destination.kind === "station" ? destination.name : (position.nextStation ?? null);
  return toStation ? { fromStation: position.previousStation, toStation } : null;
}

export async function runFindAlternatives(
  ctx: ToolContext,
  estimate: EstimateToolResult,
  input: z.infer<typeof FindAlternativesInputSchema>,
): Promise<AlternativesToolResult> {
  const blockedLine = input.blockedLine ?? findLatest(ctx.observations, (o) => o.line);
  const observedSection = input.blockedSection ?? findAnnouncedSection(ctx.observations);
  const trainSection = observedSection ? null : buildAssumedTrainSection(ctx);
  const blockedSection: Section | null = observedSection ?? trainSection;
  const result = await ctx.provider.findAlternatives({
    origin: ctx.request.origin,
    destination: ctx.request.destination,
    blockedLine,
    blockedSection,
    blockedSectionFromTrain: trainSection !== null,
    now: ctx.request.now,
    // 駅間の車内なら、次の駅に着く見込みの時刻から代替手段に乗り出す。待つ側もこの時刻を起点にする
    ...(estimate.trainQueue?.arrival ? { departureTime: estimate.trainQueue.arrival.p50 } : {}),
    // 乗ったまま待つ側にも、前の列車が先に発車するぶんの遅れを足す
    extraWaitMinutesAfterResume: estimate.trainQueue?.departureDelayMinutes ?? 0,
    remaining: estimate.estimate.remaining,
    // 駅間の車内なら、待つ側の到着から初列車待ちを除く
    ...(estimate.trainQueue && estimate.firstTrainWait
      ? { firstTrainWaitMinutes: estimate.firstTrainWait.p50 }
      : {}),
    transferServiceActive: findLatest(ctx.observations, (o) => o.transferServiceActive),
    language: ctx.request.language,
  });
  return { ...result, blockedLine };
}
