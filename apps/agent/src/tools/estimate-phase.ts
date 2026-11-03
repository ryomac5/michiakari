import {
  addMinutesToIso,
  diffMinutes,
  estimateBranchAwareRemaining,
  estimateStatedRemaining,
  getFirstTrainWait,
  parseIsoToMs,
} from "@repo/core";
import type { Estimate } from "@repo/schema";
import { z } from "zod";
import {
  decideEstimateConfidence,
  detectPhase,
  findLatestStatedResume,
  findOnsetTime,
} from "../domain/phase.ts";
import type { EstimateToolResult, ToolContext } from "./types.ts";

export const EstimatePhaseInputSchema = z.object({
  eventType: z.string().nullable().describe("事象種別（知見の id）。特定できなければ null"),
});

export const estimatePhaseDefinition = {
  name: "estimate_phase_and_remaining",
  description:
    "観測された兆候と知見の exit_signals から現在の段階と段階の経過時間を決め、再開して乗れるまでの残り時間（p50, p80 分）をコードで計算する。発表された再開見込み時刻があれば優先する。",
  inputSchema: EstimatePhaseInputSchema,
} as const;

function buildUnknownEstimate(): EstimateToolResult {
  const estimate: Estimate = {
    eventType: null,
    phaseId: null,
    elapsedMinutes: null,
    remaining: null,
    confidence: "low",
  };
  return {
    estimate,
    phaseName: null,
    phaseGuidance: null,
    phaseStartedAt: null,
    statedResumeTime: null,
    statedExtended: false,
    remainingBasis: null,
    skippedPhaseIds: [],
    firstTrainWait: null,
    boardableP50: null,
    boardableP80: null,
  };
}

export function runEstimatePhase(
  ctx: ToolContext,
  input: z.infer<typeof EstimatePhaseInputSchema>,
): EstimateToolResult {
  const knowledge = input.eventType ? ctx.content.knowledge.get(input.eventType) : undefined;
  if (!knowledge) return buildUnknownEstimate();

  const now = ctx.request.now;
  const detection = detectPhase(knowledge, ctx.observations, now);
  const stated = findLatestStatedResume(ctx.observations);
  const statedIsFuture = stated !== null && parseIsoToMs(stated.time) > parseIsoToMs(now);
  const firstTrainWait = getFirstTrainWait(knowledge);
  // 知見の下限は発生からの分。発生は最初の観測の時刻とみなす
  const onsetAt = findOnsetTime(ctx.observations, now);
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

  return {
    estimate: {
      eventType: knowledge.id,
      phaseId: detection.phaseId,
      elapsedMinutes: detection.elapsedMinutes,
      remaining,
      confidence: decideEstimateConfidence({ detection, stated, statedIsFuture }),
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
  };
}
