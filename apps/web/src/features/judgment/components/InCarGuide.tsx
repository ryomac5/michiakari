"use client";

import type { InCarGuide as InCarGuideData } from "@repo/schema";
import { CornerDownRight } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { testIds } from "../testids";
import { formatClockTime } from "../time";
import { NoBreakText } from "./NoBreakText";

// 駅間の車内の人への案内。ほかの手段は一覧に並べず、着いた後の次の一手があるときだけ 1 行で添える
// 降りられないあいだの過ごし方は、このアプリでは伝えない
export function InCarGuide({ guide }: { guide: InCarGuideData }) {
  const t = useTranslations("judgment.inCar");
  const locale = useLocale();
  const step = guide.afterAlight;
  if (!step) return null;

  return (
    <section
      data-testid={testIds.judgment.inCar}
      aria-label={t("title")}
      className="flex flex-col gap-1 text-[13px] text-muted"
    >
      <p
        data-testid={testIds.judgment.inCarAfterAlight}
        data-kind={step.kind}
        className="flex items-center gap-1.5"
      >
        <CornerDownRight className="size-3.5 shrink-0" strokeWidth={2} aria-hidden />
        <span className="sr-only">{t("afterAlight")}: </span>
        <NoBreakText text={step.text} />
        <time dateTime={step.arrivalTime} className="ml-auto shrink-0 tabular-nums">
          {t("arrival", { time: formatClockTime(step.arrivalTime, locale) })}
        </time>
      </p>
    </section>
  );
}
