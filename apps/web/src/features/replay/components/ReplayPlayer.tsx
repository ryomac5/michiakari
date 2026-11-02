"use client";

import type { Action } from "@repo/schema";
import { ArrowRight, Play } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useMemo } from "react";
import { Button } from "@/components/ui/button";
import { actionStyles } from "@/features/judgment/action-style";
import { BreakEvenPanel } from "@/features/judgment/components/BreakEvenPanel";
import { ConclusionAnnouncer } from "@/features/judgment/components/ConclusionAnnouncer";
import { ConclusionCard } from "@/features/judgment/components/ConclusionCard";
import { Disclaimer } from "@/features/judgment/components/Disclaimer";
import { EvidenceSection } from "@/features/judgment/components/EvidenceSection";
import { JudgmentError } from "@/features/judgment/components/JudgmentError";
import { OptionList } from "@/features/judgment/components/OptionList";
import { ReasoningProgress } from "@/features/judgment/components/ReasoningProgress";
import { selectJudgmentDisplay } from "@/features/judgment/state";
import { testIds } from "@/features/judgment/testids";
import { formatClockTime } from "@/features/judgment/time";
import type { KnowledgeCatalog } from "@/features/knowledge/catalog";
import { MapPanel } from "@/features/map/MapPanel";
import { pickStationName, type StationNames } from "@/features/stations/describe";
import { cn } from "@/lib/utils";
import { computeReplayProgress } from "../clock";
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

  const nowIso = resolveScenarioTime(scenario.start_time, player.clockMinutes);
  const now = useMemo(() => new Date(nowIso), [nowIso]);
  const display = selectJudgmentDisplay(state);
  const streaming = state.status === "streaming";
  const started = player.enteredCount > 0;

  const observations = [...player.observations, ...state.observations];
  const lastWithSection = observations.findLast((o) => o.section !== null);
  const blockedLine = observations.findLast((o) => o.line !== null)?.line ?? scenario.line;
  const disclaimerExtra =
    display.judgment?.disclaimer ?? state.previousJudgment?.disclaimer ?? null;

  // 表示中の判断と、その一つ前の判断の行動
  const current = state.status === "ready" ? history.at(-1) : undefined;
  const previousAction: Action | null = current ? (history.at(-2)?.action ?? null) : null;
  const changed =
    current !== undefined && previousAction !== null && previousAction !== current.action;
  const pendingId = streaming ? (latestEntry?.id ?? "") : "";

  return (
    <div
      data-testid={testIds.replay.screen}
      data-scenario-id={scenario.id}
      data-state={player.status}
    >
      <ReplayBar
        title={pickScenarioText(scenario.title, locale)}
        subtitle={`${t("replay.trip", {
          origin: pickStationName(
            { name: origin.name, nameEn: stationNames[origin.name] ?? null },
            locale,
          ),
          destination: pickStationName(
            { name: destination.name, nameEn: stationNames[destination.name] ?? null },
            locale,
          ),
        })} · ${scenario.line}`}
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
        onBack={onBack}
      />

      <main id="main" className="mx-auto flex max-w-2xl flex-col gap-5 px-4 pt-2 pb-10">
        <h1 className="sr-only">{t("replay.heading")}</h1>
        <ConclusionAnnouncer
          judgment={state.status === "ready" ? (display.judgment ?? null) : null}
        />
        {/* 390x844 の最初の画面に発表・結論・分岐点が収まるよう、ここまでは詰めて並べる */}
        <div className="flex flex-col gap-2.5">
          {latestEntry && (
            <AnnouncementCard
              key={latestEntry.id}
              entry={latestEntry}
              timeLabel={formatClockTime(
                resolveScenarioTime(scenario.start_time, latestEntry.offset_minutes),
                locale,
              )}
            />
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
            className="flex flex-col gap-2"
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
              <div
                key={current.observationId}
                className={cn(
                  "flex flex-col rounded-3xl",
                  changed && "mt-3",
                  changed && current.action === "switch" && "animate-switch-flash",
                )}
              >
                <ConclusionCard
                  judgment={display.judgment}
                  badge={
                    changed && previousAction ? (
                      <ChangeBadge from={previousAction} to={current.action} />
                    ) : undefined
                  }
                />
              </div>
            )}
            {started && <Disclaimer />}
          </div>

          {started && (
            <div data-observation-id={current?.observationId ?? ""}>
              <BreakEvenPanel
                breakEven={display.breakEven}
                known={display.breakEvenKnown}
                stale={display.breakEvenStale}
                now={now}
              />
            </div>
          )}
        </div>

        {started && (
          <>
            <PhaseStrip estimate={display.estimate} catalog={catalog} />

            <MapPanel
              origin={origin}
              destination={destination}
              options={display.options ?? []}
              recommendedOptionId={display.recommendedOptionId}
              blockedSection={lastWithSection?.section ?? null}
              blockedLine={blockedLine}
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

            <ReplayHistory
              startTime={scenario.start_time}
              entries={scenario.timeline.slice(0, player.enteredCount)}
              history={history}
            />
          </>
        )}
      </main>
    </div>
  );
}

function ReadyCard({ scenario, onStart }: { scenario: ReplayScenario; onStart: () => void }) {
  const t = useTranslations("replay");
  const locale = useLocale();
  const deadline = scenario.user.constraints.deadline;

  return (
    <section className="flex flex-col gap-5 rounded-3xl border-2 border-border bg-surface p-5">
      <div className="flex flex-col gap-2">
        <h2 className="text-2xl font-extrabold">{t("ready.title")}</h2>
        <p className="text-lg leading-snug font-bold">{pickScenarioText(scenario.title, locale)}</p>
        <p className="text-muted">
          {formatClockTime(scenario.start_time, locale)} ·{" "}
          {deadline ? t("deadline", { time: deadline }) : t("noDeadline")}
        </p>
        <p className="text-muted">{t("ready.lead")}</p>
      </div>
      <Button size="lg" onClick={onStart} className="w-full">
        <Play aria-hidden />
        {t("ready.start")}
      </Button>
      <p className="text-sm text-muted">{t("fictional")}</p>
    </section>
  );
}

// 判断が変わったことを結論の上に短く示す
function ChangeBadge({ from, to }: { from: Action; to: Action }) {
  const t = useTranslations();
  const style = actionStyles[to];

  return (
    <p
      data-testid={testIds.replay.changeBadge}
      data-from={from}
      data-to={to}
      role="status"
      className={cn(
        "flex w-fit animate-rise-in flex-wrap items-center gap-x-2 rounded-full border-2 bg-background px-3 py-1 text-xs font-extrabold shadow-md",
        style.border,
        style.text,
      )}
    >
      {t("replay.changed")}
      <span className="flex items-center gap-1 font-bold">
        {t(`judgment.action.${from}`)}
        <ArrowRight className="size-4" aria-hidden />
        {t(`judgment.action.${to}`)}
      </span>
    </p>
  );
}
