"use client";

import { type Action, type RouteOption, resolveDeadline } from "@repo/schema";
import { ArrowLeft, History, Play } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useEffect, useMemo, useState } from "react";
import { AppHeader } from "@/components/AppHeader";
import { MapSheet, sheetTopInset } from "@/components/MapSheet";
import { SheetSection, useMapChrome } from "@/components/SheetSection";
import { Button } from "@/components/ui/button";
import { selectTimelineBasis } from "@/features/judgment/break-even-timeline";
import { BreakEvenDetail, BreakEvenSummary } from "@/features/judgment/components/BreakEvenPanel";
import { ConclusionAnnouncer } from "@/features/judgment/components/ConclusionAnnouncer";
import {
  ConclusionCard,
  ConclusionDetail,
  selectCardReason,
} from "@/features/judgment/components/ConclusionCard";
import { Disclaimer } from "@/features/judgment/components/Disclaimer";
import { EvidenceSection } from "@/features/judgment/components/EvidenceSection";
import { JudgmentError } from "@/features/judgment/components/JudgmentError";
import { OptionList } from "@/features/judgment/components/OptionList";
import { ReasoningLog, ReasoningProgress } from "@/features/judgment/components/ReasoningProgress";
import { StatusChip, TripChip } from "@/features/judgment/components/TripSummary";
import { TypicalFlowSection } from "@/features/judgment/components/TypicalFlow";
import { WeatherPanel } from "@/features/judgment/components/WeatherPanel";
import { selectJudgmentDisplay } from "@/features/judgment/state";
import { selectSwitchStep } from "@/features/judgment/switch-step";
import { testIds } from "@/features/judgment/testids";
import { formatClockTime } from "@/features/judgment/time";
import { useOptionFocus } from "@/features/judgment/use-option-focus";
import type { KnowledgeCatalog } from "@/features/knowledge/catalog";
import { MapLegend } from "@/features/map/MapLegend";
import { MapPanel, selectRouteTone } from "@/features/map/MapPanel";
import type { ReachSource } from "@/features/map/scene";
import type { StationGuide } from "@/features/map/station-guide";
import { useLineLabel } from "@/features/map/use-line-label";
import { pickStationName, type StationNames } from "@/features/stations/describe";
import { computeReplayProgress } from "../clock";
import { selectReplayOutcome } from "../outcome";
import {
  buildScenarioPlaces,
  pickScenarioText,
  type ReplayScenario,
  resolveScenarioTime,
} from "../scenario";
import { useReplayPlayer } from "../use-replay-player";
import { AnnouncementCard } from "./AnnouncementCard";
import { PhaseStrip } from "./PhaseStrip";
import { ReplayBar } from "./ReplayBar";
import { ReplayHistory } from "./ReplayHistory";
import { ReplayOutcomeCard } from "./ReplayOutcomeCard";

// 選択肢がまだ無いときの空の配列。描画のたびに新しい配列を作ると地図の組み立てが繰り返される
const noOptions: RouteOption[] = [];

// 上部の帯の下に再生バー（56px）と余白を重ねるぶん、シートの上端を下げる
const replayTopInset = sheetTopInset + 64;
// 地図を寄せるときは、せり出す発表のぶんも空ける
const announcementInset = 64;

// 1 本のシナリオを再生する。判断の表示は判断画面と同じ部品を使う
export function ReplayPlayer({
  scenario,
  catalog,
  stationNames,
  initialSpeed,
  onBack,
}: {
  scenario: ReplayScenario;
  catalog: KnowledgeCatalog;
  stationNames: StationNames;
  initialSpeed: number;
  onBack: () => void;
}) {
  const t = useTranslations();
  const locale = useLocale();
  const player = useReplayPlayer(scenario, locale, initialSpeed);
  const { state, history, latestEntry } = player;
  const { origin, destination } = useMemo(() => buildScenarioPlaces(scenario), [scenario]);
  const chrome = useMapChrome(replayTopInset);
  const { setSnap } = chrome;
  const [reachSource, setReachSource] = useState<ReachSource | null>(null);
  const [guide, setGuide] = useState<StationGuide | null>(null);
  const { highlightId, focusOption } = useOptionFocus(chrome.setSnap);

  const nowIso = resolveScenarioTime(scenario.start_time, player.clockMinutes);
  const now = useMemo(() => new Date(nowIso), [nowIso]);
  const display = selectJudgmentDisplay(state);
  const typicalFlow = display.settled?.judgment.typicalFlow ?? null;
  const streaming = state.status === "streaming";
  const started = player.enteredCount > 0;

  const observations = [...player.observations, ...state.observations];
  const lastWithSection = observations.findLast((o) => o.section !== null);
  const blockedLine = observations.findLast((o) => o.line !== null)?.line ?? scenario.line;
  const lineLabel = useLineLabel(blockedLine);
  const disclaimerExtra =
    display.judgment?.disclaimer ?? state.previousJudgment?.disclaimer ?? null;
  const options = display.options ?? noOptions;
  const tone = selectRouteTone(options, display.recommendedOptionId);

  // 表示中の判断と、その一つ前の判断の行動
  const current = state.status === "ready" ? history.at(-1) : undefined;
  const previousAction: Action | null = current ? (history.at(-2)?.action ?? null) : null;
  const changed =
    current !== undefined && previousAction !== null && previousAction !== current.action;
  const pendingId = streaming ? (latestEntry?.id ?? "") : "";
  const deadlineClock = scenario.user.constraints.deadline;
  const deadline = deadlineClock ? resolveDeadline(scenario.start_time, deadlineClock) : null;
  // 最後まで流れたら、記録した判断の列から結末を求める
  const outcome = useMemo(
    () =>
      player.status === "ended"
        ? selectReplayOutcome(
            scenario,
            history.map((h) => h.decision),
            catalog,
          )
        : null,
    [player.status, scenario, history, catalog],
  );

  // 終わったら結末を見せるためにシートを半分まで開く
  const ended = outcome !== null;
  useEffect(() => {
    if (ended) setSnap("half");
  }, [ended, setSnap]);

  const names = {
    from: pickStationName({ name: origin.name, nameEn: stationNames[origin.name] ?? null }, locale),
    to: pickStationName(
      { name: destination.name, nameEn: stationNames[destination.name] ?? null },
      locale,
    ),
  };
  const breakEvenProps = {
    breakEven: display.breakEven,
    known: display.breakEvenKnown,
    stale: display.breakEvenStale,
    now,
    judgedAt: display.settled?.at ?? null,
    timeline: selectTimelineBasis(display.settled, catalog, deadline),
  };
  const switchStep = selectSwitchStep(display.judgment ?? null);

  return (
    <div
      data-testid={testIds.replay.screen}
      data-scenario-id={scenario.id}
      data-state={player.status}
      className="h-dvh"
    >
      <AppHeader
        variant="map"
        leading={
          <button
            type="button"
            data-testid={testIds.replay.backButton}
            aria-label={t("replay.back")}
            title={t("replay.back")}
            onClick={onBack}
            className="inline-flex size-11 shrink-0 items-center justify-center rounded-xl transition-colors hover:bg-foreground/5"
          >
            <ArrowLeft className="size-5" strokeWidth={1.75} aria-hidden />
          </button>
        }
        below={
          <>
            <ReplayBar
              status={player.status}
              clockLabel={formatClockTime(nowIso, locale)}
              progress={computeReplayProgress(scenario.timeline, player.clockMinutes)}
              enteredCount={player.enteredCount}
              total={scenario.timeline.length}
              speed={player.speed}
              onTogglePlay={player.togglePlay}
              onNext={player.stepNext}
              onRestart={player.restart}
              onChangeSpeed={player.changeSpeed}
            />
            {latestEntry && (
              <AnnouncementCard
                key={latestEntry.id}
                concealed={chrome.snap === "full"}
                entry={latestEntry}
                timeLabel={formatClockTime(
                  resolveScenarioTime(scenario.start_time, latestEntry.offset_minutes),
                  locale,
                )}
              />
            )}
          </>
        }
      >
        <TripChip from={names.from} to={names.to} />
        <StatusChip line={lineLabel} />
      </AppHeader>

      <MapPanel
        origin={origin}
        destination={destination}
        options={options}
        recommendedOptionId={display.recommendedOptionId}
        blockedSection={started ? (lastWithSection?.section ?? null) : null}
        blockedLine={blockedLine}
        insets={{ ...chrome.insets, top: chrome.insets.top + announcementInset }}
        onReachSourceChange={setReachSource}
        onGuideChange={setGuide}
        onSelectOption={focusOption}
      />

      <main id="main">
        <h1 className="sr-only">{t("replay.heading")}</h1>
        <ConclusionAnnouncer
          judgment={state.status === "ready" ? (display.judgment ?? null) : null}
        />
        <MapSheet
          label={t("judgment.sheet")}
          snap={chrome.snap}
          onSnapChange={setSnap}
          onCollapsedHeightChange={chrome.setCollapsedHeight}
          topInset={replayTopInset}
          summary={
            <div className="flex flex-col gap-3">
              {outcome && (
                <div className="border-b border-border pb-3">
                  <ReplayOutcomeCard outcome={outcome} deadlineClock={deadlineClock} />
                </div>
              )}
              <div
                data-testid={testIds.replay.judgment}
                data-status={state.status}
                data-observation-id={current?.observationId ?? ""}
                data-pending-observation-id={pendingId}
                data-action={current?.action ?? ""}
                data-phase-id={current?.phaseId ?? ""}
                data-evidence-ids={current?.evidenceIds.join(" ") ?? ""}
                data-break-even-shown={current ? String(current.breakEvenShown) : ""}
                data-changed={changed}
                className="flex flex-col gap-3"
              >
                {!started && <ReadyCard scenario={scenario} onStart={player.togglePlay} />}
                {streaming && <ReasoningProgress state={state} catalog={catalog} />}
                {state.status === "error" && state.error && (
                  <JudgmentError
                    message={state.error.message}
                    retryable={state.error.retryable}
                    onRetry={player.retry}
                  />
                )}
                {state.status === "ready" && display.judgment && current && (
                  <ConclusionCard
                    judgment={display.judgment}
                    badge={
                      changed && previousAction ? (
                        <ChangeBadge from={previousAction} to={current.action} />
                      ) : undefined
                    }
                  />
                )}
                {started && !streaming && (
                  <BreakEvenSummary
                    {...breakEvenProps}
                    hideMeaning={selectCardReason(display.judgment) !== null}
                    switchStep={switchStep}
                    switchLineColor={
                      guide?.optionMarks.find((m) => m.optionId === switchStep?.optionId)?.color
                    }
                  />
                )}
                {started && <Disclaimer />}
              </div>
            </div>
          }
        >
          {started && (
            <>
              {/* 気象を使った判断のときだけ、半分の状態の先頭に雨量の推移を出す */}
              {display.weather && (
                <SheetSection>
                  <WeatherPanel weather={display.weather} stale={display.weatherStale} />
                </SheetSection>
              )}
              {display.judgment && (
                <SheetSection className="empty:hidden">
                  <ConclusionDetail judgment={display.judgment} />
                </SheetSection>
              )}
              <SheetSection>
                {typicalFlow ? (
                  <TypicalFlowSection
                    flow={typicalFlow}
                    estimate={display.estimate}
                    expanded={chrome.desktop || chrome.snap === "full"}
                    testIds={{ section: testIds.replay.phaseStrip, phase: testIds.replay.phase }}
                  />
                ) : (
                  <PhaseStrip estimate={display.estimate} catalog={catalog} />
                )}
              </SheetSection>
              {display.breakEven && (
                <SheetSection>
                  <BreakEvenDetail {...breakEvenProps} />
                </SheetSection>
              )}
              <SheetSection>
                <OptionList
                  options={display.options}
                  recommendedOptionId={display.recommendedOptionId}
                  stale={display.optionsStale}
                  pending={streaming}
                  marks={guide?.optionMarks}
                  highlightId={highlightId}
                />
              </SheetSection>
              <SheetSection>
                <MapLegend tone={tone} reachSource={reachSource} />
              </SheetSection>
              {state.status === "ready" && (
                <SheetSection>
                  <ReasoningLog state={state} catalog={catalog} />
                </SheetSection>
              )}
              <SheetSection>
                <EvidenceSection
                  estimate={display.estimate}
                  signals={state.signals}
                  evidence={display.evidence}
                  catalog={catalog}
                  disclaimer={disclaimerExtra}
                  showPhases={typicalFlow === null}
                />
              </SheetSection>
              <SheetSection>
                <ReplayHistory
                  startTime={scenario.start_time}
                  entries={scenario.timeline.slice(0, player.enteredCount)}
                  history={history}
                />
              </SheetSection>
            </>
          )}
          <SheetSection title={t("replay.scenario")}>
            <p data-testid={testIds.replay.title} className="text-[15px] font-medium">
              {pickScenarioText(scenario.title, locale)}
            </p>
            <p className="text-[12px] text-muted">{t("replay.fictional")}</p>
          </SheetSection>
        </MapSheet>
      </main>
    </div>
  );
}

function ReadyCard({ scenario, onStart }: { scenario: ReplayScenario; onStart: () => void }) {
  const t = useTranslations("replay");
  const locale = useLocale();
  const deadline = scenario.user.constraints.deadline;

  return (
    <section className="flex flex-col gap-3">
      <div className="flex flex-col gap-1">
        <p className="text-[13px] text-muted">{t("ready.title")}</p>
        <h2 className="line-clamp-2 text-[19px] leading-snug font-semibold text-balance">
          {pickScenarioText(scenario.title, locale)}
        </h2>
        <p className="text-[13px] text-muted tabular-nums">
          {formatClockTime(scenario.start_time, locale)} ·{" "}
          {deadline ? t("deadline", { time: deadline }) : t("noDeadline")}
        </p>
      </div>
      <Button onClick={onStart} className="w-full">
        <Play className="fill-current" aria-hidden />
        {t("ready.start")}
      </Button>
      <p className="text-[12px] text-muted">{t("fictional")}</p>
    </section>
  );
}

// 判断が変わったことをピルの横に短く示す。演出は加えない
function ChangeBadge({ from, to }: { from: Action; to: Action }) {
  const t = useTranslations();

  return (
    <p
      data-testid={testIds.replay.changeBadge}
      data-from={from}
      data-to={to}
      role="status"
      className="flex min-w-0 animate-fade-in items-center gap-1 text-[12px] text-muted"
    >
      <History className="size-3.5 shrink-0" strokeWidth={1.75} aria-hidden />
      <span className="sr-only">{t("replay.changed")}: </span>
      <span className="truncate">
        {t("replay.changedFrom", { action: t(`judgment.action.${from}`) })}
      </span>
    </p>
  );
}
