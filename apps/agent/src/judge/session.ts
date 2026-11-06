import { resolveStopScope, type StopScope } from "@repo/core";
import type {
  BreakEven,
  Evidence,
  InCarGuide,
  Lang,
  ProgressStage,
  ResumeChance,
} from "@repo/schema";
import type { z } from "zod";
import { selectEventType } from "../domain/phase.ts";
import { ComputeBreakEvenInputSchema, runComputeBreakEven } from "../tools/compute-break-even.ts";
import { EstimatePhaseInputSchema, runEstimatePhase } from "../tools/estimate-phase.ts";
import {
  FindAlternativesInputSchema,
  findAnnouncedSection,
  runFindAlternatives,
} from "../tools/find-alternatives.ts";
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
import { buildInCarGuide, checkInCarBetweenStations } from "./in-car.ts";
import {
  buildBreakEvenSentence,
  buildDeadlineBreakEvenSentence,
  buildDeadlinePassedSentence,
  buildNoAlternativeSentence,
  buildPassedSentence,
  buildProgressMessage,
  buildWeatherSummary,
  formatChance,
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
  // 駅間の車内の人への案内。駅にいる人なら null
  buildInCarGuide(results: JudgmentToolResults): InCarGuide | null;
  // 止まり方。その列車だけが止まる事象か、区間を止める事象か
  resolveStopScope(): StopScope;
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
  // 確率の標本は大きいので Claude には渡さない。確率は compute_break_even が表示にして返す
  const { remainingSamples: _samples, ...rest } = r;
  return {
    ...rest,
    // 止まり方。train ならその列車だけが止まっていて、区間の運転見合わせではない
    stopScope: resolveStopScope(r.estimate.eventType),
    labels: {
      phaseStartedAt: formatOptional(r.phaseStartedAt, language),
      statedResumeTime: formatOptional(r.statedResumeTime, language),
      boardableP50: formatOptional(r.boardableP50, language),
      boardableP80: formatOptional(r.boardableP80, language),
      // 駅間の車内なら、ホームに着ける駅に着く見込みの時刻
      alightArrivalP50: formatOptional(r.trainQueue?.arrival?.p50 ?? null, language),
      alightArrivalP80: formatOptional(r.trainQueue?.arrival?.p80 ?? null, language),
      // 駅間の車内なら、自分の列車が動き出す見込みの時刻
      ownDepartureP50: formatOptional(r.trainQueue?.departure?.p50 ?? null, language),
      ownDepartureP80: formatOptional(r.trainQueue?.departure?.p80 ?? null, language),
    },
  };
}

// 駅間の車内の人に添える注記。選択肢は着いた後の次の一手を選ぶ比較にだけ使う
const IN_CAR_ALTERNATIVES_NOTE =
  "利用者は駅間の車内にいて降りられない。この選択肢はいまの選択肢として示さず、切り替えも勧めない。着いた後の次の一手はサーバーが決めて画面に出す";

function presentAlternatives(r: AlternativesToolResult, language: Lang, inCar: boolean) {
  return {
    ...r,
    options: r.options.map((o) => ({ ...o, arrivalLabel: formatClock(o.arrivalTime, language) })),
    ...(inCar ? { inCarNote: IN_CAR_ALTERNATIVES_NOTE } : {}),
  };
}

function findOptionLabel(alternatives: AlternativesToolResult | null, id: string): string {
  return alternatives?.options.find((o) => o.id === id)?.label ?? id;
}

// break_even_computed で送る分岐点。説明は定型文で、確定した判断では Claude の説明に置き換わる
// 時刻ごとの再開の見込みも一緒に送るので、画面は判断の確定を待たずに帯を描ける
export function buildComputedBreakEven(
  breakEven: BreakEvenToolResult,
  alternatives: AlternativesToolResult | null,
  language: Lang,
): BreakEven | null {
  const r = breakEven.result;
  if (r.kind === "no_route" || r.kind === "no_alternative") return null;
  const label = findOptionLabel(alternatives, r.bestAlternativeId);
  // 期限が理由でタクシーを勧めるときは、待っても期限に間に合う最後の再開の時刻として説明する
  const deadline = r.deadlineBasis;
  const explanation = deadline
    ? r.kind === "passed"
      ? buildDeadlinePassedSentence(r.time, deadline, label, r.bestAlternativeArrival, language)
      : buildDeadlineBreakEvenSentence(r.time, deadline, label, r.bestAlternativeArrival, language)
    : r.kind === "passed"
      ? buildPassedSentence(r.time, label, r.bestAlternativeArrival, language)
      : buildBreakEvenSentence(r.time, label, r.bestAlternativeArrival, language);
  const resumeChance = breakEven.resumeChance ?? null;
  return { time: r.time, explanation, ...(resumeChance ? { resumeChance } : {}) };
}

// Claude に渡す確率の表示。文にはこの表示をそのまま写させ、数値から言い換えさせない
function presentResumeChance(chance: ResumeChance | null | undefined, language: Lang) {
  if (!chance) return null;
  const label = (tenths: number | null) =>
    tenths === null ? null : formatChance(tenths, language);
  return {
    waitFaster: label(chance.waitFaster),
    waitOnTime: label(chance.waitOnTime),
    resumeByForDeadline: formatOptional(chance.resumeByForDeadline, language),
    ticks: chance.ticks.map((t) => ({
      time: formatClock(t.time, language),
      sinceOnsetMinutes: t.sinceOnsetMinutes,
      chance: label(t.tenths),
    })),
    note:
      language === "ja"
        ? "確率はこの表示をそのまま文に写す。自分で計算しない。sinceOnsetMinutes は最初の観測を発生とみなした分"
        : "Copy these labels verbatim; do not compute probabilities yourself. sinceOnsetMinutes counts from the first observation, treated as the onset",
  };
}

// 駅間の車内の人に添える注記。境目は利用者に見せず、結論にも使わない
const IN_CAR_BREAK_EVEN_NOTE =
  "利用者は駅間の車内にいる。境目は画面に出さず、結論は車内で待つ。headline と reason に境目と切り替え先を書かない";

function presentBreakEven(
  r: BreakEvenToolResult,
  alternatives: AlternativesToolResult | null,
  language: Lang,
  inCar: boolean,
) {
  if (inCar)
    return {
      ...presentBreakEvenBody(r, alternatives, language),
      inCarNote: IN_CAR_BREAK_EVEN_NOTE,
    };
  return presentBreakEvenBody(r, alternatives, language);
}

function presentBreakEvenBody(
  r: BreakEvenToolResult,
  alternatives: AlternativesToolResult | null,
  language: Lang,
) {
  const result = r.result;
  const resumeChance = presentResumeChance(r.resumeChance, language);
  if (result.kind === "no_route" || result.kind === "no_alternative") {
    return {
      ...r,
      labels: { resumeChance },
      explanationTemplate: buildNoAlternativeSentence(language),
    };
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
      resumeChance,
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
  // 駅間の車内の人には、選択肢の一覧と境目を画面へ送らない
  const inCar = checkInCarBetweenStations(ctx.request);

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
    if (state.alternatives) return cached(presentAlternatives(state.alternatives, language, inCar));
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
    await sink.emit({ type: "alternatives_computed", options: inCar ? [] : result.options });
    return { isError: false, content: presentAlternatives(result, language, inCar) };
  }

  async function runBreakEven(input: unknown): Promise<ToolOutcome> {
    if (state.breakEven)
      return cached(presentBreakEven(state.breakEven, state.alternatives, language, inCar));
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
      breakEven: inCar ? null : buildComputedBreakEven(result, state.alternatives, language),
    });
    return {
      isError: false,
      content: presentBreakEven(result, state.alternatives, language, inCar),
    };
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
          // 知見の本文は利用者に出さない。発表の引用と段階の名前だけで書く
          refs.push({
            kind: "signal",
            id: s.signalId,
            description:
              language === "en"
                ? buildSignalEvidenceEn(s.signalId, s.quote, phase?.name.en ?? phase?.name.ja)
                : phase
                  ? `「${phase.name.ja}」の段階の兆候「${s.quote}」`
                  : `発表の「${s.quote}」`,
          });
        }
      }
      refs.push({
        kind: "knowledge",
        id: knowledge.id,
        description:
          language === "en"
            ? `Typical flow of ${knowledge.name.en ?? knowledge.name.ja}`
            : `${knowledge.name.ja}のよくある流れ`,
      });
      const phase = knowledge.phases.find((p) => p.id === state.estimate?.estimate.phaseId);
      if (phase) {
        refs.push({
          kind: "knowledge",
          id: phase.id,
          description:
            language === "en"
              ? `Current phase: ${phase.name.en ?? phase.name.ja}`
              : `いまの段階は「${phase.name.ja}」`,
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
    // 駅間の車内の人には、選択肢の比較と境目を根拠に挙げない。切り替えを勧める説明になるため
    if (!inCar && state.alternatives && state.alternatives.options.length > 1) {
      refs.push({
        kind: "computation",
        id: "alternatives",
        description: language === "ja" ? "代替手段の到着時刻の比較" : "Comparison of arrival times",
      });
    }
    const be =
      !inCar && state.breakEven
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
    const r = results.breakEven.result;
    return validateJudgment({
      judgment,
      evidenceRefs,
      allowedNumbers,
      language,
      recommendedAlternativeId:
        r.kind === "future" || r.kind === "passed" ? r.bestAlternativeId : null,
      inCarAlternativeLines: inCar ? listAlternativeLines(results) : null,
      stopScope: resolveSessionStopScope(),
      sectionContext: {
        announcedSection: findAnnouncedSection(ctx.observations),
        trainPosition:
          ctx.request.trainPosition?.kind === "between_stations" ? ctx.request.trainPosition : null,
      },
    });
  }

  function resolveSessionStopScope(): StopScope {
    return resolveStopScope(state.estimate?.estimate.eventType ?? inferredEventType);
  }

  return {
    ctx,
    state,
    executeTool,
    collectEvidenceRefs,
    checkJudgment,
    emitProgress,
    inferredEventType,
    buildInCarGuide: (results) => buildInCarGuide(ctx.request, results),
    resolveStopScope: resolveSessionStopScope,
  };
}

// 代替手段で乗る路線名。待つ経路と同じ路線は除く
function listAlternativeLines(results: JudgmentToolResults): string[] {
  const rideLines = (kind: "wait" | "other") =>
    results.alternatives.options
      .filter((o) => (o.kind === "wait") === (kind === "wait"))
      .flatMap((o) => o.legs.flatMap((l) => (l.mode === "ride" && l.line ? [l.line] : [])));
  const waitLines = new Set(rideLines("wait"));
  return [...new Set(rideLines("other"))].filter((line) => !waitLines.has(line));
}
