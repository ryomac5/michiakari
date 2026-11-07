import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import type { BetaContentBlockParam } from "@anthropic-ai/sdk/resources/beta/messages/messages";
import { findIncidentType } from "@repo/core";
import {
  AnnouncementCueIdSchema,
  ConfidenceSchema,
  type EventTypeCandidate,
  MAX_INPUT_TEXT_LENGTH,
  ObservableKindSchema,
  type Observation,
  type RawInput,
  TrainTypeSchema,
} from "@repo/schema";
import { z } from "zod";
import { claudeSettings, models } from "../config.ts";
import type { LlmClient } from "../llm-client.ts";
import { buildIncidentCatalog, type Prompts } from "../prompts/load-prompts.ts";
import { resolveClockNearTime } from "./parse-text.ts";

// 写真・文章を Haiku で観測に変換する。出力は境界で Zod により検証し、core の表に無い id は捨てる

export const InterpretationSchema = z.object({
  kind: ObservableKindSchema.nullable(),
  trainsAhead: z.array(TrainTypeSchema).optional(),
  rawText: z.string(),
  eventTypeCandidates: z.array(z.object({ eventType: z.string(), confidence: ConfidenceSchema })),
  operator: z.string().nullable(),
  line: z.string().nullable(),
  section: z.object({ fromStation: z.string(), toStation: z.string() }).nullable(),
  statedResumeClock: z.string().nullable(),
  transferServiceActive: z.boolean().nullable(),
  transferOperators: z.array(z.string()).optional(),
  detectedCues: z.array(z.object({ cueId: z.string(), quote: z.string() })),
});
export type Interpretation = z.infer<typeof InterpretationSchema>;

export type ClaudeInterpretContext = {
  llm: LlmClient;
  prompts: Prompts;
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

// 種類は統計値の種類の id に直し、表に無いものと重なりを捨てる
function normalizeCandidates(
  candidates: Interpretation["eventTypeCandidates"],
): EventTypeCandidate[] {
  const seen = new Set<string>();
  return candidates.flatMap((c) => {
    const type = findIncidentType(c.eventType);
    if (!type || seen.has(type)) return [];
    seen.add(type);
    return [{ eventType: type, confidence: c.confidence }];
  });
}

// 表に無い種類と手がかりを捨てて Observation にする。手がかりは最初の候補の種類に結びつける
export function convertInterpretation(
  interpretation: Interpretation,
  input: InterpretableInput,
  ctx: Pick<ClaudeInterpretContext, "observationId" | "observedAt">,
): Observation {
  const kind = input.type === "scenario" ? input.kind : (interpretation.kind ?? undefined);
  const candidates = normalizeCandidates(interpretation.eventTypeCandidates);
  const eventType = candidates[0]?.eventType ?? null;
  return {
    id: ctx.observationId,
    observedAt: ctx.observedAt,
    source: input.type,
    ...(kind ? { kind } : {}),
    ...(kind === "train_movement" && interpretation.trainsAhead !== undefined
      ? { trainsAhead: interpretation.trainsAhead }
      : {}),
    // 原文の上限を超えた読み取りは切り詰める
    rawText: interpretation.rawText.slice(0, MAX_INPUT_TEXT_LENGTH),
    eventTypeCandidates: candidates,
    operator: interpretation.operator,
    line: interpretation.line,
    section: interpretation.section,
    statedResumeTime: parseClock(interpretation.statedResumeClock, ctx.observedAt),
    transferServiceActive: interpretation.transferServiceActive,
    transferOperators: interpretation.transferOperators ?? [],
    detectedSignals: eventType
      ? interpretation.detectedCues.flatMap((c) => {
          const cue = AnnouncementCueIdSchema.safeParse(c.cueId);
          return cue.success ? [{ eventType, signalId: cue.data, quote: c.quote }] : [];
        })
      : [],
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
          text: buildIncidentCatalog(),
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
