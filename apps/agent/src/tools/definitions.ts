import type { BetaTool } from "@anthropic-ai/sdk/resources/beta/messages/messages";
import { z } from "zod";
import { computeBreakEvenDefinition } from "./compute-break-even.ts";
import { emitJudgmentDefinition } from "./emit-judgment.ts";
import { estimateRemainingDefinition } from "./estimate-remaining.ts";
import { findAlternativesDefinition } from "./find-alternatives.ts";
import { getWeatherDefinition } from "./get-weather.ts";

// Claude に渡すツール定義。入力スキーマは Zod から生成する。順序を固定してプロンプトキャッシュを効かせる

const TOOL_DEFINITIONS = [
  getWeatherDefinition,
  estimateRemainingDefinition,
  findAlternativesDefinition,
  computeBreakEvenDefinition,
  emitJudgmentDefinition,
] as const;

export type ToolName = (typeof TOOL_DEFINITIONS)[number]["name"];

export const TOOL_NAMES = TOOL_DEFINITIONS.map((d) => d.name);

export function isToolName(name: string): name is ToolName {
  return (TOOL_NAMES as readonly string[]).includes(name);
}

function convertToInputSchema(schema: z.ZodType): BetaTool.InputSchema {
  const { $schema: _ignored, ...json } = z.toJSONSchema(schema, { io: "input" }) as Record<
    string,
    unknown
  >;
  return { ...json, type: "object" };
}

export function buildClaudeTools(): BetaTool[] {
  return TOOL_DEFINITIONS.map((d) => ({
    name: d.name,
    description: d.description,
    input_schema: convertToInputSchema(d.inputSchema),
  }));
}
