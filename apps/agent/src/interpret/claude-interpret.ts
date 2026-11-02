import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import type { BetaContentBlockParam } from "@anthropic-ai/sdk/resources/beta/messages/messages";
import {
  ConfidenceSchema,
  type Knowledge,
  MAX_INPUT_TEXT_LENGTH,
  ObservableKindSchema,
  type Observation,
  type RawInput,
} from "@repo/schema";
import { z } from "zod";
import { claudeSettings, models } from "../config.ts";
import type { LlmClient } from "../llm-client.ts";
import { buildKnowledgeCatalog, type Prompts } from "../prompts/load-prompts.ts";
import { resolveClockNearTime } from "./parse-text.ts";

// 写真・文章を Haiku で観測に変換する。出力は境界で Zod により検証し、知見に無い id は捨てる

export const InterpretationSchema = z.object({
  kind: ObservableKindSchema.nullable(),
  rawText: z.string(),
  eventTypeCandidates: z.array(z.object({ eventType: z.string(), confidence: ConfidenceSchema })),
  operator: z.string().nullable(),
  line: z.string().nullable(),
  section: z.object({ fromStation: z.string(), toStation: z.string() }).nullable(),
  statedResumeClock: z.string().nullable(),
  transferServiceActive: z.boolean().nullable(),
  detectedSignals: z.array(
    z.object({ eventType: z.string(), signalId: z.string(), quote: z.string() }),
  ),
});
export type Interpretation = z.infer<typeof InterpretationSchema>;

export type ClaudeInterpretContext = {
  llm: LlmClient;
  prompts: Prompts;
  knowledge: ReadonlyMap<string, Knowledge>;
  observationId: string;
  observedAt: string;
  signal?: AbortSignal;
};

type InterpretableInput = Exclude<RawInput, { type: "selection" }>;

function buildUserContent(input: InterpretableInput, observedAt: string): BetaContentBlockParam[] {
  const header = `<observed_at>${observedAt}</observed_at>`;
  if (input.type === "photo") {
    return [
      {
        type: "image",
        source: { type: "base64", media_type: input.mediaType, data: input.imageBase64 },
      },
      {
        type: "text",
        text: `${header}\n<user_input>上の画像</user_input>\n画像の掲示・画面を観測として読み取ってください。`,
      },
    ];
  }
  const text = input.type === "text" ? input.text : input.text.ja;
  return [
    {
      type: "text",
      text: `${header}\n<user_input>\n${text}\n</user_input>\n上の文章を観測として読み取ってください。`,
    },
  ];
}

function parseClock(clock: string | null, observedAt: string): string | null {
  const m = clock?.match(/^(\d{1,2}):(\d{2})$/);
  return m ? resolveClockNearTime(Number(m[1]), Number(m[2]), observedAt) : null;
}

// 知見に無い事象種別と兆候を捨てて Observation にする
export function convertInterpretation(
  interpretation: Interpretation,
  input: InterpretableInput,
  ctx: Pick<ClaudeInterpretContext, "knowledge" | "observationId" | "observedAt">,
): Observation {
  const signalIds = (eventType: string) =>
    new Set(ctx.knowledge.get(eventType)?.phases.flatMap((p) => p.signals.map((s) => s.id)) ?? []);
  const kind = input.type === "scenario" ? input.kind : (interpretation.kind ?? undefined);
  return {
    id: ctx.observationId,
    observedAt: ctx.observedAt,
    source: input.type,
    ...(kind ? { kind } : {}),
    // 原文の上限を超えた読み取りは切り詰める
    rawText: interpretation.rawText.slice(0, MAX_INPUT_TEXT_LENGTH),
    eventTypeCandidates: interpretation.eventTypeCandidates.filter((c) =>
      ctx.knowledge.has(c.eventType),
    ),
    operator: interpretation.operator,
    line: interpretation.line,
    section: interpretation.section,
    statedResumeTime: parseClock(interpretation.statedResumeClock, ctx.observedAt),
    transferServiceActive: interpretation.transferServiceActive,
    detectedSignals: interpretation.detectedSignals.filter((s) =>
      signalIds(s.eventType).has(s.signalId),
    ),
  };
}

export async function interpretWithClaude(
  input: InterpretableInput,
  ctx: ClaudeInterpretContext,
): Promise<Observation> {
  const response = await ctx.llm.createMessage(
    {
      model: models.interpretation,
      max_tokens: claudeSettings.interpretationMaxTokens,
      system: [
        { type: "text", text: ctx.prompts.interpretationSystem },
        {
          type: "text",
          text: buildKnowledgeCatalog(ctx.knowledge),
          cache_control: { type: "ephemeral" },
        },
      ],
      messages: [{ role: "user", content: buildUserContent(input, ctx.observedAt) }],
      output_config: {
        effort: claudeSettings.interpretationEffort,
        format: betaZodOutputFormat(InterpretationSchema),
      },
    },
    ctx.signal ? { signal: ctx.signal } : undefined,
  );
  if (response.stop_reason !== "end_turn") {
    throw new Error(`解釈が完了しませんでした: ${response.stop_reason}`);
  }
  const text = response.content.flatMap((b) => (b.type === "text" ? [b.text] : [])).join("");
  const interpretation = InterpretationSchema.parse(JSON.parse(text));
  return convertInterpretation(interpretation, input, ctx);
}
