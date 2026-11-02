import type { BreakEven, Evidence, Lang, ProgressStage } from "@repo/schema";
import type { z } from "zod";
import { selectEventType } from "../domain/phase.ts";
import { ComputeBreakEvenInputSchema, runComputeBreakEven } from "../tools/compute-break-even.ts";
import { EstimatePhaseInputSchema, runEstimatePhase } from "../tools/estimate-phase.ts";
import { FindAlternativesInputSchema, runFindAlternatives } from "../tools/find-alternatives.ts";
import { GetWeatherInputSchema, runGetWeather } from "../tools/get-weather.ts";
import { LookupKnowledgeInputSchema, runLookupKnowledge } from "../tools/lookup-knowledge.ts";
import {
  type AlternativesToolResult,
  type BreakEvenToolResult,
  createToolState,
  type EstimateToolResult,
  type ToolContext,
  type ToolState,
  type WeatherToolResult,
} from "../tools/types.ts";
import { collectAllowedNumbers, type JudgmentToolResults, validateJudgment } from "./assemble.ts";
import type { EventSink, JudgmentEventBody } from "./event-sink.ts";
import {
  buildBreakEvenSentence,
  buildNoAlternativeSentence,
  buildPassedSentence,
  buildProgressMessage,
  buildWeatherSummary,
  formatClock,
} from "./templates.ts";

// 1 回の判断の状態。ツールの実行と、その結果に対応する判断イベントの送出を受け持つ
// 両モードが同じ実装を使う。各ツールは最初の成功で確定し、呼び直しには確定済みの結果を返す

export type ToolOutcome = { isError: boolean; content: unknown };

export type JudgeSession = {
  ctx: ToolContext;
  state: ToolState;
  executeTool(name: string, input: unknown): Promise<ToolOutcome>;
  collectEvidenceRefs(): Evidence[];
  // 判断結果を検査する。根拠と文中の数値はこの判断のツールの結果と照らす
  checkJudgment(
    judgment: unknown,
    results: JudgmentToolResults,
  ): ReturnType<typeof validateJudgment>;
  // 途中経過を送る。段階を渡すと定型文を使う
  emitProgress(stage: ProgressStage | undefined, message?: string): Promise<void>;
  // 兆候のイベントで使う事象種別（観測の候補から決める）
  inferredEventType: string | null;
};

// 英語の利用者向けの兆候の根拠。知見の説明は日本語だけなので、引用・段階の英語名・兆候 id で組み立てる
export function buildSignalEvidenceEn(
  signalId: string,
  quote: string,
  phaseName: string | undefined,
): string {
  const phase = phaseName ? ` in the "${phaseName}" phase` : "";
  return `Signal "${signalId}"${phase}, observed in the announcement: "${quote}"`;
}

function formatOptional(iso: string | null, language: Lang): string | null {
  return iso ? formatClock(iso, language) : null;
}

function presentEstimate(r: EstimateToolResult, language: Lang) {
  return {
    ...r,
    labels: {
      phaseStartedAt: formatOptional(r.phaseStartedAt, language),
      statedResumeTime: formatOptional(r.statedResumeTime, language),
      boardableP50: formatOptional(r.boardableP50, language),
      boardableP80: formatOptional(r.boardableP80, language),
    },
  };
}

function presentAlternatives(r: AlternativesToolResult, language: Lang) {
  return {
    ...r,
    options: r.options.map((o) => ({ ...o, arrivalLabel: formatClock(o.arrivalTime, language) })),
  };
}

function findOptionLabel(alternatives: AlternativesToolResult | null, id: string): string {
  return alternatives?.options.find((o) => o.id === id)?.label ?? id;
}

// break_even_computed で送る分岐点。説明は定型文で、確定した判断では Claude の説明に置き換わる
export function buildComputedBreakEven(
  breakEven: BreakEvenToolResult,
  alternatives: AlternativesToolResult | null,
  language: Lang,
): BreakEven | null {
  const r = breakEven.result;
  if (r.kind === "no_route" || r.kind === "no_alternative") return null;
  const label = findOptionLabel(alternatives, r.bestAlternativeId);
  const explanation =
    r.kind === "passed"
      ? buildPassedSentence(r.time, label, language)
      : buildBreakEvenSentence(r.time, label, language);
  return { time: r.time, explanation };
}

function presentBreakEven(
  r: BreakEvenToolResult,
  alternatives: AlternativesToolResult | null,
  language: Lang,
) {
  const result = r.result;
  if (result.kind === "no_route" || result.kind === "no_alternative") {
    return { ...r, explanationTemplate: buildNoAlternativeSentence(language) };
  }
  return {
    ...r,
    labels: {
      breakEvenTime: formatClock(result.time, language),
      bestAlternative: findOptionLabel(alternatives, result.bestAlternativeId),
      bestAlternativeArrival: formatClock(result.bestAlternativeArrival, language),
      boardableP50: result.resumeOutlook
        ? formatClock(result.resumeOutlook.resumeP50, language)
        : null,
      boardableP80: result.resumeOutlook
        ? formatClock(result.resumeOutlook.resumeP80, language)
        : null,
      deadline: formatOptional(r.deadline, language),
    },
    explanationTemplate: buildComputedBreakEven(r, alternatives, language)?.explanation ?? null,
  };
}

// weather_checked で送る気象。取得できなかったとき、値が無いときは送らない
// リプレイの雨量は get_weather が現在時刻までに絞っているので、未来の値は含まない
export function buildWeatherCheckedEvent(
  r: WeatherToolResult,
  language: Lang,
): JudgmentEventBody | null {
  if (r.source === "unavailable" || r.readings.length === 0) return null;
  const warnings = r.readings.at(-1)?.warnings ?? [];
  const trend = r.summary.trend ?? "unknown";
  return {
    type: "weather_checked",
    source: r.source === "scenario" ? "scenario" : "jma",
    readings: r.readings.map((reading) => ({
      time: reading.time,
      rainfall10minMm: reading.rainfall10minMm,
    })),
    warnings,
    trend,
    summary: buildWeatherSummary({
      latestMm: r.summary.latest?.rainfall10minMm ?? null,
      trend,
      warnings,
      language,
    }),
  };
}

function presentWeather(r: WeatherToolResult) {
  return { ...r, attribution: "出典: 気象庁" };
}

export function createJudgeSession(ctx: ToolContext, sink: EventSink): JudgeSession {
  const state = createToolState();
  const language = ctx.request.language;
  const inferredEventType = selectEventType(ctx.observations, ctx.content.knowledge);

  function parseInput<S extends z.ZodType>(schema: S, input: unknown): z.infer<S> | ToolOutcome {
    const parsed = schema.safeParse(input ?? {});
    if (parsed.success) return parsed.data;
    return {
      isError: true,
      content: { error: "入力がスキーマに合いません", issues: parsed.error.issues },
    };
  }

  const isOutcome = (v: unknown): v is ToolOutcome =>
    typeof v === "object" && v !== null && "isError" in v && "content" in v;

  const cached = (content: unknown): ToolOutcome => ({
    isError: false,
    content: { note: "この判断では確定済みです。前回の結果を返します", result: content },
  });

  async function runEstimate(input: unknown): Promise<ToolOutcome> {
    if (state.estimate) return cached(presentEstimate(state.estimate, language));
    const parsed = parseInput(EstimatePhaseInputSchema, input);
    if (isOutcome(parsed)) return parsed;
    const result = runEstimatePhase(ctx, parsed);
    state.estimate = result;
    await sink.emit({ type: "phase_estimated", estimate: result.estimate });
    return { isError: false, content: presentEstimate(result, language) };
  }

  async function runAlternatives(input: unknown): Promise<ToolOutcome> {
    if (state.alternatives) return cached(presentAlternatives(state.alternatives, language));
    if (!state.estimate) {
      return {
        isError: true,
        content: { error: "先に estimate_phase_and_remaining を呼んでください" },
      };
    }
    const parsed = parseInput(FindAlternativesInputSchema, input);
    if (isOutcome(parsed)) return parsed;
    const result = await runFindAlternatives(ctx, state.estimate, parsed);
    state.alternatives = result;
    await sink.emit({ type: "alternatives_computed", options: result.options });
    return { isError: false, content: presentAlternatives(result, language) };
  }

  async function runBreakEven(input: unknown): Promise<ToolOutcome> {
    if (state.breakEven)
      return cached(presentBreakEven(state.breakEven, state.alternatives, language));
    if (!state.estimate || !state.alternatives) {
      return {
        isError: true,
        content: {
          error: "先に estimate_phase_and_remaining と find_alternatives を呼んでください",
        },
      };
    }
    const parsed = parseInput(ComputeBreakEvenInputSchema, input);
    if (isOutcome(parsed)) return parsed;
    const result = runComputeBreakEven(ctx, state.estimate, state.alternatives);
    state.breakEven = result;
    await sink.emit({
      type: "break_even_computed",
      breakEven: buildComputedBreakEven(result, state.alternatives, language),
    });
    return { isError: false, content: presentBreakEven(result, state.alternatives, language) };
  }

  async function runWeather(input: unknown): Promise<ToolOutcome> {
    if (state.weather) return cached(presentWeather(state.weather));
    const parsed = parseInput(GetWeatherInputSchema, input);
    if (isOutcome(parsed)) return parsed;
    state.weather = await runGetWeather(ctx, parsed);
    const event = buildWeatherCheckedEvent(state.weather, language);
    if (event) await sink.emit(event);
    return { isError: false, content: presentWeather(state.weather) };
  }

  async function emitProgress(stage: ProgressStage | undefined, message?: string): Promise<void> {
    const text = message ?? (stage ? buildProgressMessage(stage, language) : "");
    if (text.length === 0) return;
    await sink.emit({ type: "progress", message: text, ...(stage ? { stage } : {}) });
  }

  // 確定済みでないツールを始めるときに、その段階の開始を知らせる
  async function announceToolStart(name: string): Promise<void> {
    const pending: Record<string, ProgressStage | null> = {
      lookup_knowledge: "knowledge",
      get_weather: state.weather ? null : "weather",
      estimate_phase_and_remaining: state.estimate ? null : "phase",
      find_alternatives: state.alternatives || !state.estimate ? null : "alternatives",
      compute_break_even: state.breakEven || !state.alternatives ? null : "break_even",
    };
    const stage = pending[name];
    if (stage) await emitProgress(stage);
  }

  async function executeTool(name: string, input: unknown): Promise<ToolOutcome> {
    await announceToolStart(name);
    switch (name) {
      case "lookup_knowledge": {
        const parsed = parseInput(LookupKnowledgeInputSchema, input);
        return isOutcome(parsed) ? parsed : runLookupKnowledge(ctx, state, parsed);
      }
      case "get_weather":
        return runWeather(input);
      case "estimate_phase_and_remaining":
        return runEstimate(input);
      case "find_alternatives":
        return runAlternatives(input);
      case "compute_break_even":
        return runBreakEven(input);
      default:
        return { isError: true, content: { error: `未知のツールです: ${name}` } };
    }
  }

  // 根拠として挙げてよい項目。Claude の根拠はこの中から選ばせる
  function collectEvidenceRefs(): Evidence[] {
    const refs: Evidence[] = [];
    const eventType = state.estimate?.estimate.eventType ?? null;
    const knowledge = eventType ? ctx.content.knowledge.get(eventType) : undefined;
    if (knowledge) {
      const seen = new Set<string>();
      for (const o of ctx.observations) {
        for (const s of o.detectedSignals) {
          if (s.eventType !== knowledge.id || seen.has(s.signalId)) continue;
          seen.add(s.signalId);
          const phase = knowledge.phases.find((p) => p.signals.some((k) => k.id === s.signalId));
          const known = phase?.signals.find((k) => k.id === s.signalId);
          refs.push({
            kind: "signal",
            id: s.signalId,
            description:
              language === "en"
                ? buildSignalEvidenceEn(s.signalId, s.quote, phase?.name.en ?? phase?.name.ja)
                : `${known?.description ?? s.quote}「${s.quote}」`,
          });
        }
      }
      refs.push({
        kind: "knowledge",
        id: knowledge.id,
        description: knowledge.summary[language] ?? knowledge.summary.ja,
      });
      const phase = knowledge.phases.find((p) => p.id === state.estimate?.estimate.phaseId);
      if (phase) {
        refs.push({
          kind: "knowledge",
          id: phase.id,
          description: phase.guidance[language] ?? phase.guidance.ja,
        });
      }
    }
    if (state.weather && state.weather.readings.length > 0) {
      const latest = state.weather.summary.latest;
      const ja = language === "ja";
      const detail = latest
        ? ja
          ? `${formatClock(latest.time, language)}の10分雨量 ${latest.rainfall10minMm}mm${latest.warnings.length > 0 ? `、${latest.warnings.join("・")}` : ""}（出典: 気象庁）`
          : `10-min rainfall at ${formatClock(latest.time, language)}: ${latest.rainfall10minMm} mm${latest.warnings.length > 0 ? `, ${latest.warnings.join(", ")}` : ""} (source: JMA)`
        : "";
      refs.push({ kind: "weather", id: "weather", description: detail });
    }
    if (state.estimate?.estimate.remaining) {
      const r = state.estimate.estimate.remaining;
      refs.push({
        kind: "computation",
        id: "remaining",
        description:
          language === "ja"
            ? `再開して乗れるまで p50 ${r.p50}分・p80 ${r.p80}分`
            : `Until a boardable train: p50 ${r.p50} min, p80 ${r.p80} min`,
      });
    }
    if (state.alternatives && state.alternatives.options.length > 1) {
      refs.push({
        kind: "computation",
        id: "alternatives",
        description: language === "ja" ? "代替手段の到着時刻の比較" : "Comparison of arrival times",
      });
    }
    const be = state.breakEven
      ? buildComputedBreakEven(state.breakEven, state.alternatives, language)
      : null;
    if (be) refs.push({ kind: "computation", id: "break_even", description: be.explanation });
    return refs;
  }

  function checkJudgment(judgment: unknown, results: JudgmentToolResults) {
    const evidenceRefs = collectEvidenceRefs();
    const eventType = results.estimate.estimate.eventType;
    const allowedNumbers = collectAllowedNumbers({
      results,
      observations: ctx.observations,
      now: ctx.request.now,
      knowledge: eventType ? (ctx.content.knowledge.get(eventType) ?? null) : null,
      evidenceRefs,
    });
    return validateJudgment({ judgment, evidenceRefs, allowedNumbers, language });
  }

  return {
    ctx,
    state,
    executeTool,
    collectEvidenceRefs,
    checkJudgment,
    emitProgress,
    inferredEventType,
  };
}
