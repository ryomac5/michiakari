"use client";

import type { RouteOption } from "@repo/schema";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useEffect, useMemo, useState } from "react";
import { AppHeader } from "@/components/AppHeader";
import { MapSheet } from "@/components/MapSheet";
import { SheetSection, useMapChrome } from "@/components/SheetSection";
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
import { NextCheckSection, PremiseSection } from "@/features/judgment/components/NextCheck";
import { OptionList } from "@/features/judgment/components/OptionList";
import { ReasoningLog, ReasoningProgress } from "@/features/judgment/components/ReasoningProgress";
import { StatusChip, TripSummary } from "@/features/judgment/components/TripSummary";
import { TypicalFlowSection } from "@/features/judgment/components/TypicalFlow";
import { WeatherPanel } from "@/features/judgment/components/WeatherPanel";
import { type OriginLine, type TripContext, useJudgmentSession } from "@/features/judgment/session";
import { selectJudgmentDisplay } from "@/features/judgment/state";
import { testIds } from "@/features/judgment/testids";
import { useOptionFocus } from "@/features/judgment/use-option-focus";
import { MapLegend } from "@/features/map/MapLegend";
import { MapPanel, selectRouteTone } from "@/features/map/MapPanel";
import type { BlockedDirection, ReachSource } from "@/features/map/scene";
import type { StationGuide } from "@/features/map/station-guide";
import { useLineLabel } from "@/features/map/use-line-label";
import { SituationInput } from "@/features/situation/SituationInput";

// 選択肢がまだ無いときの空の配列。描画のたびに新しい配列を作ると地図の組み立てが繰り返される
const noOptions: RouteOption[] = [];

// 方面の key は「路線の key>方面の終わりの駅の ID」
function selectBlockedDirection(
  line: OriginLine | null,
  trip: TripContext | null,
): BlockedDirection | null {
  if (!line || !trip) return null;
  const terminalId = trip.directionKey.slice(trip.directionKey.lastIndexOf(">") + 1);
  return terminalId ? { lineId: line.lineId, terminalId } : null;
}

export function JudgmentScreen() {
  const t = useTranslations("judgment");
  const router = useRouter();
  const {
    origin,
    destination,
    observations,
    state,
    catalog,
    submitInput,
    retry,
    resumeJudgment,
    originLine,
    tripContext,
  } = useJudgmentSession();

  // 入口で預けた判断は、この画面が開いてから流し始める
  useEffect(() => {
    resumeJudgment();
  }, [resumeJudgment]);
  const chrome = useMapChrome();
  const [reachSource, setReachSource] = useState<ReachSource | null>(null);
  const [guide, setGuide] = useState<StationGuide | null>(null);
  const { highlightId, focusOption } = useOptionFocus(chrome.setSnap);
  const known = [...observations, ...state.observations];
  const blockedLine = known.findLast((o) => o.line !== null)?.line ?? null;
  const lineLabel = useLineLabel(blockedLine);

  // 入口で選んだ路線と方面。区間の観測が無いあいだ、地図はこの方面を止まっている区間として描く
  const blockedDirection = useMemo(
    () => selectBlockedDirection(originLine, tripContext),
    [originLine, tripContext],
  );

  // 判断をまだ求めていなければ開始画面へ戻す
  const hasStarted = state.status !== "idle";
  useEffect(() => {
    if (origin === null || destination === null || !hasStarted) router.replace("/");
  }, [origin, destination, hasStarted, router]);

  if (origin === null || destination === null || !hasStarted) return null;

  const display = selectJudgmentDisplay(state);
  const streaming = state.status === "streaming";
  const blockedSection = known.findLast((o) => o.section !== null)?.section ?? null;
  const disclaimerExtra =
    display.judgment?.disclaimer ?? state.previousJudgment?.disclaimer ?? null;
  const options = display.options ?? noOptions;
  const typicalFlow = display.settled?.judgment.typicalFlow ?? null;
  const tone = selectRouteTone(options, display.recommendedOptionId);
  const breakEvenProps = {
    breakEven: display.breakEven,
    known: display.breakEvenKnown,
    stale: display.breakEvenStale,
    timeline: selectTimelineBasis(display.settled, catalog, null),
  };

  return (
    <div data-testid={testIds.judgment.screen} data-status={state.status} className="h-dvh">
      <AppHeader variant="map">
        <TripSummary
          origin={origin}
          destination={destination}
          testId={testIds.judgment.tripSummary}
        />
        {blockedLine && <StatusChip line={lineLabel} testId={testIds.judgment.statusChip} />}
      </AppHeader>

      <MapPanel
        origin={origin}
        destination={destination}
        options={options}
        recommendedOptionId={display.recommendedOptionId}
        blockedSection={blockedSection}
        blockedLine={blockedLine}
        blockedDirection={blockedDirection}
        insets={chrome.insets}
        onReachSourceChange={setReachSource}
        onGuideChange={setGuide}
        onSelectOption={focusOption}
      />

      <main id="main">
        <h1 className="sr-only">{t("heading")}</h1>
        <ConclusionAnnouncer
          judgment={state.status === "ready" ? (display.judgment ?? null) : null}
        />
        <MapSheet
          label={t("sheet")}
          snap={chrome.snap}
          onSnapChange={chrome.setSnap}
          onCollapsedHeightChange={chrome.setCollapsedHeight}
          summary={
            <div className="flex flex-col gap-3">
              {streaming && <ReasoningProgress state={state} catalog={catalog} />}
              {state.status === "error" && state.error && (
                <JudgmentError
                  message={state.error.message}
                  retryable={state.error.retryable}
                  onRetry={retry}
                />
              )}
              {state.status === "ready" && display.judgment && (
                <ConclusionCard judgment={display.judgment} />
              )}
              {!streaming && (
                <BreakEvenSummary
                  {...breakEvenProps}
                  hideMeaning={selectCardReason(display.judgment) !== null}
                />
              )}
              <Disclaimer />
            </div>
          }
        >
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
          {typicalFlow && (
            <SheetSection>
              <TypicalFlowSection
                flow={typicalFlow}
                estimate={display.estimate}
                expanded={chrome.desktop || chrome.snap === "full"}
                testIds={{ section: testIds.judgment.flow, phase: testIds.judgment.flowPhase }}
              />
            </SheetSection>
          )}
          {state.status === "ready" && display.estimate && (
            <NextCheckSection
              estimate={display.estimate}
              catalog={catalog}
              onUpdate={() => {
                chrome.setSnap("full");
                document
                  .querySelector(`[data-testid="${testIds.judgment.addInfo}"]`)
                  ?.scrollIntoView({ behavior: "smooth", block: "start" });
              }}
            />
          )}
          {state.status === "ready" && <PremiseSection />}
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
          <SheetSection
            testId={testIds.judgment.addInfo}
            title={t("addInfo.title")}
            className="pb-2"
          >
            <p className="text-[13px] text-muted">{t("addInfo.lead")}</p>
            <SituationInput
              catalog={catalog}
              busy={streaming}
              onSubmit={(input) => {
                submitInput(input);
                chrome.setSnap("collapsed");
              }}
            />
          </SheetSection>
        </MapSheet>
      </main>
    </div>
  );
}
