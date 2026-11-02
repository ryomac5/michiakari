import { JudgmentSchema } from "@repo/schema";
import { z } from "zod";
import { headlineLimits } from "../config.ts";

// 判断の確定。Claude が決めるのは行動・結論の一言・分岐点の説明・推奨・根拠だけで、数値は入れない

const { ja, en } = headlineLimits;

export const DecisionSchema = JudgmentSchema.pick({
  action: true,
  headline: true,
  recommendedOptionId: true,
  evidence: true,
}).extend({
  headline: JudgmentSchema.shape.headline.describe(
    `結論カードに大きく出る一言。結論だけを書き、理由や経緯は入れない。日本語は ${ja.target} 字程度で上限 ${ja.max} 字、英語は ${en.target} 文字程度で上限 ${en.max} 文字。例: 「いま振替に切り替えてください」「あと25分は待てます」「まだ判断できません。分岐点を見てください」`,
  ),
  breakEvenExplanation: z
    .string()
    .describe(
      "判断の理由を一文で書き、続けて分岐点の意味を「◯時◯分までに再開しなければ、◯◯のほうが早く着きます」の形で書く",
    ),
});
export type Decision = z.infer<typeof DecisionSchema>;

export const emitJudgmentDefinition = {
  name: "emit_judgment",
  description: `判断を確定する。最後に一度だけ呼ぶ。数値（残り時間・分岐点の時刻・到着時刻・運賃）はサーバーがツールの結果から組み立てるので入れない。時刻を文に書くときはツールの結果の表示をそのまま使う。headline が上限（日本語 ${ja.max} 字、英語 ${en.max} 文字）を超えると検証エラーになる。検証に失敗したらエラーが返るので、直して呼び直す。`,
  inputSchema: DecisionSchema,
} as const;
