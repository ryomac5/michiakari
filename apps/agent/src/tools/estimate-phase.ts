import {
  addMinutesToIso,
  describeTypicalFlow,
  diffMinutes,
  estimateBranchAwareRemaining,
  estimateStatedRemaining,
  estimateStatedRemainingWithoutKnowledge,
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
import type { DurationDist, Estimate } from "@repo/schema";
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
function estimateTrainQueue(
  ctx: ToolContext,
  remaining: DurationDist | null,
  firstTrainWait: DurationDist | null,
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
  eventType: z.string().nullable().describe("事象種別（知見の id）。特定できなければ null"),
});

export const estimatePhaseDefinition = {
  name: "estimate_phase_and_remaining",
  description:
    "観測された兆候と知見の exit_signals から現在の段階と段階の経過時間を決め、再開して乗れるまでの残り時間（p50, p80 分）をコードで計算する。発表された再開見込み時刻があれば優先する。事象が null でも発表の時刻があれば、その時刻どおりを p50、延びる余地を p80 とした残り時間を返す（remainingBasis は stated）。事象の段階と再開までの見込み（typicalFlow）と、見込みの立てやすさから見た短い・長いの区別（flowOutlook）も返す。止まり方（stopScope）は、その列車だけが止まる train か、区間を止める section。駅間の車内なら、降りられる駅に着く見込みと自分の列車が動き出す見込み（trainQueue）も返す。",
  inputSchema: EstimatePhaseInputSchema,
} as const;

// 事象が分からないときの結果。発表の再開見込みが先にあれば、その時刻だけを根拠に残り時間を置く
// 確率の標本は、その見込み（発表の時刻を p50、延びる余地を p80）に当てた分布から作る
function buildUnknownEstimate(
  ctx: ToolContext,
  stated: StatedResume | null,
  statedIsFuture: boolean,
  onsetTime: string,
): EstimateToolResult {
  const now = ctx.request.now;
  const remaining =
    stated && statedIsFuture ? estimateStatedRemainingWithoutKnowledge(stated.time, now) : null;
  const estimate: Estimate = {
    eventType: null,
    phaseId: null,
    elapsedMinutes: null,
    remaining,
    confidence: remaining ? confidenceParams.whenStatedWithoutEvent : "low",
  };
  return {
    estimate,
    trainQueue: estimateTrainQueue(ctx, remaining, null),
    phaseName: null,
    phaseGuidance: null,
    phaseStartedAt: null,
    statedResumeTime: stated?.time ?? null,
    statedExtended: stated?.extended ?? false,
    remainingBasis: remaining ? "stated" : null,
    skippedPhaseIds: [],
    firstTrainWait: null,
    boardableP50: remaining ? addMinutesToIso(now, remaining.p50) : null,
    boardableP80: remaining ? addMinutesToIso(now, remaining.p80) : null,
    typicalFlow: null,
    flowOutlook: null,
    remainingSamples: remaining ? sampleDurationDist(remaining) : null,
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
    },
    trainQueue: estimateTrainQueue(ctx, remaining, firstTrainWait),
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
