import { JudgmentSchema } from "@repo/schema";
import { z } from "zod";

// 判断の確定。Claude が決めるのは行動・結論の一文・分岐点の説明・推奨・根拠だけで、数値は入れない

export const DecisionSchema = JudgmentSchema.pick({
  action: true,
  headline: true,
  recommendedOptionId: true,
  evidence: true,
}).extend({
  breakEvenExplanation: z
    .string()
    .describe("分岐点の意味の説明。「◯時◯分までに再開しなければ、◯◯のほうが早く着きます」の形"),
});
export type Decision = z.infer<typeof DecisionSchema>;

export const emitJudgmentDefinition = {
  name: "emit_judgment",
  description:
    "判断を確定する。最後に一度だけ呼ぶ。数値（残り時間・分岐点の時刻・到着時刻・運賃）はサーバーがツールの結果から組み立てるので入れない。時刻を文に書くときはツールの結果の表示をそのまま使う。検証に失敗したらエラーが返るので、直して呼び直す。",
  inputSchema: DecisionSchema,
} as const;
