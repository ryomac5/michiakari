"use client";

import type { RouteOption } from "@repo/schema";
import { LoaderCircle, Star } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import type { OptionMark } from "@/features/map/station-guide";
import { useLineTranslator } from "@/features/map/use-line-label";
import { cn } from "@/lib/utils";
import { actionStyles, optionIcons, selectOptionTone } from "../action-style";
import { testIds } from "../testids";
import { formatClockTime, formatFare } from "../time";

// 選択肢を簡潔な行で並べる。アイコン・名前・到着・徒歩・運賃。推奨は強調する
export function OptionList({
  options,
  recommendedOptionId,
  stale,
  pending,
  marks = [],
  highlightId = null,
}: {
  options: RouteOption[] | null;
  recommendedOptionId: string | null;
  stale: boolean;
  pending: boolean;
  // 地図の吹き出しと同じ色と名前で示す、最初に乗る駅
  marks?: readonly OptionMark[];
  // 地図の吹き出しから移ってきた選択肢。しばらく目立たせる
  highlightId?: string | null;
}) {
  const t = useTranslations("judgment.options");

  return (
    <section
      data-testid={testIds.judgment.options}
      data-stale={stale}
      aria-labelledby="options-title"
      className={cn("flex flex-col gap-2", stale && "opacity-60")}
    >
      <div className="flex items-center justify-between gap-2">
        <h2 id="options-title" className="text-[13px] font-medium text-muted">
          {t("title")}
        </h2>
        {stale && (
          <span className="flex items-center gap-1 text-[12px] text-muted">
            <LoaderCircle className="size-3.5 animate-spin" aria-hidden />
            {t("stale")}
          </span>
        )}
      </div>
      {options === null && (
        <p className="text-[15px] text-muted">{pending ? t("pending") : t("empty")}</p>
      )}
      {options?.length === 0 && <p className="text-[15px] text-muted">{t("empty")}</p>}
      <ul className="flex flex-col gap-1">
        {options?.map((option) => (
          <OptionRow
            key={option.id}
            option={option}
            recommended={option.id === recommendedOptionId}
            mark={marks.find((m) => m.optionId === option.id) ?? null}
            highlighted={option.id === highlightId}
          />
        ))}
      </ul>
      {options && options.length > 0 && <p className="text-[12px] text-muted">{t("note")}</p>}
    </section>
  );
}

function OptionRow({
  option,
  recommended,
  mark,
  highlighted,
}: {
  option: RouteOption;
  recommended: boolean;
  mark: OptionMark | null;
  highlighted: boolean;
}) {
  const t = useTranslations("judgment.options");
  const locale = useLocale();
  const Icon = optionIcons[option.kind];
  const tone = actionStyles[selectOptionTone(option.kind)];
  const translateLine = useLineTranslator();
  // 英語の画面に日本語の路線名を混ぜない。英語名が無ければ「乗車」と書く
  const legs = option.legs
    .filter((leg) => leg.mode !== "wait")
    .map((leg) => {
      const line = leg.line ? translateLine(leg.line) : null;
      return `${line ?? t(`legs.${leg.mode}`)} ${t("minutes", { minutes: leg.minutes })}`;
    });

  return (
    <li
      data-testid={testIds.judgment.option(option.id)}
      data-kind={option.kind}
      data-recommended={recommended}
      data-station={mark?.key ?? ""}
      data-highlighted={highlighted}
      className={cn(
        "flex items-start gap-3 rounded-2xl px-3 py-2.5 transition-shadow duration-300",
        recommended ? [tone.surface, "ring-1 ring-inset", tone.ring] : "bg-foreground/[0.03]",
        highlighted && "ring-2 ring-foreground ring-inset",
      )}
    >
      <span
        className={cn(
          "flex size-9 shrink-0 items-center justify-center rounded-full",
          recommended ? "bg-surface" : "bg-foreground/[0.06]",
          recommended ? tone.text : "text-muted",
        )}
      >
        <Icon className="size-[18px]" strokeWidth={1.75} aria-hidden />
      </span>
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <p className="line-clamp-2 text-[15px] leading-snug font-semibold">{option.label}</p>
        {mark && (
          <p className="flex items-center gap-1.5 text-[12px] font-medium">
            <span
              aria-hidden
              className="h-3 w-1.5 shrink-0 rounded-full"
              style={{ backgroundColor: mark.color }}
            />
            {t("from", { station: mark.stationName })}
          </p>
        )}
        <p className="line-clamp-2 text-[12px] leading-snug text-muted">
          {recommended && (
            <span className={cn("font-semibold", tone.text)}>
              <Star className="mr-0.5 inline size-3 -translate-y-px fill-current" aria-hidden />
              {t("recommended")} ·{" "}
            </span>
          )}
          {option.isTransferService && <span>{t("transferService")} · </span>}
          {legs.join(" → ")}
        </p>
      </div>
      <div className="flex shrink-0 flex-col items-end gap-1 pt-0.5 text-right">
        <p className="text-[17px] leading-none font-bold tabular-nums">
          <span className="sr-only">{t("arrival")} </span>
          {formatClockTime(option.arrivalTime, locale)}
        </p>
        <p className="text-[12px] whitespace-nowrap text-muted tabular-nums">
          <span className="sr-only">{t("walk")} </span>
          {t("walkShort", { minutes: option.walkMinutes })}
          <span aria-hidden> · </span>
          <span className="sr-only">{t("fare")} </span>
          {formatFare(option.fareYen, locale)}
        </p>
      </div>
    </li>
  );
}
