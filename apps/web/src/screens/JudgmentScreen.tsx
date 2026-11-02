"use client";

import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import { AppHeader } from "@/components/AppHeader";
import { MapSheet } from "@/components/MapSheet";
import { SheetSection, useMapChrome } from "@/components/SheetSection";
import { selectTimelineBasis } from "@/features/judgment/break-even-timeline";
import { BreakEvenDetail, BreakEvenSummary } from "@/features/judgment/components/BreakEvenPanel";
import { ConclusionAnnouncer } from "@/features/judgment/components/ConclusionAnnouncer";
import { ConclusionCard, ConclusionDetail } from "@/features/judgment/components/ConclusionCard";
import { Disclaimer } from "@/features/judgment/components/Disclaimer";
import { EvidenceSection } from "@/features/judgment/components/EvidenceSection";
import { JudgmentError } from "@/features/judgment/components/JudgmentError";
import { OptionList } from "@/features/judgment/components/OptionList";
import { ReasoningLog, ReasoningProgress } from "@/features/judgment/components/ReasoningProgress";
import { StatusChip, TripSummary } from "@/features/judgment/components/TripSummary";
import { useJudgmentSession } from "@/features/judgment/session";
import { selectJudgmentDisplay } from "@/features/judgment/state";
import { testIds } from "@/features/judgment/testids";
import { MapLegend } from "@/features/map/MapLegend";
import { MapPanel, selectRouteTone } from "@/features/map/MapPanel";
import type { ReachSource } from "@/features/map/scene";
import { SituationInput } from "@/features/situation/SituationInput";

export function JudgmentScreen() {
  const t = useTranslations("judgment");
  const router = useRouter();
  const { origin, destination, observations, state, catalog, submitInput, retry } =
    useJudgmentSession();
  const chrome = useMapChrome();
  const [reachSource, setReachSource] = useState<ReachSource | null>(null);

  // 判断をまだ求めていなければ開始画面へ戻す
  const hasStarted = state.status !== "idle";
  useEffect(() => {
    if (origin === null || destination === null || !hasStarted) router.replace("/");
  }, [origin, destination, hasStarted, router]);

  if (origin === null || destination === null || !hasStarted) return null;

  const display = selectJudgmentDisplay(state);
  const streaming = state.status === "streaming";
  const known = [...observations, ...state.observations];
  const blockedSection = known.findLast((o) => o.section !== null)?.section ?? null;
  const blockedLine = known.findLast((o) => o.line !== null)?.line ?? null;
  const disclaimerExtra =
    display.judgment?.disclaimer ?? state.previousJudgment?.disclaimer ?? null;
  const options = display.options ?? [];
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
        {blockedLine && <StatusChip line={blockedLine} testId={testIds.judgment.statusChip} />}
      </AppHeader>

      <MapPanel
        origin={origin}
        destination={destination}
        options={options}
        recommendedOptionId={display.recommendedOptionId}
        blockedSection={blockedSection}
        blockedLine={blockedLine}
        insets={chrome.insets}
        onReachSourceChange={setReachSource}
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
              {!streaming && <BreakEvenSummary {...breakEvenProps} />}
              <Disclaimer />
            </div>
          }
        >
          {display.judgment && (
            <SheetSection className="empty:hidden">
              <ConclusionDetail judgment={display.judgment} />
            </SheetSection>
          )}
          {display.breakEven && (
            <SheetSection title={t("breakEven.title")}>
              <BreakEvenDetail {...breakEvenProps} />
            </SheetSection>
          )}
          <SheetSection>
            <OptionList
              options={display.options}
              recommendedOptionId={display.recommendedOptionId}
              stale={display.optionsStale}
              pending={streaming}
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
