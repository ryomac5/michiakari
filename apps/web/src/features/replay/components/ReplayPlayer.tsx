"use client";

import { resolveStopScope } from "@repo/core";
import { type Action, type RouteOption, resolveDeadline } from "@repo/schema";
import { ArrowLeft, ChevronDown, History, Play } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useEffect, useMemo, useState } from "react";
import { AppHeader } from "@/components/AppHeader";
import { MapSheet } from "@/components/MapSheet";
import { SheetSection, useMapChrome } from "@/components/SheetSection";
import { Button } from "@/components/ui/button";
import { selectTimelineBasis } from "@/features/judgment/break-even-timeline";
import {
  BreakEvenDetail,
  BreakEvenMetric,
  ResumeOutlook,
} from "@/features/judgment/components/BreakEvenPanel";
import { ConclusionAnnouncer } from "@/features/judgment/components/ConclusionAnnouncer";
import { ConclusionCard, ConclusionDetail } from "@/features/judgment/components/ConclusionCard";
import { Disclaimer } from "@/features/judgment/components/Disclaimer";
import { EvidenceSection } from "@/features/judgment/components/EvidenceSection";
import { JudgmentError } from "@/features/judgment/components/JudgmentError";
import { OptionList } from "@/features/judgment/components/OptionList";
import { ReasoningLog, ReasoningProgress } from "@/features/judgment/components/ReasoningProgress";
import { WeatherPanel } from "@/features/judgment/components/WeatherPanel";
import { buildJudgmentChange } from "@/features/judgment/judgment-change";
import { selectJudgmentDisplay } from "@/features/judgment/state";
import { selectSwitchStep } from "@/features/judgment/switch-step";
import { testIds } from "@/features/judgment/testids";
import { formatClockTime } from "@/features/judgment/time";
import { useOptionFocus, useOptionSelection } from "@/features/judgment/use-option-focus";
import type { KnowledgeCatalog } from "@/features/knowledge/catalog";
import { MapLegend } from "@/features/map/MapLegend";
import { MapPanel, selectRouteTone } from "@/features/map/MapPanel";
import type { ReachSource } from "@/features/map/scene";
import type { StationGuide } from "@/features/map/station-guide";
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
import { ReplayBar } from "./ReplayBar";
import { ReplayHistory } from "./ReplayHistory";
import { ReplayOutcomeCard } from "./ReplayOutcomeCard";

// 選択肢がまだ無いときの空の配列。描画のたびに新しい配列を作ると地図の組み立てが繰り返される
const noOptions: RouteOption[] = [];

// 1 本のシナリオを再生する。判断の表示は判断画面と同じ部品を使う
export function ReplayPlayer({
  scenario,
  catalog,
  initialSpeed,
  onBack,
}: {
  scenario: ReplayScenario;
  catalog: KnowledgeCatalog;
  initialSpeed: number;
  onBack: () => void;
}) {
  const t = useTranslations();
  const locale = useLocale();
  const player = useReplayPlayer(scenario, locale, initialSpeed);
  const { state, history, latestEntry } = player;
  const { origin, destination } = useMemo(() => buildScenarioPlaces(scenario), [scenario]);
  const chrome = useMapChrome();
  const { setSnap } = chrome;
  const [reachSource, setReachSource] = useState<ReachSource | null>(null);
  const [guide, setGuide] = useState<StationGuide | null>(null);
  const { highlightId, focusOption } = useOptionFocus(chrome.setSnap);
  const { selectedOptionId, selectOption } = useOptionSelection(chrome.setSnap, state.judgedAt);

  const nowIso = resolveScenarioTime(scenario.start_time, player.clockMinutes);
  const now = useMemo(() => new Date(nowIso), [nowIso]);
  const display = selectJudgmentDisplay(state);
  const streaming = state.status === "streaming";
  const started = player.enteredCount > 0;

  const observations = [...player.observations, ...state.observations];
  const lastWithSection = observations.findLast((o) => o.section !== null);
  const blockedLine = observations.findLast((o) => o.line !== null)?.line ?? scenario.line;
  // 止まり方はシナリオの事象から引く。その列車だけが止まる事象では見合わせの札と区間の線を出さない
  const stopScope = resolveStopScope(scenario.event_type);
  const options = display.options ?? noOptions;

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
  // 結末を出したら最後の判断は畳む。見直したい人だけが開き直す
  const [judgmentReopened, setJudgmentReopened] = useState(false);
  useEffect(() => {
    if (!ended) setJudgmentReopened(false);
  }, [ended]);
  const judgmentFolded = ended && !judgmentReopened;

  const breakEvenProps = {
    breakEven: display.breakEven,
    known: display.breakEvenKnown,
    stale: display.breakEvenStale,
    now,
    judgedAt: display.settled?.at ?? null,
    timeline: selectTimelineBasis(display.settled, catalog, deadline),
    // 時刻ごとの再開の見込み。シナリオでは最初の観測が発生なので「発生から」を出す
    chance: display.breakEven?.resumeChance ?? null,
    showOnset: true,
  };
  const switchStep = selectSwitchStep(display.judgment ?? null);
  // 一覧で押した選択肢を地図に描く。判断が変わって選択肢が消えたら推奨に戻す
  const chosenOptionId = options.some((o) => o.id === selectedOptionId) ? selectedOptionId : null;
  const mapOptionId = chosenOptionId ?? display.recommendedOptionId;
  // 凡例も地図と同じ選択中の選択肢の色にする
  const tone = selectRouteTone(options, mapOptionId);

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
          latestEntry && (
            <AnnouncementCard
              key={latestEntry.id}
              concealed={chrome.snap !== "collapsed"}
              entry={latestEntry}
              timeLabel={formatClockTime(
                resolveScenarioTime(scenario.start_time, latestEntry.offset_minutes),
                locale,
              )}
            />
          )
        }
      >
        {/* 再生の操作は見出しの帯の中に置き、帯を 1 本にする。経路と止まった路線は地図とシートが示す */}
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
      </AppHeader>

      <MapPanel
        origin={origin}
        destination={destination}
        options={options}
        recommendedOptionId={display.recommendedOptionId}
        selectedOptionId={chosenOptionId}
        blockedSection={started ? (lastWithSection?.section ?? null) : null}
        blockedLine={blockedLine}
        trainOnly={stopScope === "train"}
        showSectionNote={started}
        insets={chrome.insets}
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
          summary={
            <div className="flex flex-col gap-3">
              {outcome && (
                <div className="flex flex-col gap-1 border-b border-border pb-1">
                  <ReplayOutcomeCard outcome={outcome} deadlineClock={deadlineClock} />
                  <LastJudgmentToggle
                    open={judgmentReopened}
                    onToggle={() => setJudgmentReopened((open) => !open)}
                  />
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
                data-folded={judgmentFolded}
                className={judgmentFolded ? "hidden" : "flex flex-col gap-3"}
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
                    change={buildJudgmentChange(
                      state.previousJudgment,
                      display.judgment,
                      latestEntry ? pickScenarioText(latestEntry.text, locale) : null,
                    )}
                    badge={
                      changed && previousAction ? (
                        <ChangeBadge from={previousAction} to={current.action} />
                      ) : undefined
                    }
                    metric={<BreakEvenMetric {...breakEvenProps} switchStep={switchStep} />}
                  />
                )}
                {/* 判断が確定する前と失敗時も、境目の状態を属性で残す */}
                {started &&
                  !streaming &&
                  !(state.status === "ready" && display.judgment && current) && (
                    <BreakEvenMetric {...breakEvenProps} switchStep={switchStep} />
                  )}
                {/* 推定である旨は再生を始める前から出す。結末のカードが出たら、そちらの 1 回だけにする */}
                {!outcome && <Disclaimer />}
              </div>
            </div>
          }
        >
          {started && (
            <>
              {/* 結末で畳んだ判断の詳しい段は、開いた状態を保つため外さずに隠す */}
              <div className={judgmentFolded ? "hidden" : "contents"}>
                {/* 2 段目: 再開の見込みの図。閉じたシートは地図を広く残すため、引き上げたときに見せる */}
                {state.status === "ready" && display.breakEven && (
                  <SheetSection>
                    <ResumeOutlook {...breakEvenProps} />
                  </SheetSection>
                )}
                {/* 気象を使った判断のときだけ、半分の状態の先頭に雨量の推移を出す */}
                {display.weather && (
                  <SheetSection>
                    <WeatherPanel weather={display.weather} stale={display.weatherStale} />
                  </SheetSection>
                )}
                {display.judgment && (
                  <SheetSection>
                    <ConclusionDetail judgment={display.judgment} />
                  </SheetSection>
                )}
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
                    selectedId={mapOptionId}
                    onSelect={selectOption}
                  />
                </SheetSection>
                <SheetSection className="has-[>[hidden]]:hidden">
                  <EvidenceSection
                    estimate={display.estimate}
                    signals={state.signals}
                    catalog={catalog}
                  />
                </SheetSection>
                {state.status === "ready" && (
                  <SheetSection>
                    <ReasoningLog state={state} catalog={catalog} />
                  </SheetSection>
                )}
              </div>
              <SheetSection>
                <MapLegend tone={tone} reachSource={reachSource} />
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

// 結末の下で、畳んだ最後の判断を開き直す
function LastJudgmentToggle({ open, onToggle }: { open: boolean; onToggle: () => void }) {
  const t = useTranslations("replay.outcome");

  return (
    <button
      type="button"
      data-testid={testIds.replay.lastJudgmentToggle}
      aria-expanded={open}
      onClick={onToggle}
      className="group inline-flex min-h-11 w-fit items-center gap-1 rounded-xl px-1 text-[13px] font-medium text-muted transition-colors hover:text-foreground"
    >
      {open ? t("hideLastJudgment") : t("showLastJudgment")}
      <ChevronDown
        className="size-4 transition-transform duration-200 group-aria-expanded:rotate-180"
        strokeWidth={1.75}
        aria-hidden
      />
    </button>
  );
}
