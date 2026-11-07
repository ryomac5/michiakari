import { findIncidentType, resolveIncidentType } from "@repo/core";
import {
  AnnouncementCueIdSchema,
  type DetectedSignal,
  type ObservableKind,
  type Observation,
  type RawInput,
  TrainTypeSchema,
} from "@repo/schema";
import type { LineInfo } from "../alternatives/provider.ts";
import { findIncidentGroup } from "../domain/incident.ts";
import {
  parseLine,
  parseSection,
  parseStatedResumeTime,
  parseTransferOperators,
  parseTransferServiceActive,
} from "./parse-text.ts";
import { matchCueSentences, matchIncidentPhrase } from "./text-match.ts";

// API を呼ばずに観測を解釈する。core の呼び名の表で起きていることの種類を、手がかりの表で放送の手がかりを当てる

export type InterpretContext = {
  lines: readonly LineInfo[];
  // これまでの観測から決めた事象の種類。新しい観測だけでは決まらないときに使う
  contextEventType: string | null;
  observationId: string;
  observedAt: string;
};

export type TextInput = {
  source: Observation["source"];
  kind: ObservableKind | undefined;
  text: string;
};

// 手がかりは、この観測かこれまでの観測で決まった種類に結びつける。種類が決まらなければ入れない
// 種類が無くても、原文が残るので判断は手がかりを拾える
function buildCueSignals(text: string, eventType: string | null): DetectedSignal[] {
  if (!eventType) return [];
  return matchCueSentences(text).map((m) => ({ eventType, signalId: m.cueId, quote: m.quote }));
}

export function interpretText(input: TextInput, ctx: InterpretContext): Observation {
  const phrase = matchIncidentPhrase(input.text);
  const eventType = phrase?.type ?? findIncidentType(ctx.contextEventType);
  const line = parseLine(input.text, ctx.lines);
  return {
    id: ctx.observationId,
    observedAt: ctx.observedAt,
    source: input.source,
    ...(input.kind ? { kind: input.kind } : {}),
    rawText: input.text,
    // 呼び名がそのまま書かれているので確信度は高い
    eventTypeCandidates: phrase ? [{ eventType: phrase.type, confidence: "high" }] : [],
    operator: line?.operator ?? null,
    line: line?.name ?? null,
    section: parseSection(input.text),
    statedResumeTime: parseStatedResumeTime(input.text, ctx.observedAt),
    transferServiceActive: parseTransferServiceActive(input.text),
    transferOperators: parseTransferOperators(input.text),
    detectedSignals: buildCueSignals(input.text, eventType),
  };
}

// 選択式の入力は、選ばれた種類と手がかりをそのまま観測にする。引用は無いので空にする
// 種類が 1 つに決まらない原因は統計値の大分類の id で届くので、大分類の候補として残す
export function interpretSelection(
  input: Extract<RawInput, { type: "selection" }>,
  ctx: InterpretContext,
): Observation {
  const eventType =
    resolveIncidentType({ eventType: input.eventType }) ?? findIncidentGroup(input.eventType);
  const cues = input.signalIds.flatMap((id) => {
    const parsed = AnnouncementCueIdSchema.safeParse(id);
    return parsed.success ? [parsed.data] : [];
  });
  return {
    id: ctx.observationId,
    observedAt: ctx.observedAt,
    source: "selection",
    eventTypeCandidates: eventType ? [{ eventType, confidence: "high" }] : [],
    operator: null,
    line: null,
    section: null,
    statedResumeTime: null,
    transferServiceActive: null,
    detectedSignals: eventType ? cues.map((signalId) => ({ eventType, signalId, quote: "" })) : [],
  };
}

// 決定論モードの画像 fixture は fixture-train-movement--rapid+local.png の名前で並びを指定する
function interpretPhotoFixture(
  input: Extract<RawInput, { type: "photo" }>,
  ctx: InterpretContext,
): Observation | null {
  const match = input.fileName?.match(/^fixture-train-movement--([a-z_+]+)\.(?:png|jpe?g|webp)$/);
  if (!match) return null;
  const parsed = TrainTypeSchema.array().safeParse(match[1] === "none" ? [] : match[1]?.split("+"));
  if (!parsed.success) return null;
  return {
    ...interpretText({ source: "photo", kind: "train_movement", text: "" }, ctx),
    trainsAhead: parsed.data,
  };
}

// fixture 以外の写真は API キーが無いと読めないので null
export function interpretRawInputDeterministically(
  input: RawInput,
  ctx: InterpretContext,
): Observation | null {
  switch (input.type) {
    case "photo":
      return interpretPhotoFixture(input, ctx);
    case "selection":
      return interpretSelection(input, ctx);
    case "text":
      return interpretText({ source: "text", kind: undefined, text: input.text }, ctx);
    case "scenario":
      return interpretText({ source: "scenario", kind: input.kind, text: input.text.ja }, ctx);
  }
}
