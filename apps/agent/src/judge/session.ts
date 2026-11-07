import {
  addMinutesToIso,
  checkTrackEvacuation,
  findIncidentType,
  type IncidentTypeId,
  resolveObservedStopScope,
  type StopScope,
} from "@repo/core";
import type {
  AnnouncementCueId,
  BreakEven,
  Evidence,
  InCarGuide,
  Lang,
  Observation,
  ProgressStage,
  ResumeChance,
} from "@repo/schema";
import type { z } from "zod";
import { findFlowWording, findInternalWording } from "../domain/flow-wording.ts";
import {
  checkKnownIncidentType,
  resolveObservedCause,
  resolveObservedIncidentType,
} from "../domain/incident.ts";
import { findIncidentQuote, matchCueSentences } from "../interpret/text-match.ts";
import { ComputeBreakEvenInputSchema, runComputeBreakEven } from "../tools/compute-break-even.ts";
import { EstimateRemainingInputSchema, runEstimateRemaining } from "../tools/estimate-remaining.ts";
import {
  FindAlternativesInputSchema,
  findAnnouncedSection,
  runFindAlternatives,
} from "../tools/find-alternatives.ts";
import { GetWeatherInputSchema, runGetWeather } from "../tools/get-weather.ts";
import {
  type AlternativesToolResult,
  type BreakEvenToolResult,
  createToolState,
  type EstimateToolResult,
  type ToolContext,
  type ToolState,
  type WeatherToolResult,
} from "../tools/types.ts";
import {
  buildRuleOutlook,
  collectAllowedNumbers,
  type JudgmentToolResults,
  validateJudgment,
} from "./assemble.ts";
import type { EventSink, JudgmentEventBody } from "./event-sink.ts";
import { buildInCarGuide, checkInCarBetweenStations } from "./in-car.ts";
import {
  buildBreakEvenSentence,
  buildCueEvidence,
  buildDeadlineBreakEvenSentence,
  buildDeadlinePassedSentence,
  buildNoAlternativeSentence,
  buildPassedSentence,
  buildProgressMessage,
  buildResumeQueueEvidence,
  buildSignalEvidence,
  buildUnaffectedTrackEvidence,
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
  // Claude の進み具合の文を画面に流してよいか。内部の名前、段階、決まった流れの言い方を含めば流さない
  checkProgressNote(note: string): boolean;
  // 途中経過を送る。段階を渡すと定型文を使う
  emitProgress(stage: ProgressStage | undefined, message?: string): Promise<void>;
  // 観測の候補、入口の原因、発表の呼び名から決めた種類
  inferredEventType: IncidentTypeId | null;
  // 駅間の車内の人への案内。駅にいる人なら null
  buildInCarGuide(results: JudgmentToolResults): InCarGuide | null;
  // 止まり方。その列車だけが止まる事象か、区間を止める事象か
  resolveStopScope(): StopScope;
};

function formatOptional(iso: string | null, language: Lang): string | null {
  return iso ? formatClock(iso, language) : null;
}

// 支障の無い線路が先に動く見込みの時刻。見込みが無ければ null
function listUnaffectedTrackTimes(r: EstimateToolResult, now: string) {
  const at = (minutes: number | undefined) =>
    minutes === undefined ? null : addMinutesToIso(now, minutes);
  return {
    affectedP50: at(r.unaffectedTrack?.affected?.p50),
    affectedP80: at(r.unaffectedTrack?.affected?.p80),
    oppositeP50: at(r.unaffectedTrack?.opposite?.p50),
    oppositeP80: at(r.unaffectedTrack?.opposite?.p80),
  };
}

function presentEstimate(r: EstimateToolResult, now: string, language: Lang, stopScope: StopScope) {
  // 確率の標本は大きいので Claude には渡さない。確率は compute_break_even が表示にして返す
  const { remainingSamples: _samples, ...rest } = r;
  const track = listUnaffectedTrackTimes(r, now);
  return {
    ...rest,
    // 止まり方。train ならその列車だけが止まっていて、区間の運転見合わせではない
    stopScope,
    labels: {
      statedResumeTime: formatOptional(r.statedResumeTime, language),
      boardableP50: formatOptional(r.boardableP50, language),
      boardableP80: formatOptional(r.boardableP80, language),
      // 駅間の車内なら、ホームに着ける駅に着く見込みの時刻
      alightArrivalP50: formatOptional(r.trainQueue?.arrival?.p50 ?? null, language),
      alightArrivalP80: formatOptional(r.trainQueue?.arrival?.p80 ?? null, language),
      // 駅間の車内なら、自分の列車が動き出す見込みの時刻
      ownDepartureP50: formatOptional(r.trainQueue?.departure?.p50 ?? null, language),
      ownDepartureP80: formatOptional(r.trainQueue?.departure?.p80 ?? null, language),
      // 防護無線の事象なら、当該の線路と反対の線路が動き出す見込みの時刻
      affectedTrackP50: formatOptional(track.affectedP50, language),
      affectedTrackP80: formatOptional(track.affectedP80, language),
      oppositeTrackP50: formatOptional(track.oppositeP50, language),
      oppositeTrackP80: formatOptional(track.oppositeP80, language),
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
  const inferredEventType = resolveObservedIncidentType(
    ctx.observations,
    ctx.request.cause ?? null,
  );
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
    const now = ctx.request.now;
    if (state.estimate)
      return cached(presentEstimate(state.estimate, now, language, resolveSessionStopScope()));
    const parsed = parseInput(EstimateRemainingInputSchema, input);
    if (isOutcome(parsed)) return parsed;
    // 種類は観測と入口の原因からコードが決める。Claude の指定が違っても、両方のモードで同じ種類を使う
    const result = runEstimateRemaining(ctx, { eventType: inferredEventType });
    state.estimate = result;
    await sink.emit({
      type: "phase_estimated",
      estimate: result.estimate,
      ...buildRuleOutlook(result),
    });
    const content = presentEstimate(result, now, language, resolveSessionStopScope());
    if (parsed.eventType === inferredEventType) return { isError: false, content };
    return {
      isError: false,
      content: {
        ...content,
        note: `eventType は観測と入口の原因から決めた ${inferredEventType ?? "null"} を使いました。指定の ${parsed.eventType ?? "null"} は使っていません`,
      },
    };
  }

  async function runAlternatives(input: unknown): Promise<ToolOutcome> {
    if (state.alternatives) return cached(presentAlternatives(state.alternatives, language, inCar));
    if (!state.estimate) {
      return {
        isError: true,
        content: { error: "先に estimate_remaining を呼んでください" },
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
          error: "先に estimate_remaining と find_alternatives を呼んでください",
        },
      };
    }
    const parsed = parseInput(ComputeBreakEvenInputSchema, input);
    if (isOutcome(parsed)) return parsed;
    const result = runComputeBreakEven(ctx, state.estimate, state.alternatives);
    state.breakEven = result;
    await sink.emit({
      type: "break_even_computed",
      // 線路に降りる案内が出たら、分岐点の時刻を画面に出さない
      breakEven:
        inCar || checkTrackEvacuation(state.estimate.cues)
          ? null
          : buildComputedBreakEven(result, state.alternatives, language),
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
      get_weather: state.weather ? null : "weather",
      estimate_remaining: state.estimate ? null : "phase",
      find_alternatives: state.alternatives || !state.estimate ? null : "alternatives",
      compute_break_even: state.breakEven || !state.alternatives ? null : "break_even",
    };
    const stage = pending[name];
    if (stage) await emitProgress(stage);
  }

  async function executeTool(name: string, input: unknown): Promise<ToolOutcome> {
    await announceToolStart(name);
    switch (name) {
      case "get_weather":
        return runWeather(input);
      case "estimate_remaining":
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
  // 発表の引用、放送の手がかり、気象、計算に限る
  function collectEvidenceRefs(): Evidence[] {
    const refs: Evidence[] = [];
    const type = findIncidentType(state.estimate?.estimate.eventType ?? null);
    const signalQuote = type ? findSignalQuote(ctx.observations, type) : null;
    if (type && signalQuote) {
      refs.push({
        kind: "signal",
        id: type,
        description: buildSignalEvidence(signalQuote, language),
      });
    }
    for (const cue of state.estimate?.cues ?? []) {
      refs.push({
        kind: "cue",
        id: cue,
        description: buildCueEvidence(cue, findCueQuote(ctx.observations, cue), language),
      });
    }
    if (state.weather && state.weather.readings.length > 0) {
      const latest = state.weather.summary.latest;
      const ja = language === "ja";
      const detail = latest
        ? ja
          ? `${formatClock(latest.time, language)}の10分雨量は${latest.rainfall10minMm}mmです。${latest.warnings.length > 0 ? `${latest.warnings.join("・")}が出ています。` : ""}出典は気象庁です。`
          : `The 10-min rainfall at ${formatClock(latest.time, language)} was ${latest.rainfall10minMm} mm.${latest.warnings.length > 0 ? ` In effect: ${latest.warnings.join(", ")}.` : ""} Source: JMA.`
        : "";
      refs.push({ kind: "weather", id: "weather", description: detail });
    }
    if (state.estimate?.unaffectedTrack?.opposite) {
      refs.push({
        kind: "computation",
        id: "unaffected_track",
        description: buildUnaffectedTrackEvidence(language),
      });
    }
    const queue = state.estimate?.resumeQueue ?? null;
    if (queue && queue.trainsInQueue > 0) {
      refs.push({
        kind: "computation",
        id: "resume_queue",
        description: buildResumeQueueEvidence(queue.worthAlightingAtNextStation, language),
      });
    }
    if (state.estimate?.estimate.remaining) {
      refs.push({
        kind: "computation",
        id: "remaining",
        description:
          language === "ja"
            ? "再開して乗れるまでの残り時間の見込み"
            : "Estimated time until a boardable train",
      });
    }
    // 駅間の車内の人には、選択肢の比較と境目を根拠に挙げない。切り替えを勧める説明になるため
    if (!inCar && state.alternatives && state.alternatives.options.length > 1) {
      refs.push({
        kind: "computation",
        id: "alternatives",
        description:
          language === "ja"
            ? "待つ場合と代わりの手段の到着時刻を比べました。"
            : "We compared arrival times for waiting and the alternatives.",
      });
    }
    const be =
      !inCar && state.breakEven && !checkTrackEvacuation(state.estimate?.cues ?? [])
        ? buildComputedBreakEven(state.breakEven, state.alternatives, language)
        : null;
    if (be) refs.push({ kind: "computation", id: "break_even", description: be.explanation });
    return refs;
  }

  function checkJudgment(judgment: unknown, results: JudgmentToolResults) {
    const evidenceRefs = collectEvidenceRefs();
    const allowedNumbers = collectAllowedNumbers({
      results,
      observations: ctx.observations,
      now: ctx.request.now,
      extraTimes: Object.values(listUnaffectedTrackTimes(results.estimate, ctx.request.now)),
      evidenceRefs,
    });
    // 詰まりで次の駅で降りる価値があれば、駅間の車内の人にも降りて乗り換える言い方を許す
    // 線路に降りる案内が出たときも、降りる言い方を許す
    const alightAllowed =
      results.estimate.resumeQueue?.worthAlightingAtNextStation === true ||
      checkTrackEvacuation(results.estimate.cues);
    const r = results.breakEven.result;
    return validateJudgment({
      judgment,
      evidenceRefs,
      allowedNumbers,
      language,
      recommendedAlternativeId:
        r.kind === "future" || r.kind === "passed" ? r.bestAlternativeId : null,
      inCarAlternativeLines: inCar ? listAlternativeLines(results) : null,
      inCarAlightAllowed: alightAllowed,
      stopScope: resolveSessionStopScope(),
      sectionContext: {
        announcedSection: findAnnouncedSection(ctx.observations),
        trainPosition:
          ctx.request.trainPosition?.kind === "between_stations" ? ctx.request.trainPosition : null,
      },
    });
  }

  function resolveSessionStopScope(): StopScope {
    return resolveObservedStopScope({
      estimatedEventType: state.estimate?.estimate.eventType ?? null,
      observations: ctx.observations,
      isKnownEvent: checkKnownIncidentType,
      cause: resolveObservedCause(ctx.observations, ctx.request.cause ?? null),
    });
  }

  return {
    ctx,
    state,
    executeTool,
    collectEvidenceRefs,
    checkJudgment,
    checkProgressNote: (note) =>
      findFlowWording(note, language) === null && findInternalWording(note) === null,
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

// 種類の呼び名を含む発表の文。新しい観測を先に見る
function findSignalQuote(
  observations: readonly Observation[],
  type: IncidentTypeId,
): string | null {
  for (const o of [...observations].reverse()) {
    const quote = o.rawText ? findIncidentQuote(o.rawText, type) : null;
    if (quote) return quote;
  }
  return null;
}

// 手がかりを含む文。解釈で付いた引用を先に使い、無ければ原文から探す。どちらも無ければ空
function findCueQuote(observations: readonly Observation[], cue: AnnouncementCueId): string {
  for (const o of [...observations].reverse()) {
    const signal = o.detectedSignals.find((s) => s.signalId === cue && s.quote.length > 0);
    if (signal) return signal.quote;
    const match = o.rawText ? matchCueSentences(o.rawText).find((m) => m.cueId === cue) : null;
    if (match) return match.quote;
  }
  return "";
}
