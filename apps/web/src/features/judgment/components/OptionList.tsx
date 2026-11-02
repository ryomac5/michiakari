"use client";

import type { RouteOption } from "@repo/schema";
import { ArrowRightLeft, LoaderCircle, Star } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { cn } from "@/lib/utils";
import { actionStyles, optionIcons, selectOptionTone } from "../action-style";
import { testIds } from "../testids";
import { formatClockTime, formatFare } from "../time";

// 選択肢ごとの到着時刻・運賃・徒歩時間
export function OptionList({
  options,
  recommendedOptionId,
  stale,
  pending,
}: {
  options: RouteOption[] | null;
  recommendedOptionId: string | null;
  stale: boolean;
  pending: boolean;
}) {
  const t = useTranslations("judgment.options");

  return (
    <section
      data-testid={testIds.judgment.options}
      data-stale={stale}
      aria-labelledby="options-title"
      className={cn("flex flex-col gap-3", stale && "opacity-70")}
    >
      <div className="flex items-center justify-between gap-2 px-1">
        <h2 id="options-title" className="text-lg font-extrabold">
          {t("title")}
        </h2>
        {stale && (
          <span className="flex items-center gap-1 text-sm font-bold text-muted">
            <LoaderCircle className="size-4 animate-spin" aria-hidden />
            {t("stale")}
          </span>
        )}
      </div>
      {options === null && <p className="px-1 text-muted">{pending ? t("pending") : t("empty")}</p>}
      {options?.length === 0 && <p className="px-1 text-muted">{t("empty")}</p>}
      <ul className="flex flex-col gap-3">
        {options?.map((option) => (
          <OptionCard
            key={option.id}
            option={option}
            recommended={option.id === recommendedOptionId}
          />
        ))}
      </ul>
      {options && options.length > 0 && <p className="px-1 text-sm text-muted">{t("note")}</p>}
    </section>
  );
}

function OptionCard({ option, recommended }: { option: RouteOption; recommended: boolean }) {
  const t = useTranslations("judgment.options");
  const locale = useLocale();
  const Icon = optionIcons[option.kind];
  const tone = actionStyles[selectOptionTone(option.kind)];

  return (
    <li
      data-testid={testIds.judgment.option(option.id)}
      data-kind={option.kind}
      data-recommended={recommended}
      className={cn(
        "flex flex-col gap-3 rounded-2xl border-2 bg-surface p-4",
        recommended ? tone.border : "border-border",
      )}
    >
      <div className="flex items-start gap-3">
        <span
          className={cn(
            "flex size-10 shrink-0 items-center justify-center rounded-xl",
            tone.surface,
            tone.text,
          )}
        >
          <Icon className="size-5" aria-hidden />
        </span>
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <p className="text-lg leading-snug font-bold">{option.label}</p>
          <div className="flex flex-wrap gap-2">
            {recommended && (
              <span
                className={cn(
                  "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-sm font-bold",
                  tone.surface,
                  tone.text,
                )}
              >
                <Star className="size-3.5" aria-hidden />
                {t("recommended")}
              </span>
            )}
            {option.isTransferService && (
              <span className="inline-flex items-center gap-1 rounded-full border border-border px-2 py-0.5 text-sm font-bold">
                <ArrowRightLeft className="size-3.5" aria-hidden />
                {t("transferService")}
              </span>
            )}
          </div>
        </div>
      </div>

      <dl className="grid grid-cols-3 gap-2 text-center">
        <Stat label={t("arrival")} value={formatClockTime(option.arrivalTime, locale)} strong />
        <Stat label={t("fare")} value={formatFare(option.fareYen, locale)} />
        <Stat label={t("walk")} value={t("minutes", { minutes: option.walkMinutes })} />
      </dl>

      {option.legs.length > 0 && (
        <ol className="flex flex-wrap items-center gap-x-1 gap-y-1 text-sm text-muted">
          {option.legs.map((leg, i) => (
            <li key={`${leg.mode}-${leg.from}-${leg.to}`} className="flex items-center gap-1">
              {i > 0 && <span aria-hidden>→</span>}
              <span>
                {leg.line ?? t(`legs.${leg.mode}`)} {t("minutes", { minutes: leg.minutes })}
              </span>
            </li>
          ))}
        </ol>
      )}
    </li>
  );
}

function Stat({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className="flex min-w-0 flex-col gap-0.5 rounded-xl bg-surface-raised px-1 py-2">
      <dt className="text-xs font-bold text-muted">{label}</dt>
      <dd className={cn("tabular-nums", strong ? "text-xl font-extrabold" : "text-lg font-bold")}>
        {value}
      </dd>
    </div>
  );
}
