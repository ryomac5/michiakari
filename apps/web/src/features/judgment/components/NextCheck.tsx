"use client";

import type { Estimate } from "@repo/schema";
import { Eye, Info, RotateCcw } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { SheetSection } from "@/components/SheetSection";
import { findCatalogEvent, type KnowledgeCatalog } from "@/features/knowledge/catalog";
import { describePlace } from "@/features/stations/describe";
import { useJudgmentSession } from "../session";
import { testIds } from "../testids";

// 入口で方面だけ・電車の中・分からないで進んだときの前提と、次に確かめること
// 確信度が高くないときだけ、次に確かめることを出す。兆候の文言は知見の抜粋から引く

// 次に確かめる兆候の数の上限
const signalLimit = 2;

function usePremises(): string[] {
  const t = useTranslations("judgment.premise");
  const tStart = useTranslations("start");
  const locale = useLocale();
  const { tripContext, origin, destination, stationNames } = useJudgmentSession();
  if (!tripContext || !origin || !destination) return [];
  const label = (place: typeof origin) =>
    describePlace(place, locale, tStart("currentLocation"), stationNames).label;
  const direction = locale === "en" ? tripContext.directionLabel.en : tripContext.directionLabel.ja;
  const items: string[] = [];
  if (tripContext.destinationBasis === "hub") {
    items.push(t("destinationHub", { station: label(destination), direction }));
  } else if (tripContext.destinationBasis === "terminal") {
    items.push(t("destinationTerminal", { station: label(destination) }));
  }
  if (tripContext.onTrain) items.push(t("onTrain", { station: label(origin) }));
  if (tripContext.elapsedMinutes === null) items.push(t("elapsedUnknown"));
  if (tripContext.causeUnknown) items.push(t("causeUnknown"));
  return items;
}

// 今の段階の次の段階に出る兆候。知見の説明は日本語だけなので、英語の画面では出さない
function listNextSignals(catalog: KnowledgeCatalog, estimate: Estimate, locale: string): string[] {
  if (locale === "en") return [];
  const event = findCatalogEvent(catalog, estimate.eventType);
  if (!event) return [];
  const index = event.phases.findIndex((p) => p.id === estimate.phaseId);
  const next = event.phases[index + 1];
  return (next?.signals ?? []).slice(0, signalLimit).map((s) => s.description);
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
  catalog,
  onUpdate,
}: {
  estimate: Estimate;
  catalog: KnowledgeCatalog;
  onUpdate: () => void;
}) {
  const t = useTranslations("judgment.nextCheck");
  const locale = useLocale();
  if (estimate.confidence === "high") return null;
  const signals = listNextSignals(catalog, estimate, locale);
  const items = [
    ...(estimate.eventType === null ? [t("cause")] : []),
    t("resume"),
    ...(estimate.eventType === null ? [t("transfer")] : []),
  ];
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
