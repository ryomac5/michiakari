import {
  type Confidence,
  type DetectedSignal,
  type EventTypeCandidate,
  type Knowledge,
  type ObservableKind,
  type Observation,
  type RawInput,
  TrainTypeSchema,
} from "@repo/schema";
import type { LineInfo } from "../alternatives/provider.ts";
import {
  parseLine,
  parseSection,
  parseStatedResumeTime,
  parseTransferServiceActive,
} from "./parse-text.ts";
import {
  buildFragmentIndex,
  findQuote,
  matchIdentification,
  matchSignals,
  type SignalFragmentIndex,
} from "./text-match.ts";

// API を呼ばずに観測を解釈する。知見の文言との文字列照合で事象種別と兆候を当てる

export type InterpretContext = {
  knowledge: ReadonlyMap<string, Knowledge>;
  lines: readonly LineInfo[];
  // これまでの観測から決めた事象種別。新しい観測だけでは決まらないときに使う
  contextEventType: string | null;
  observationId: string;
  observedAt: string;
};

export type TextInput = {
  source: Observation["source"];
  kind: ObservableKind | undefined;
  text: string;
};

function buildIndexes(knowledge: ReadonlyMap<string, Knowledge>): SignalFragmentIndex[] {
  return [...knowledge.values()].map(buildFragmentIndex);
}

// 知見をまたいで 1 つの知見にしか現れない断片で当たった兆候の数を数える
function countGloballyDistinctMatches(
  indexes: SignalFragmentIndex[],
  text: string,
): Map<string, number> {
  const fragmentOwners = new Map<string, Set<string>>();
  for (const index of indexes) {
    for (const { fragment } of index.fragments) {
      fragmentOwners.set(
        fragment,
        (fragmentOwners.get(fragment) ?? new Set()).add(index.eventType),
      );
    }
  }
  const all = indexes.flatMap((index) => matchSignals(index, text));
  // 別の知見の長い断片に含まれる短い断片の一致は数えない
  const distinct = all.filter(
    (m) =>
      fragmentOwners.get(m.fragment)?.size === 1 &&
      !all.some(
        (o) =>
          o.eventType !== m.eventType &&
          o.fragment.length > m.fragment.length &&
          o.fragment.includes(m.fragment),
      ),
  );
  const counts = new Map<string, number>();
  for (const m of distinct) counts.set(m.eventType, (counts.get(m.eventType) ?? 0) + 1);
  return counts;
}

function identifyEventTypes(indexes: SignalFragmentIndex[], text: string): EventTypeCandidate[] {
  const identified = indexes.filter((i) => matchIdentification(i, text));
  if (identified.length > 0) {
    const confidence: Confidence = identified.length === 1 ? "high" : "medium";
    return identified.map((i) => ({ eventType: i.eventType, confidence }));
  }
  const counts = countGloballyDistinctMatches(indexes, text);
  const confidence: Confidence = counts.size === 1 ? "medium" : "low";
  return [...counts.keys()].map((eventType) => ({ eventType, confidence }));
}

export function interpretText(input: TextInput, ctx: InterpretContext): Observation {
  const indexes = buildIndexes(ctx.knowledge);
  const candidates = identifyEventTypes(indexes, input.text);
  const targets =
    candidates.length > 0 ? candidates.map((c) => c.eventType) : [ctx.contextEventType];

  const detectedSignals: DetectedSignal[] = [];
  for (const index of indexes) {
    if (!targets.includes(index.eventType)) continue;
    for (const m of matchSignals(index, input.text)) {
      detectedSignals.push({
        eventType: m.eventType,
        signalId: m.signalId,
        quote: findQuote(input.text, m.fragment),
      });
    }
  }

  const line = parseLine(input.text, ctx.lines);
  return {
    id: ctx.observationId,
    observedAt: ctx.observedAt,
    source: input.source,
    ...(input.kind ? { kind: input.kind } : {}),
    rawText: input.text,
    eventTypeCandidates: candidates,
    operator: line?.operator ?? null,
    line: line?.name ?? null,
    section: parseSection(input.text),
    statedResumeTime: parseStatedResumeTime(input.text, ctx.observedAt),
    transferServiceActive: parseTransferServiceActive(input.text),
    detectedSignals,
  };
}

// 選択式の入力は、選ばれた事象と兆候をそのまま観測にする
export function interpretSelection(
  input: Extract<RawInput, { type: "selection" }>,
  ctx: InterpretContext,
): Observation {
  const knowledge = ctx.knowledge.get(input.eventType);
  const signals = knowledge?.phases.flatMap((p) => p.signals) ?? [];
  return {
    id: ctx.observationId,
    observedAt: ctx.observedAt,
    source: "selection",
    eventTypeCandidates: knowledge ? [{ eventType: input.eventType, confidence: "high" }] : [],
    operator: null,
    line: null,
    section: null,
    statedResumeTime: null,
    transferServiceActive: null,
    detectedSignals: input.signalIds.flatMap((id) => {
      const signal = signals.find((s) => s.id === id);
      return signal
        ? [{ eventType: input.eventType, signalId: id, quote: signal.description }]
        : [];
    }),
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
