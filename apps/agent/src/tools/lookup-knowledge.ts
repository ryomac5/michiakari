import { findPhasePaths } from "@repo/core";
import { IdSchema } from "@repo/schema";
import { z } from "zod";
import type { ToolContext, ToolState } from "./types.ts";

export const LookupKnowledgeInputSchema = z.object({
  eventType: IdSchema.describe("知見の id（事象種別）"),
});

export const lookupKnowledgeDefinition = {
  name: "lookup_knowledge",
  description:
    "元指令員の知見ナレッジから、事象種別の段階・兆候・所要時間の目安・利用者への提示方針を返す。判断の最初に呼ぶ。",
  inputSchema: LookupKnowledgeInputSchema,
} as const;

export function runLookupKnowledge(
  ctx: ToolContext,
  state: ToolState,
  input: z.infer<typeof LookupKnowledgeInputSchema>,
) {
  const knowledge = ctx.content.knowledge.get(input.eventType);
  if (!knowledge) {
    return {
      isError: true,
      content: {
        error: `知見がありません: ${input.eventType}`,
        knownEventTypes: [...ctx.content.knowledge.keys()],
      },
    };
  }
  if (!state.lookedUpKnowledge.includes(knowledge.id)) state.lookedUpKnowledge.push(knowledge.id);
  return {
    isError: false,
    content: {
      knowledge,
      // 段階が分岐する知見で、所要時間の p50 の合計が最短・最長になる段階の並び
      phasePathsFromFirst: (() => {
        const { shortest, longest } = findPhasePaths(knowledge, 0);
        const toIds = (path: number[]) => path.map((i) => knowledge.phases[i]?.id);
        return { shortest: toIds(shortest), longest: toIds(longest) };
      })(),
    },
  };
}
