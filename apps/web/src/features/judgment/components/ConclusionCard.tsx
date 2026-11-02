"use client";

import type { Judgment } from "@repo/schema";
import { useLocale, useTranslations } from "next-intl";
import { cn } from "@/lib/utils";
import { actionStyles } from "../action-style";
import { testIds } from "../testids";
import { formatClockTime } from "../time";

// 結論を一つだけ大きく出す。最初の 1 秒で行動が分かること
export function ConclusionCard({ judgment }: { judgment: Judgment }) {
  const t = useTranslations("judgment");
  const locale = useLocale();
  const style = actionStyles[judgment.action];
  const Icon = style.icon;
  const recommended = judgment.options.find((o) => o.id === judgment.recommendedOptionId);
  const remaining = judgment.estimate.remaining;

  return (
    <section
      data-testid={testIds.judgment.conclusion}
      data-action={judgment.action}
      aria-label={t("conclusion.label")}
      className={cn(
        "flex min-h-[33dvh] animate-step-in flex-col justify-between gap-5 rounded-3xl border-l-8 border-2 p-5",
        style.surface,
        style.border,
      )}
    >
      <div className="flex items-center gap-3">
        <span
          className={cn(
            "flex size-14 shrink-0 items-center justify-center rounded-2xl border-2 bg-background",
            style.border,
            style.text,
          )}
        >
          <Icon className="size-8" strokeWidth={2.5} aria-hidden />
        </span>
        <p className={cn("text-2xl font-extrabold tracking-wide", style.text)}>
          {t(`action.${judgment.action}`)}
        </p>
      </div>

      <h1
        data-testid={testIds.judgment.conclusionHeadline}
        className="text-[2rem] leading-tight font-extrabold sm:text-4xl"
      >
        {judgment.headline}
      </h1>

      <div className="flex flex-col gap-1 text-base">
        {recommended && judgment.action !== "wait" && (
          <p className="font-bold">
            {t("conclusion.recommended", {
              label: recommended.label,
              time: formatClockTime(recommended.arrivalTime, locale),
            })}
          </p>
        )}
        <p className="text-muted">
          {remaining && <span>{t("conclusion.remaining", remaining)} · </span>}
          {t("conclusion.confidence", { level: t(`confidence.${judgment.estimate.confidence}`) })}
        </p>
      </div>
    </section>
  );
}
