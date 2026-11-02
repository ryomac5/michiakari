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
    "待つ場合と代替手段の到着時刻を比べ、分岐点（この時刻までに再開しなければ代替手段のほうが早い境目）と比較表をコードで計算する。find_alternatives の後に呼ぶ。入力は不要。",
  inputSchema: ComputeBreakEvenInputSchema,
} as const;

export function runComputeBreakEven(
  ctx: ToolContext,
  estimate: EstimateToolResult,
  alternatives: AlternativesToolResult,
): BreakEvenToolResult {
  const deadline = ctx.request.constraints.deadline;
  if (alternatives.waitRouteMinutesAfterResume === null) {
    return { result: { kind: "no_route" }, comparison: [], basisOptionIds: [], deadline };
  }
  const computed = computeBreakEvenForOptions({
    now: ctx.request.now,
    remaining: estimate.estimate.remaining,
    waitRouteMinutesAfterResume: alternatives.waitRouteMinutesAfterResume,
    options: alternatives.options,
    deadline,
    firstTrainWaitMinutes: estimate.firstTrainWait?.p50 ?? null,
  });
  return { ...computed, deadline };
}
