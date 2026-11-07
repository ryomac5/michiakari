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
import {
  ConclusionDetail,
  ConclusionLead,
  ConclusionSummary,
} from "@/features/judgment/components/ConclusionCard";
import { Disclaimer } from "@/features/judgment/components/Disclaimer";
import { EvidenceSection } from "@/features/judgment/components/EvidenceSection";
import { InCarGuide } from "@/features/judgment/components/InCarGuide";
import { JudgmentError } from "@/features/judgment/components/JudgmentError";
import { NextCheckSection, PremiseSection } from "@/features/judgment/components/NextCheck";
import { OptionList } from "@/features/judgment/components/OptionList";
import { ReasoningLog, ReasoningProgress } from "@/features/judgment/components/ReasoningProgress";
import { InCarBand, ResumeBand } from "@/features/judgment/components/ResumeBand";
import { RuleOutlook } from "@/features/judgment/components/RuleOutlook";
import { TrainPositionChips } from "@/features/judgment/components/TrainPositionChips";
import { StatusChip, TripSummary } from "@/features/judgment/components/TripSummary";
import { WeatherPanel } from "@/features/judgment/components/WeatherPanel";
import { selectFallbackOptionId } from "@/features/judgment/fallback-option";
import { buildInCarBand } from "@/features/judgment/in-car-band";
import { type OriginLine, type TripContext, useJudgmentSession } from "@/features/judgment/session";
import { selectJudgmentDisplay } from "@/features/judgment/state";
import { selectStoppedPlace, selectStopScope } from "@/features/judgment/stop-scope";
import { selectSwitchStep } from "@/features/judgment/switch-step";
import { testIds } from "@/features/judgment/testids";
import { selectTimeLine } from "@/features/judgment/time-line";
import { useOptionFocus, useOptionSelection } from "@/features/judgment/use-option-focus";
import { MapLegend } from "@/features/map/MapLegend";
import { MapPanel, selectRouteTone } from "@/features/map/MapPanel";
import type { BlockedDirection, ReachSource } from "@/features/map/scene";
import type { StationGuide } from "@/features/map/station-guide";
import { useLineLabel } from "@/features/map/use-line-label";
import { resolveIncidentCause, toCauseChoiceId } from "@/features/situation/cause-categories";
import { SituationInput } from "@/features/situation/SituationInput";

// 選択肢がまだ無いときの空の配列。描画のたびに新しい配列を作ると地図の組み立てが繰り返される
const noOptions: RouteOption[] = [];
// 地図に重ねる見込みの帯が占める高さ。単位は px。地図の札と寄せる範囲をその下へずらす
const resumeBandSpace = 76;
// 閉じたシートの高さの下限。単位は px。見出しと時刻と注意書きだけなので低くし、詳細を覗かせない
const collapsedSheetMin = 120;

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

// 入口で答えた原因を統計値の大分類と種類にする。知見の無い原因も含める。分からないと答えたときは null
function selectHeardIncidentCause(tripContext: TripContext | null) {
  return resolveIncidentCause(tripContext?.entryAnswers?.cause ?? null);
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
  const stopScope = selectStopScope({
    estimatedEventType: display.estimate?.eventType,
    observations: known,
    cause: selectHeardIncidentCause(tripContext),
  });
  const stoppedPlace = selectStoppedPlace(
    trainPosition,
    origin.kind === "station" ? origin.name : null,
  );
  const blockedSection = known.findLast((o) => o.section !== null)?.section ?? null;
  const options = display.options ?? noOptions;
  const heardChoice = selectHeardCauseChoice(tripContext);
  const heardCause = heardChoice ? tEntry(`causes.${heardChoice}`) : null;
  // 近くのバス停の確認候補。確定した判断に載ったものだけを出す
  const busChecks = display.settled?.judgment.busChecks ?? [];
  const breakEvenProps = {
    breakEven: display.breakEven,
    known: display.breakEvenKnown,
    stale: display.breakEvenStale,
    judgedAt: display.settled?.at ?? null,
    timeline: selectTimelineBasis(display.settled, null),
    // 時刻ごとの再開の見込み。入口で止まってからの時間を答えたときだけ「発生から」を出す
    chance: display.breakEven?.resumeChance ?? null,
    showOnset: typeof tripContext?.elapsedMinutes === "number",
  };
  const switchStep = selectSwitchStep(display.judgment ?? null);
  // 一覧で押した選択肢を地図に描く。判断が変わって選択肢が消えたら推奨に戻す
  const chosenOptionId = options.some((o) => o.id === selectedOptionId) ? selectedOptionId : null;
  const mapOptionId = chosenOptionId ?? display.recommendedOptionId;
  // 待つ判断で動かなかったときに乗る選択肢。地図のその駅に「動かなければ」の吹き出しを出す
  const fallbackOptionId = selectFallbackOptionId(display.judgment ?? null);
  // 凡例も地図と同じ選択中の選択肢の色にする
  const tone = selectRouteTone(options, mapOptionId);
  const ready = state.status === "ready";
  const timeLine = ready && display.judgment ? selectTimeLine(display.judgment, destination) : null;
  // 見込みの帯は地図に重ねる。駅にいる人には再開の見込み、駅の間の車内の人には動き出す見込みを出す
  // 見込みの数字が無いときは出さない。線路に降りる案内のときは動き出す見込みが無い
  const resumeChance = ready && !inCar ? (display.breakEven?.resumeChance ?? null) : null;
  const inCarBandGuide =
    ready && inCar && inCarGuide && buildInCarBand(inCarGuide) ? inCarGuide : null;
  const showBand = (resumeChance !== null || inCarBandGuide !== null) && chrome.snap !== "full";
  const mapInsets = showBand
    ? { ...chrome.insets, top: chrome.insets.top + resumeBandSpace }
    : chrome.insets;

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
        fallbackOptionId={fallbackOptionId}
        blockedSection={blockedSection}
        blockedLine={blockedLine}
        blockedDirection={blockedDirection}
        trainPosition={trainPosition}
        trainOnly={stopScope === "train"}
        insets={mapInsets}
        afterAlight={inCarGuide?.afterAlight ?? null}
        motionKey={ready ? (state.judgedAt ?? null) : null}
        onAddAnnouncement={() => {
          chrome.setSnap("full");
          setFocusAddInfo(true);
        }}
        onReachSourceChange={setReachSource}
        onGuideChange={setGuide}
        onSelectOption={focusOption}
      />

      {showBand && inCarBandGuide && (
        <InCarBand
          guide={inCarBandGuide}
          className="fixed z-10 lg:max-w-[420px]"
          style={{
            top: chrome.insets.top + 8,
            left: chrome.insets.left + 12,
            right: chrome.insets.right + 12,
          }}
        />
      )}
      {showBand && resumeChance && display.breakEven && (
        <ResumeBand
          chance={resumeChance}
          breakEvenTime={display.breakEven.time}
          switching={display.judgment?.action === "switch"}
          className="fixed z-10 lg:max-w-[420px]"
          style={{
            top: chrome.insets.top + 8,
            left: chrome.insets.left + 12,
            right: chrome.insets.right + 12,
          }}
        />
      )}

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
          collapsedMin={collapsedSheetMin}
          summary={
            <div className="flex flex-col gap-3">
              {streaming && <ReasoningProgress state={state} />}
              {state.status === "error" && state.error && (
                <JudgmentError
                  message={state.error.message}
                  retryable={state.error.retryable}
                  onRetry={retry}
                />
              )}
              {/* 閉じたシートは、行動の見出しと時刻の 1 行と推定である旨だけにする。ほかの文は開いたシートに置く */}
              {ready && display.judgment && (
                <ConclusionSummary judgment={display.judgment} timeLine={timeLine} />
              )}
              <Disclaimer />
            </div>
          }
        >
          {/* 行動の札と数字、見出しの 2 文目、止まった理由、理由の先頭の文、車内の次の一手 */}
          {ready && display.judgment && (
            <SheetSection>
              <ConclusionLead
                judgment={display.judgment}
                metric={<BreakEvenMetric {...breakEvenProps} switchStep={switchStep} />}
              >
                {inCarGuide && <InCarGuide guide={inCarGuide} />}
              </ConclusionLead>
            </SheetSection>
          )}
          {/* 駅と駅の間の人の前提のチップ */}
          {trainPosition?.kind === "between_stations" && trainPosition.nextStation && (
            <SheetSection>
              <TrainPositionChips
                busy={streaming}
                onOpenEditor={() => {
                  if (chrome.snap === "collapsed") chrome.setSnap("half");
                }}
              />
            </SheetSection>
          )}
          {/* 支障の無い線路が先に動く見込みと、再開後の詰まり。乗り換え先はその選択肢の行へ寄せる */}
          {ready && display.judgment && (
            <SheetSection className="empty:hidden">
              <RuleOutlook
                judgment={display.judgment}
                onFocusOption={inCar ? undefined : focusOption}
              />
            </SheetSection>
          )}
          {/* 再開の見込みの図。地図の上の帯の詳しい形 */}
          {ready && display.breakEven && (
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
              heardCause={heardCause}
              cues={display.judgment?.cues}
              observations={known}
            />
          </SheetSection>
          {state.status === "ready" && (
            <SheetSection>
              <ReasoningLog state={state} />
            </SheetSection>
          )}
          <SheetSection
            testId={testIds.judgment.addInfo}
            title={t("addInfo.title")}
            className="pb-2"
          >
            <p className="text-[13px] text-muted">{t("addInfo.lead")}</p>
            <SituationInput
              busy={streaming}
              onSubmit={(input) => {
                submitInput(input);
                chrome.setSnap("collapsed");
              }}
            />
          </SheetSection>
          {/* 地図の見方。地図の印は見れば分かるので、いちばん下に置く */}
          <SheetSection>
            <MapLegend tone={tone} reachSource={reachSource} />
          </SheetSection>
        </MapSheet>
      </main>
    </div>
  );
}
