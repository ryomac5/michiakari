import {
  addMinutesToIso,
  describeTypicalFlow,
  diffMinutes,
  estimateBranchAwareRemaining,
  estimateStatedRemaining,
  estimateStatedRemainingWithoutKnowledge,
  estimateStatsRemaining,
  estimateTrainQueueArrival,
  FALLBACK_RIDE_MINUTES_TO_NEXT_STATION,
  getFirstTrainWait,
  normalizeTrainType,
  parseIsoToMs,
  resolveStationPlatform,
  resolveTrainQueueParams,
  type StationAhead,
  sampleDurationDist,
} from "@repo/core";
import type { DurationDist, Estimate, EstimateSource, Knowledge } from "@repo/schema";
import { z } from "zod";
import { confidenceParams } from "../config.ts";
import {
  checkEventIdentified,
  decideEstimateConfidence,
  detectPhase,
  findLatestStatedResume,
  findOnsetTime,
  type StatedResume,
} from "../domain/phase.ts";
import { classifyFlowOutlook } from "../domain/typical-flow.ts";
import type { EstimateToolResult, ToolContext, TrainQueueToolResult } from "./types.ts";

// 先の駅を何駅まで追うか。詰める動きで前の列車が進める範囲
const STATIONS_AHEAD_LIMIT = 4;

// 新しい観測から順に、事業者を探す
function findOperator(ctx: ToolContext): string | null {
  const sorted = [...ctx.observations].sort(
    (a, b) => Date.parse(b.observedAt) - Date.parse(a.observedAt),
  );
  return sorted.find((o) => o.operator !== null)?.operator ?? null;
}

// 駅間の車内にいる利用者が、ホームに着ける駅に着く見込み。駅間でなければ null
// 再開までの残りは、乗れるまでの残りから初列車待ちを引いた分とする。車内の人は列車を待たないため
// closeUpCleared は線路の安全が確かめられた兆候があるか。無ければ詰める動きを使わない
function estimateTrainQueue(
  ctx: ToolContext,
  remaining: DurationDist | null,
  firstTrainWait: DurationDist | null,
  closeUpCleared: boolean,
): TrainQueueToolResult | null {
  const position = ctx.request.trainPosition;
  if (position?.kind !== "between_stations" || !position.nextStation) return null;
  const now = ctx.request.now;
  const line = ctx.observations.findLast((o) => o.line !== null)?.line ?? null;
  const ahead = position.previousStation
    ? ctx.provider.listStationsAhead({
        line,
        previousStation: position.previousStation,
        nextStation: position.nextStation,
        limit: STATIONS_AHEAD_LIMIT,
        departureTime: now,
      })
    : null;
  const lineId = ahead?.lineId ?? null;
  const stationsAhead: StationAhead[] = (
    ahead?.stations ?? [
      {
        name: position.nextStation,
        rideMinutesFromPrevious: FALLBACK_RIDE_MINUTES_TO_NEXT_STATION,
      },
    ]
  ).map((s) => ({ ...s, platform: resolveStationPlatform(lineId, s.name) }));
  const wait = firstTrainWait?.p50 ?? 0;
  const untilResume = remaining
    ? { p50: Math.max(0, remaining.p50 - wait), p80: Math.max(0, remaining.p80 - wait) }
    : null;
  const outcome = estimateTrainQueueArrival({
    now,
    untilResume,
    ownTrainType: position.ownTrainType,
    trainsAhead: position.trainsAhead,
    trainsAheadCount: position.trainsAheadCount,
    trainsAheadHeadwayMinutes: position.trainsAheadHeadwayMinutes ?? null,
    stationsAhead,
    params: resolveTrainQueueParams(findOperator(ctx)),
    closeUpCleared,
  });
  return {
    ...outcome,
    nextStation: position.nextStation,
    ownTrainType: normalizeTrainType(position.ownTrainType),
    sequenceKnown: position.trainsAhead !== null,
    lineId,
  };
}

export const EstimatePhaseInputSchema = z.object({
  eventType: z
    .string()
    .nullable()
    .describe(
      "事象種別（知見の id）。特定できなければ null。計算にはコードが観測と入口の原因から決めた事象を使い、違えば結果の note で知らせる",
    ),
});

export const estimatePhaseDefinition = {
  name: "estimate_phase_and_remaining",
  description:
    "観測された兆候と知見の exit_signals から現在の段階と段階の経過時間を決め、再開して乗れるまでの残り時間（p50, p80 分）をコードで計算する。発表された再開見込み時刻があれば優先する。事象が null でも発表の時刻があれば、その時刻どおりを p50、延びる余地を p80 とした残り時間を返す（remainingBasis は stated）。事象が null で発表の時刻が無くても、入口で答えた原因の統計値があれば、そこから残り時間を返す（remainingBasis は statistics）。事象の段階と再開までの見込み（typicalFlow）と、見込みの立てやすさから見た短い・長いの区別（flowOutlook）も返す。止まり方（stopScope）は、その列車から止まる train か、区間を止める section。駅間の車内なら、降りられる駅に着く見込みと自分の列車が動き出す見込み（trainQueue）も返す。",
  inputSchema: EstimatePhaseInputSchema,
} as const;

// 知見が無いときの残り時間と標本。発表の再開見込みが先にあれば、その時刻だけを根拠にする
// 発表の時刻ちょうどとその後は、知見の原因と同じく原因の見込みに戻す。発表の時刻は結果に残す
// 原因の見込みは入口で答えた原因の統計値で、出どころは発表の時刻を使うあいだも statistics にする
function estimateWithoutKnowledge(
  ctx: ToolContext,
  stated: StatedResume | null,
  statedIsFuture: boolean,
  onsetTime: string,
): {
  remaining: DurationDist | null;
  samples: readonly number[] | null;
  basis: "stated" | "statistics" | null;
  source: EstimateSource;
} {
  const now = ctx.request.now;
  const cause = ctx.request.cause;
  const stats = cause ? estimateStatsRemaining(cause, onsetTime, now) : null;
  const source: EstimateSource = stats ? "statistics" : "none";
  if (stated && statedIsFuture) {
    const remaining = estimateStatedRemainingWithoutKnowledge(stated.time, now);
    return { remaining, samples: sampleDurationDist(remaining), basis: "stated", source };
  }
  if (stats) {
    return { remaining: stats.remaining, samples: stats.samples, basis: "statistics", source };
  }
  return { remaining: null, samples: null, basis: null, source };
}

// 知見が無いときの結果。確率の標本は、残り時間と同じ根拠から作る
// 統計値は報道に残った事例で長引いたものに偏り、段階も分からないので、確信度は low のままにする
function buildUnknownEstimate(
  ctx: ToolContext,
  stated: StatedResume | null,
  statedIsFuture: boolean,
  onsetTime: string,
): EstimateToolResult {
  const now = ctx.request.now;
  const { remaining, samples, basis, source } = estimateWithoutKnowledge(
    ctx,
    stated,
    statedIsFuture,
    onsetTime,
  );
  const estimate: Estimate = {
    eventType: null,
    phaseId: null,
    elapsedMinutes: null,
    remaining,
    confidence: basis === "stated" ? confidenceParams.whenStatedWithoutEvent : "low",
    source,
  };
  return {
    estimate,
    // 知見が無ければ段階が分からないので、再開の見込みの時刻が出たことだけを安全が確かめられた兆候とする
    trainQueue: estimateTrainQueue(ctx, remaining, null, stated !== null),
    phaseName: null,
    phaseGuidance: null,
    phaseStartedAt: null,
    statedResumeTime: stated?.time ?? null,
    statedExtended: stated?.extended ?? false,
    remainingBasis: basis,
    skippedPhaseIds: [],
    firstTrainWait: null,
    boardableP50: remaining ? addMinutesToIso(now, remaining.p50) : null,
    boardableP80: remaining ? addMinutesToIso(now, remaining.p80) : null,
    typicalFlow: null,
    flowOutlook: null,
    remainingSamples: samples,
    onsetTime,
  };
}

// 確率の計算に使う標本。残り時間の p50・p80 と同じ根拠から作る
// 知見から見積もるときは分岐と下限を考えた標本、発表の時刻があるときはその時刻に初列車待ちを足した標本、再開の後は初列車待ちだけの標本
function sampleRemainingByBasis(input: {
  basis: "knowledge" | "stated" | "resumed";
  remaining: DurationDist;
  firstTrainWait: DurationDist;
  knowledgeSamples: readonly number[];
}): readonly number[] {
  if (input.basis === "knowledge") return input.knowledgeSamples;
  if (input.basis === "resumed") return sampleDurationDist(input.firstTrainWait);
  return sampleDurationDist(
    input.firstTrainWait,
    Math.max(0, input.remaining.p50 - input.firstTrainWait.p50),
  );
}

// 線路の安全が確かめられた兆候。再開の見込みの時刻が出たか、知見の最後の段階である再開に向けた段階に入ったか
function checkCloseUpCleared(
  knowledge: Knowledge,
  phaseIndex: number,
  stated: StatedResume | null,
): boolean {
  const last = knowledge.phases.length - 1;
  return stated !== null || (last > 0 && phaseIndex >= last);
}

export function runEstimatePhase(
  ctx: ToolContext,
  input: z.infer<typeof EstimatePhaseInputSchema>,
): EstimateToolResult {
  const now = ctx.request.now;
  const stated = findLatestStatedResume(ctx.observations);
  const statedIsFuture = stated !== null && parseIsoToMs(stated.time) > parseIsoToMs(now);
  // 発生時刻は観測から分からないので、最初の観測の時刻を発生とみなす
  const onsetAt = findOnsetTime(ctx.observations, now);
  const knowledge = input.eventType ? ctx.content.knowledge.get(input.eventType) : undefined;
  if (!knowledge) return buildUnknownEstimate(ctx, stated, statedIsFuture, onsetAt);

  const detection = detectPhase(knowledge, ctx.observations, now);
  const firstTrainWait = getFirstTrainWait(knowledge);
  // 知見の下限は発生からの分
  const fromKnowledge = estimateBranchAwareRemaining(
    knowledge,
    detection.phaseId,
    detection.elapsedMinutes,
    { elapsedSinceOnsetMinutes: Math.max(0, Math.floor(diffMinutes(onsetAt, now))) },
  );
  // 再開済みなら、乗れる列車が来るまでの待ちだけが残る
  const basis = detection.resumed ? "resumed" : stated && statedIsFuture ? "stated" : "knowledge";
  const remaining =
    basis === "resumed"
      ? firstTrainWait
      : basis === "stated" && stated
        ? estimateStatedRemaining(knowledge, stated.time, now)
        : fromKnowledge.remaining;
  const phase = knowledge.phases[detection.phaseIndex];
  const language = ctx.request.language;
  const typicalFlow = describeTypicalFlow(knowledge);
  const flowOutlook = classifyFlowOutlook(typicalFlow);

  return {
    estimate: {
      eventType: knowledge.id,
      phaseId: detection.phaseId,
      elapsedMinutes: detection.elapsedMinutes,
      remaining,
      confidence: decideEstimateConfidence({
        detection,
        stated,
        statedIsFuture,
        predictability: typicalFlow.predictability.level,
        identified: checkEventIdentified(knowledge.id, detection, ctx.observations),
      }),
      source: "knowledge",
    },
    trainQueue: estimateTrainQueue(
      ctx,
      remaining,
      firstTrainWait,
      checkCloseUpCleared(knowledge, detection.phaseIndex, stated),
    ),
    phaseName: phase ? (phase.name[language] ?? phase.name.ja) : null,
    phaseGuidance: phase ? (phase.guidance[language] ?? phase.guidance.ja) : null,
    phaseStartedAt: detection.phaseStartedAt,
    statedResumeTime: stated?.time ?? null,
    statedExtended: stated?.extended ?? false,
    remainingBasis: basis,
    skippedPhaseIds: basis === "knowledge" ? fromKnowledge.skippedPhaseIds : [],
    firstTrainWait,
    boardableP50: addMinutesToIso(now, remaining.p50),
    boardableP80: addMinutesToIso(now, remaining.p80),
    typicalFlow,
    flowOutlook,
    remainingSamples: sampleRemainingByBasis({
      basis,
      remaining,
      firstTrainWait,
      knowledgeSamples: fromKnowledge.samples,
    }),
    onsetTime: onsetAt,
  };
}
