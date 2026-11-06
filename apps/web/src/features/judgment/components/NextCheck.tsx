"use client";

import { classifyFlowOutlook } from "@repo/core";
import type { Estimate, EstimateSource, TypicalFlow } from "@repo/schema";
import { Eye, Info, RotateCcw } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { SheetSection } from "@/components/SheetSection";
import { findCatalogEvent, type KnowledgeCatalog } from "@/features/knowledge/catalog";
import { type CauseChoiceId, toCauseChoiceId } from "@/features/situation/cause-categories";
import { describePlace } from "@/features/stations/describe";
import { type TripContext, useJudgmentSession } from "../session";
import { selectJudgmentDisplay } from "../state";
import { testIds } from "../testids";

// 入口で方面だけ・電車の中・分からないで進んだときの前提と、次に確かめること
// 確信度が高くないときだけ、次に確かめることを出す。兆候の文言は知見の抜粋から引く
// 短く終わる事象では、再開見込みの放送を待たないので、発車の放送を確かめるよう示す

// 次に確かめることの数の上限。兆候と定型の項目を合わせて数える
const checkLimit = 3;

function usePremises(): string[] {
  const t = useTranslations("judgment.premise");
  const tStart = useTranslations("start");
  const tType = useTranslations("judgment.trainTypes");
  const tEntry = useTranslations("entry");
  const locale = useLocale();
  const { tripContext, origin, destination, stationNames, observations, state } =
    useJudgmentSession();
  const items: string[] = [];
  const photo = observations.findLast(
    (observation) =>
      observation.source === "photo" &&
      observation.kind === "train_movement" &&
      observation.trainsAhead !== undefined,
  );
  if (photo?.trainsAhead !== undefined) {
    items.push(
      photo.trainsAhead.length === 0
        ? t("trainsAheadPhotoNone")
        : t("trainsAheadPhoto", {
            types: photo.trainsAhead
              .map((type) => tType(type === "unknown" ? "unknownType" : type))
              .join(locale === "en" ? " · " : "・"),
          }),
    );
  }
  if (!tripContext || !origin || !destination) return items;
  const label = (place: typeof origin) =>
    describePlace(place, locale, tStart("currentLocation"), stationNames).label;
  const direction = locale === "en" ? tripContext.directionLabel.en : tripContext.directionLabel.ja;
  if (tripContext.destinationBasis === "hub") {
    items.push(t("destinationHub", { station: label(destination), direction }));
  } else if (tripContext.destinationBasis === "terminal") {
    items.push(t("destinationTerminal", { station: label(destination) }));
  }
  if (tripContext.position === "betweenStations") {
    items.push(t("betweenStations", { station: label(origin) }));
  } else if (tripContext.onTrain) {
    items.push(t("onTrain", { station: label(origin) }));
  }
  if (tripContext.elapsedMinutes === null) items.push(t("elapsedUnknown"));
  const cause = describeCausePremise(tripContext, selectJudgmentDisplay(state).estimate?.source);
  if (cause)
    items.push(
      cause.choice ? t(cause.key, { cause: tEntry(`causes.${cause.choice}`) }) : t(cause.key),
    );
  return items;
}

// 入口で答えた原因の前提。大分類を選んだら呼び名を出し、見込みが無ければ境目の時刻を目安にすると添える
// 知見が無くても統計値から見込みが出ていれば、呼び名だけを出す。見込みの出どころは説明しない
function describeCausePremise(
  tripContext: TripContext,
  source: EstimateSource | undefined,
): { key: "cause" | "causeNoPattern" | "causeUnknown"; choice: CauseChoiceId | null } | null {
  if (tripContext.causeUnknown === undefined) return null;
  const answer = tripContext.entryAnswers?.cause;
  const choice = answer ? toCauseChoiceId(answer) : null;
  if (!tripContext.causeUnknown || source === "statistics") {
    return choice ? { key: "cause", choice } : null;
  }
  return { key: choice ? "causeNoPattern" : "causeUnknown", choice };
}

// 今の段階の次の段階に出る兆候。知見の説明の文は出さず、放送で聞こえる言い回しの例で示す
// 例は日本語だけなので、英語の画面では出さない
function listNextSignals(
  catalog: KnowledgeCatalog,
  estimate: Estimate,
  locale: string,
  limit: number,
): string[] {
  if (locale === "en") return [];
  const event = findCatalogEvent(catalog, estimate.eventType);
  if (!event) return [];
  const index = event.phases.findIndex((p) => p.id === estimate.phaseId);
  const next = event.phases[index + 1];
  return (next?.signals ?? [])
    .flatMap((s) => (s.example_phrases[0] ? [`「${s.example_phrases[0]}」`] : []))
    .slice(0, Math.max(0, limit));
}

export function PremiseSection() {
  const t = useTranslations("judgment.premise");
  const premises = usePremises();
  if (premises.length === 0) return null;
  return (
    <SheetSection testId={testIds.judgment.premise} title={t("title")}>
      <ul className="flex flex-col gap-2">
        {premises.map((item) => (
          <li key={item} className="flex items-start gap-2 text-[14px] leading-relaxed">
            <Info className="mt-1 size-4 shrink-0 text-muted" strokeWidth={1.75} aria-hidden />
            {item}
          </li>
        ))}
      </ul>
    </SheetSection>
  );
}

export function NextCheckSection({
  estimate,
  flow,
  catalog,
  onUpdate,
}: {
  estimate: Estimate;
  flow: TypicalFlow | null;
  catalog: KnowledgeCatalog;
  onUpdate: () => void;
}) {
  const t = useTranslations("judgment.nextCheck");
  const locale = useLocale();
  if (estimate.confidence === "high") return null;
  const short = flow?.eventType === estimate.eventType && classifyFlowOutlook(flow) === "short";
  const items = [
    ...(estimate.eventType === null ? [t("cause")] : []),
    short ? t("departSoon") : t("resume"),
    ...(estimate.eventType === null ? [t("transfer")] : []),
  ].slice(0, checkLimit);
  const signals = listNextSignals(catalog, estimate, locale, checkLimit - items.length);
  return (
    <SheetSection testId={testIds.judgment.nextCheck} title={t("title")}>
      <ul className="flex flex-col gap-2">
        {items.map((item) => (
          <li key={item} className="flex items-start gap-2 text-[14px] leading-relaxed">
            <Eye className="mt-1 size-4 shrink-0 text-focus" strokeWidth={2} aria-hidden />
            {item}
          </li>
        ))}
      </ul>
      {signals.length > 0 && (
        <div className="flex flex-col gap-1.5 rounded-xl bg-foreground/[0.04] px-3 py-2.5">
          <p className="text-[13px] font-medium text-muted">{t("signals")}</p>
          <ul className="flex flex-col gap-1 text-[14px] leading-relaxed">
            {signals.map((s) => (
              <li key={s}>・{s}</li>
            ))}
          </ul>
        </div>
      )}
      <button
        type="button"
        data-testid={testIds.judgment.nextCheckAction}
        onClick={onUpdate}
        className="inline-flex min-h-11 w-fit items-center gap-2 rounded-full bg-focus/[0.10] px-4 text-[14px] font-semibold text-focus transition-transform duration-150 hover:bg-focus/[0.16] active:scale-[0.97]"
      >
        <RotateCcw className="size-4" strokeWidth={2} aria-hidden />
        {t("action")}
      </button>
    </SheetSection>
  );
}
