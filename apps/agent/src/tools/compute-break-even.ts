import { computeResumeChance } from "@repo/core";
import type { ResumeChance } from "@repo/schema";
import { z } from "zod";
import { computeBreakEvenForOptions } from "../domain/break-even.ts";
import type {
  AlternativesToolResult,
  BreakEvenToolResult,
  EstimateToolResult,
  ToolContext,
} from "./types.ts";

export const ComputeBreakEvenInputSchema = z.object({});

export const computeBreakEvenDefinition = {
  name: "compute_break_even",
  description:
    "待つ場合と代替手段の到着時刻を比べ、分岐点（この時刻までに再開しなければ代替手段のほうが早い境目）と比較表をコードで計算する。あわせて resumeChance として、待ったほうが早く着く確率（waitFaster）、待って期限に間に合う確率（waitOnTime）、切りのよい時刻ごとに動いている確率（ticks）を 1 割単位で返す。確率は labels.resumeChance の表示をそのまま文に写し、自分で計算しない。find_alternatives の後に呼ぶ。入力は不要。",
  inputSchema: ComputeBreakEvenInputSchema,
} as const;

// 時刻ごとの再開の見込みと、待ったほうが早く着く確率。残り時間の標本が無ければ null
// 代替手段の到着は決まった値として扱い、待った場合の到着だけがばらつく（docs/architecture.md 2.4）
function buildResumeChance(
  ctx: ToolContext,
  estimate: EstimateToolResult,
  alternatives: AlternativesToolResult,
  result: BreakEvenToolResult["result"],
): ResumeChance | null {
  const samples = estimate.remainingSamples ?? null;
  if (!samples || samples.length === 0) return null;
  const breakEven = result.kind === "future" || result.kind === "passed" ? result : null;
  return computeResumeChance({
    now: ctx.request.now,
    samples,
    firstTrainWaitMinutes: estimate.firstTrainWait?.p50 ?? 0,
    waitRouteMinutesAfterResume: alternatives.waitRouteMinutesAfterResume,
    bestAlternativeArrival: breakEven?.bestAlternativeArrival ?? null,
    breakEvenTime: breakEven?.time ?? null,
    deadline: ctx.request.constraints.deadline,
    onsetTime: estimate.onsetTime ?? null,
  });
}

export function runComputeBreakEven(
  ctx: ToolContext,
  estimate: EstimateToolResult,
  alternatives: AlternativesToolResult,
): BreakEvenToolResult {
  const deadline = ctx.request.constraints.deadline;
  if (alternatives.waitRouteMinutesAfterResume === null) {
    const result = { kind: "no_route" } as const;
    return {
      result,
      comparison: [],
      basisOptionIds: [],
      deadline,
      resumeChance: buildResumeChance(ctx, estimate, alternatives, result),
    };
  }
  const computed = computeBreakEvenForOptions({
    now: ctx.request.now,
    remaining: estimate.estimate.remaining,
    waitRouteMinutesAfterResume: alternatives.waitRouteMinutesAfterResume,
    options: alternatives.options,
    deadline,
    firstTrainWaitMinutes: estimate.firstTrainWait?.p50 ?? null,
  });
  return {
    ...computed,
    deadline,
    resumeChance: buildResumeChance(ctx, estimate, alternatives, computed.result),
  };
}
