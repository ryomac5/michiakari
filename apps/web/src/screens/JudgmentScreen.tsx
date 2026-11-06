"use client";

import type { RouteOption } from "@repo/schema";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useEffect, useMemo, useState } from "react";
import { AppHeader } from "@/components/AppHeader";
import { HeaderBackButton } from "@/components/HeaderBackButton";
import { MapSheet } from "@/components/MapSheet";
import { SheetSection, useMapChrome } from "@/components/SheetSection";
import { selectTimelineBasis } from "@/features/judgment/break-even-timeline";
import {
  BreakEvenDetail,
  BreakEvenMetric,
  ResumeOutlook,
} from "@/features/judgment/components/BreakEvenPanel";
import { BusChecksSection } from "@/features/judgment/components/BusChecks";
import { ConclusionAnnouncer } from "@/features/judgment/components/ConclusionAnnouncer";
import { ConclusionCard, ConclusionDetail } from "@/features/judgment/components/ConclusionCard";
import { Disclaimer } from "@/features/judgment/components/Disclaimer";
import { EvidenceSection } from "@/features/judgment/components/EvidenceSection";
import { InCarGuide } from "@/features/judgment/components/InCarGuide";
import { JudgmentError } from "@/features/judgment/components/JudgmentError";
import { NextCheckSection, PremiseSection } from "@/features/judgment/components/NextCheck";
import { OptionList } from "@/features/judgment/components/OptionList";
import { ReasoningLog, ReasoningProgress } from "@/features/judgment/components/ReasoningProgress";
import { TrainPositionChips } from "@/features/judgment/components/TrainPositionChips";
import { StatusChip, TripSummary } from "@/features/judgment/components/TripSummary";
import { WeatherPanel } from "@/features/judgment/components/WeatherPanel";
import { type OriginLine, type TripContext, useJudgmentSession } from "@/features/judgment/session";
import { selectJudgmentDisplay } from "@/features/judgment/state";
import { selectStoppedPlace, selectStopScope } from "@/features/judgment/stop-scope";
import { selectSwitchStep } from "@/features/judgment/switch-step";
import { testIds } from "@/features/judgment/testids";
import { useOptionFocus, useOptionSelection } from "@/features/judgment/use-option-focus";
import { MapLegend } from "@/features/map/MapLegend";
import { MapPanel, selectRouteTone } from "@/features/map/MapPanel";
import type { BlockedDirection, ReachSource } from "@/features/map/scene";
import type { StationGuide } from "@/features/map/station-guide";
import { useLineLabel } from "@/features/map/use-line-label";
import { toCauseChoiceId } from "@/features/situation/cause-categories";
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

// 入口で選んだ原因。知見に当たる原因を選んだときだけ、根拠の聞いたこととして出す
function selectHeardCauseChoice(tripContext: TripContext | null) {
  const answer = tripContext?.entryAnswers?.cause;
  if (tripContext?.causeUnknown !== false || !answer) return null;
  return toCauseChoiceId(answer);
}

export function JudgmentScreen() {
  const t = useTranslations("judgment");
  const tEntry = useTranslations("entry");
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
    trainPosition,
  } = useJudgmentSession();

  // 入口で預けた判断は、この画面が開いてから流し始める
  useEffect(() => {
    resumeJudgment();
  }, [resumeJudgment]);
  const chrome = useMapChrome();
  // 情報を追加するとき、シートが開き切った次のフレームで入力欄へ寄せる
  const [focusAddInfo, setFocusAddInfo] = useState(false);
  useEffect(() => {
    if (!focusAddInfo || chrome.snap !== "full") return;
    const frame = window.requestAnimationFrame(() => {
      document
        .querySelector(`[data-testid="${testIds.judgment.addInfo}"]`)
        ?.scrollIntoView({ behavior: "smooth", block: "start" });
      setFocusAddInfo(false);
    });
    return () => window.cancelAnimationFrame(frame);
  }, [focusAddInfo, chrome.snap]);
  const [reachSource, setReachSource] = useState<ReachSource | null>(null);
  const [guide, setGuide] = useState<StationGuide | null>(null);
  const { highlightId, focusOption } = useOptionFocus(chrome.setSnap);
  const { selectedOptionId, selectOption } = useOptionSelection(chrome.setSnap, state.judgedAt);
  const known = [...observations, ...state.observations];
  const blockedLine = known.findLast((o) => o.line !== null)?.line ?? null;
  const lineLabel = useLineLabel(blockedLine);

  // 入口で選んだ路線と方面。発表に区間が無いあいだ、地図は利用者のいる路線として薄く示す
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
  // 駅間の車内の人は降りられない。選択肢の一覧・バス停・乗り換え候補の駅を出さず、車内の案内だけを出す
  const inCar = trainPosition?.kind === "between_stations";
  const inCarGuide = display.judgment?.inCar ?? null;
  // 止まり方。その列車だけが止まる事象では、見合わせの札と止まった区間の線を出さない
  const stopScope = selectStopScope(display.estimate?.eventType, known);
  const stoppedPlace = selectStoppedPlace(
    trainPosition,
    origin.kind === "station" ? origin.name : null,
  );
  const blockedSection = known.findLast((o) => o.section !== null)?.section ?? null;
  const options = display.options ?? noOptions;
  const typicalFlow = display.settled?.judgment.typicalFlow ?? null;
  const heardChoice = selectHeardCauseChoice(tripContext);
  const heardCause = heardChoice ? tEntry(`causes.${heardChoice}`) : null;
  // 近くのバス停の確認候補。確定した判断に載ったものだけを出す
  const busChecks = display.settled?.judgment.busChecks ?? [];
  const breakEvenProps = {
    breakEven: display.breakEven,
    known: display.breakEvenKnown,
    stale: display.breakEvenStale,
    judgedAt: display.settled?.at ?? null,
    timeline: selectTimelineBasis(display.settled, catalog, null),
    // 時刻ごとの再開の見込み。入口で止まってからの時間を答えたときだけ「発生から」を出す
    chance: display.breakEven?.resumeChance ?? null,
    showOnset: typeof tripContext?.elapsedMinutes === "number",
  };
  const switchStep = selectSwitchStep(display.judgment ?? null);
  // 一覧で押した選択肢を地図に描く。判断が変わって選択肢が消えたら推奨に戻す
  const chosenOptionId = options.some((o) => o.id === selectedOptionId) ? selectedOptionId : null;
  const mapOptionId = chosenOptionId ?? display.recommendedOptionId;
  // 凡例も地図と同じ選択中の選択肢の色にする
  const tone = selectRouteTone(options, mapOptionId);

  return (
    <div data-testid={testIds.judgment.screen} data-status={state.status} className="h-dvh">
      {/* 戻るは端末の戻る操作と同じ道を通し、入口の最後に答えた段へ戻る。更新中と失敗時にも押せる */}
      <AppHeader
        variant="map"
        leading={
          <HeaderBackButton
            label={t("back")}
            testId={testIds.judgment.backButton}
            onClick={() => router.back()}
          />
        }
      >
        <TripSummary
          origin={origin}
          destination={destination}
          testId={testIds.judgment.tripSummary}
        />
        {(blockedLine || stopScope === "train") && (
          <StatusChip
            line={blockedLine ? lineLabel : null}
            scope={stopScope}
            place={
              stoppedPlace === null
                ? null
                : stoppedPlace.kind === "between"
                  ? t("tripBetween", { from: stoppedPlace.from, to: stoppedPlace.to })
                  : stoppedPlace.name
            }
            testId={testIds.judgment.statusChip}
          />
        )}
      </AppHeader>

      <MapPanel
        origin={origin}
        destination={destination}
        options={options}
        recommendedOptionId={display.recommendedOptionId}
        selectedOptionId={chosenOptionId}
        blockedSection={blockedSection}
        blockedLine={blockedLine}
        blockedDirection={blockedDirection}
        trainPosition={trainPosition}
        trainOnly={stopScope === "train"}
        insets={chrome.insets}
        onAddAnnouncement={() => {
          chrome.setSnap("full");
          setFocusAddInfo(true);
        }}
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
              {/* 駅と駅の間の人には、次の駅・種別・前の列車の前提をチップで出し、その場で直せるようにする */}
              <TrainPositionChips
                busy={streaming}
                onOpenEditor={() => {
                  if (chrome.snap === "collapsed") chrome.setSnap("half");
                }}
              />
              {streaming && <ReasoningProgress state={state} catalog={catalog} />}
              {state.status === "error" && state.error && (
                <JudgmentError
                  message={state.error.message}
                  retryable={state.error.retryable}
                  onRetry={retry}
                />
              )}
              {/* 1 段目: 行動の見出し、理由、数字 1 つ、推定である旨 */}
              {state.status === "ready" && display.judgment && (
                <ConclusionCard
                  judgment={display.judgment}
                  metric={<BreakEvenMetric {...breakEvenProps} switchStep={switchStep} />}
                />
              )}
              {state.status === "ready" && inCarGuide && <InCarGuide guide={inCarGuide} />}
              <Disclaimer />
            </div>
          }
        >
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
          {/* 3 段目: 理由の残り、境目の見方、ほかの選択肢、根拠、判断の過程 */}
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
          {!inCar && (
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
          )}
          {!inCar && busChecks.length > 0 && (
            <SheetSection>
              <BusChecksSection busChecks={busChecks} />
            </SheetSection>
          )}
          {state.status === "ready" && display.estimate && (
            <NextCheckSection
              estimate={display.estimate}
              flow={typicalFlow}
              catalog={catalog}
              onUpdate={() => {
                chrome.setSnap("full");
                setFocusAddInfo(true);
              }}
            />
          )}
          {state.status === "ready" && <PremiseSection />}
          <SheetSection className="has-[>[hidden]]:hidden">
            <EvidenceSection
              estimate={display.estimate}
              signals={state.signals}
              catalog={catalog}
              heardCause={heardCause}
            />
          </SheetSection>
          {state.status === "ready" && (
            <SheetSection>
              <ReasoningLog state={state} catalog={catalog} />
            </SheetSection>
          )}
          <SheetSection>
            <MapLegend tone={tone} reachSource={reachSource} />
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
