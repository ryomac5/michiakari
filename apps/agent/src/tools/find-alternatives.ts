import { applyTransferFares, rankAlternativesForProtection } from "@repo/core";
import type { Observation, RouteOption, Section } from "@repo/schema";
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
    .describe("止まっている区間。発表の区間と同じときだけ使う。省略すると観測から決める"),
});

export const findAlternativesDefinition = {
  name: "find_alternatives",
  description:
    "現在地・行き先・止まっている区間・時刻から、待つ選択肢と代替手段（振替・徒歩・タクシー）の経路、到着時刻、運賃、徒歩時間をコードで計算する。estimate_remaining の後に呼ぶ。防護無線の事象では、止まった会社と同じ会社の線は最初は一緒に止まるので後ろに下げ（loweredOptionIds）、他社の線を前に上げる。駅間の車内の利用者なら、次の駅に着く見込みの時刻から探す。その結果はいまの選択肢として示さず、切り替えも勧めない。着いた後の次の一手はサーバーが決める。",
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

// 2 つの区間が同じ 2 駅か。向きは問わない
function isSameSection(a: Section, b: Section): boolean {
  return (
    (a.fromStation === b.fromStation && a.toStation === b.toStation) ||
    (a.fromStation === b.toStation && a.toStation === b.fromStation)
  );
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

// 待つ選択肢が乗る路線。止まっている会社を決めるのに使う
function findWaitLineId(options: readonly RouteOption[], waitOptionId: string): string | null {
  const wait = options.find((o) => o.id === waitOptionId);
  return wait?.legs.find((leg) => leg.mode === "ride" && leg.lineId)?.lineId ?? null;
}

// 防護無線の事象では、待つ選択肢を先頭に残し、残りを上げる・そのまま・下げるの順に並べる
// 止まった会社は待つ選択肢の乗る路線から決め、引けなければ観測の事業者名を使う
function rankForProtection(
  options: readonly RouteOption[],
  waitOptionId: string,
  operator: string | null,
): { options: RouteOption[]; loweredOptionIds: string[] } {
  const wait = options.filter((o) => o.id === waitOptionId);
  const blockedLineId = findWaitLineId(options, waitOptionId);
  const ranked = rankAlternativesForProtection({
    options: options.filter((o) => o.id !== waitOptionId),
    protection: true,
    blockedLineId,
    blockedOperator: operator,
  });
  return {
    options: [...wait, ...ranked.map((r) => r.option)],
    loweredOptionIds: ranked.filter((r) => r.standing === "lowered").map((r) => r.option.id),
  };
}

export async function runFindAlternatives(
  ctx: ToolContext,
  estimate: EstimateToolResult,
  input: z.infer<typeof FindAlternativesInputSchema>,
): Promise<AlternativesToolResult> {
  const blockedLine = input.blockedLine ?? findLatest(ctx.observations, (o) => o.line);
  // 区間は観測から取る。引数の区間は発表と同じときだけ使い、発表に無い区間で代わりの経路を外させない
  const announced = findAnnouncedSection(ctx.observations);
  const observedSection =
    announced && input.blockedSection && isSameSection(input.blockedSection, announced)
      ? input.blockedSection
      : announced;
  const trainSection = observedSection ? null : buildAssumedTrainSection(ctx);
  const blockedSection: Section | null = observedSection ?? trainSection;
  const transferServiceActive = findLatest(ctx.observations, (o) => o.transferServiceActive);
  const found = await ctx.provider.findAlternatives({
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
    transferServiceActive,
    language: ctx.request.language,
  });
  const operator = findLatest(ctx.observations, (o) => o.operator);
  // 乗車券の種類で、他社の線へ乗り換える選択肢の追加の費用を決める。分岐点の同着の扱いにも効く
  const result = {
    ...found,
    options: applyTransferFares({
      options: found.options,
      ticketType: ctx.request.ticketType ?? null,
      transferServiceActive,
      blockedLineId: findWaitLineId(found.options, found.waitOptionId),
      blockedOperatorName: operator,
    }),
  };
  if (!estimate.protection) return { ...result, blockedLine };
  return {
    ...result,
    ...rankForProtection(result.options, result.waitOptionId, operator),
    blockedLine,
  };
}
