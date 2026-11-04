import {
  addMinutesToIso,
  describeTypicalFlow,
  diffMinutes,
  estimateBranchAwareRemaining,
  estimateStatedRemaining,
  estimateStatedRemainingWithoutKnowledge,
  getFirstTrainWait,
  parseIsoToMs,
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
import { buildFlowSentence, classifyFlowOutlook } from "../domain/typical-flow.ts";
import type { EstimateToolResult, ToolContext } from "./types.ts";

export const EstimatePhaseInputSchema = z.object({
  eventType: z.string().nullable().describe("事象種別（知見の id）。特定できなければ null"),
});

export const estimatePhaseDefinition = {
  name: "estimate_phase_and_remaining",
  description:
    "観測された兆候と知見の exit_signals から現在の段階と段階の経過時間を決め、再開して乗れるまでの残り時間（p50, p80 分）をコードで計算する。発表された再開見込み時刻があれば優先する。事象が null でも発表の時刻があれば、その時刻どおりを p50、延びる余地を p80 とした残り時間を返す（remainingBasis は stated）。事象のよくある流れ（typicalFlow）、見込みの立てやすさから見た短い・長いの区別（flowOutlook）、結論の理由に使える一文（flowSentence）も返す。",
  inputSchema: EstimatePhaseInputSchema,
} as const;

// 事象が分からないときの結果。発表の再開見込みが先にあれば、その時刻だけを根拠に残り時間を置く
// 確率の標本は、その見込み（発表の時刻を p50、延びる余地を p80）に当てた分布から作る
function buildUnknownEstimate(
  now: string,
  stated: StatedResume | null,
  statedIsFuture: boolean,
  onsetTime: string,
): EstimateToolResult {
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
    flowSentence: null,
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
  if (!knowledge) return buildUnknownEstimate(now, stated, statedIsFuture, onsetAt);

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
  const eventName = knowledge.name[language] ?? knowledge.name.ja;

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
    flowSentence: flowOutlook
      ? buildFlowSentence(typicalFlow, eventName, flowOutlook, language)
      : null,
    remainingSamples: sampleRemainingByBasis({
      basis,
      remaining,
      firstTrainWait,
      knowledgeSamples: fromKnowledge.samples,
    }),
    onsetTime: onsetAt,
  };
}
