"use client";

import { MessageSquarePlus } from "lucide-react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useEffect } from "react";
import { selectTimelineBasis } from "@/features/judgment/break-even-timeline";
import { BreakEvenPanel } from "@/features/judgment/components/BreakEvenPanel";
import { ConclusionAnnouncer } from "@/features/judgment/components/ConclusionAnnouncer";
import { ConclusionCard } from "@/features/judgment/components/ConclusionCard";
import { Disclaimer } from "@/features/judgment/components/Disclaimer";
import { EvidenceSection } from "@/features/judgment/components/EvidenceSection";
import { JudgmentError } from "@/features/judgment/components/JudgmentError";
import { OptionList } from "@/features/judgment/components/OptionList";
import { ReasoningProgress } from "@/features/judgment/components/ReasoningProgress";
import { TripSummary } from "@/features/judgment/components/TripSummary";
import { useJudgmentSession } from "@/features/judgment/session";
import { selectJudgmentDisplay } from "@/features/judgment/state";
import { testIds } from "@/features/judgment/testids";
import { MapPanel } from "@/features/map/MapPanel";
import { SituationInput } from "@/features/situation/SituationInput";

export function JudgmentScreen() {
  const t = useTranslations("judgment");
  const router = useRouter();
  const { origin, destination, observations, state, catalog, submitInput, retry } =
    useJudgmentSession();

  // 判断をまだ求めていなければ開始画面へ戻す
  const hasStarted = state.status !== "idle";
  useEffect(() => {
    if (origin === null || destination === null || !hasStarted) router.replace("/");
  }, [origin, destination, hasStarted, router]);

  if (origin === null || destination === null || !hasStarted) return null;

  const display = selectJudgmentDisplay(state);
  const streaming = state.status === "streaming";
  const blockedSection =
    [...observations, ...state.observations].findLast((o) => o.section !== null)?.section ?? null;
  const disclaimerExtra =
    display.judgment?.disclaimer ?? state.previousJudgment?.disclaimer ?? null;

  return (
    <main
      id="main"
      data-testid={testIds.judgment.screen}
      data-status={state.status}
      className="mx-auto flex max-w-2xl flex-col gap-5 px-4 pt-2 pb-10"
    >
      <h1 className="sr-only">{t("heading")}</h1>
      {/* 390x844 の最初の画面に結論と分岐点が収まるよう、ここまでは詰めて並べる */}
      <div className="flex flex-col gap-3">
        <TripSummary
          origin={origin}
          destination={destination}
          testId={testIds.judgment.tripSummary}
        />

        <ConclusionAnnouncer
          judgment={state.status === "ready" ? (display.judgment ?? null) : null}
        />
        <div className="flex flex-col gap-2">
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
          <Disclaimer />
        </div>

        <BreakEvenPanel
          breakEven={display.breakEven}
          known={display.breakEvenKnown}
          stale={display.breakEvenStale}
          timeline={selectTimelineBasis(display.settled, catalog, null)}
        />
      </div>

      <MapPanel
        origin={origin}
        destination={destination}
        options={display.options ?? []}
        recommendedOptionId={display.recommendedOptionId}
        blockedSection={blockedSection}
      />

      <OptionList
        options={display.options}
        recommendedOptionId={display.recommendedOptionId}
        stale={display.optionsStale}
        pending={streaming}
      />

      <EvidenceSection
        estimate={display.estimate}
        signals={state.signals}
        evidence={display.evidence}
        catalog={catalog}
        disclaimer={disclaimerExtra}
      />

      <section
        data-testid={testIds.judgment.addInfo}
        aria-labelledby="add-info-title"
        className="flex flex-col gap-3 rounded-3xl border-2 border-border bg-surface p-4 sm:p-5"
      >
        <h2 id="add-info-title" className="flex items-center gap-2 text-lg font-extrabold">
          <MessageSquarePlus className="size-5" aria-hidden />
          {t("addInfo.title")}
        </h2>
        <p className="text-muted">{t("addInfo.lead")}</p>
        <SituationInput
          catalog={catalog}
          busy={streaming}
          onSubmit={(input) => {
            submitInput(input);
            const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
            window.scrollTo({ top: 0, behavior: reduce ? "auto" : "smooth" });
          }}
        />
      </section>
    </main>
  );
}
