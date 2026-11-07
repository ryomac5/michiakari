import { JudgmentSchema } from "@repo/schema";
import { z } from "zod";
import { headlineLimits, reasonLimits } from "../config.ts";

// 判断の確定。Claude が決めるのは行動・結論の一言・理由・分岐点の説明・推奨・根拠だけで、数値は入れない

const { ja, en } = headlineLimits;

export const DecisionSchema = JudgmentSchema.pick({
  action: true,
  headline: true,
  recommendedOptionId: true,
  evidence: true,
}).extend({
  headline: JudgmentSchema.shape.headline.describe(
    `結論カードに大きく出る一言。1 文目は行動で、どの路線にどこから乗るか、または境目の時刻まで待つと言い切る。待つときは 2 文目に動かなかったときの次の手を書く。理由や経緯は入れない。1 文目は日本語 ${ja.target} 字程度、英語 ${en.target} 文字程度。全体の上限は日本語 ${ja.max} 字、英語 ${en.max} 文字。例: 「大阪梅田まで歩いて阪急京都線へ」「阪急京都線に乗り換える」「20時05分まで待つ。動かなければ阪急京都線へ」。駅間の車内の利用者は降りられないので「車内で待つ。動くのは21時40分ごろの見込み」の形にし、切り替えを書かない。判断しない旨の言い回しは書かない`,
  ),
  reason: z
    .string()
    .min(1)
    .describe(
      `結論の理由。画面は先頭の1文を見出しの下に出す。1文1主張にする。先頭は日本語25字前後、英語60文字前後で、なぜその行動かを言う。括弧で補足せず読点で節を足さない。2文目からは再開見込みと境目などの比較を書く。利用者向けの文では分岐点を「境目」、英語は cutoff と書く。日本語は ${reasonLimits.ja.target} 字程度で上限 ${reasonLimits.ja.max} 字、英語は ${reasonLimits.en.target} 文字程度で上限 ${reasonLimits.en.max} 文字。です・ます調で書き、時刻には「ごろ」を付ける。「境目より後です」のように境目という言葉だけで比べた結果を言わず、待つ場合と比べてどちらが早く着くかで書く。例: 「待つより阪急京都線のほうが早く着きます。再開は23時40分ごろの見込みです。」「21時05分を過ぎると阪急京都線のほうが早く着きます。」`,
    ),
  breakEvenExplanation: z
    .string()
    .describe(
      "compute_break_even の explanationTemplate をそのまま使う。多くは「◯時◯分までに再開すれば◯時◯分着の◯◯より待つほうが早く着きます。」の形。期限が理由のときや過ぎた境目もテンプレートに従う。理由は reason に分ける",
    ),
});
export type Decision = z.infer<typeof DecisionSchema>;

export const emitJudgmentDefinition = {
  name: "emit_judgment",
  description: `判断を確定する。最後に一度だけ呼ぶ。駅間の車内の利用者には action を wait、recommendedOptionId を null にし、切り替えを勧めると検証エラーになる。止まり方が train の事象では「見合わせ」と書くと検証エラーになる。どちらも見出し・理由・境目の説明・根拠の説明のすべてを検査する。evidence の kind と id は compute_break_even の evidenceChoices にある組だけを使い、一覧が空なら空の配列にする。数値（残り時間・分岐点の時刻・到着時刻・運賃）はサーバーがツールの結果から組み立てるので入れない。時刻を文に書くときはツールの結果の表示をそのまま使う。headline が上限（日本語 ${ja.max} 字、英語 ${en.max} 文字）を、reason が上限（日本語 ${reasonLimits.ja.max} 字、英語 ${reasonLimits.en.max} 文字）を超えると検証エラーになる。検証に失敗したらエラーが返るので、直して呼び直す。`,
  inputSchema: DecisionSchema,
} as const;
