"use client";

import type { Judgment } from "@repo/schema";
import { useLocale, useTranslations } from "next-intl";
import { type ReactNode, useRef } from "react";
import { cn } from "@/lib/utils";
import { actionStyles } from "../action-style";
import { headlineSizesRem, splitHeadline } from "../headline";
import { testIds } from "../testids";
import { formatClockTime } from "../time";
import { useFitHeadline } from "../use-fit-headline";

// 結論を一つだけ大きく出す。最初の 1 秒で行動が分かること
export function ConclusionCard({
  judgment,
  badge,
}: {
  judgment: Judgment;
  // 行動の横に添える印（リプレイの「判断が変わりました」）
  badge?: ReactNode;
}) {
  const t = useTranslations("judgment");
  const locale = useLocale();
  const style = actionStyles[judgment.action];
  const Icon = style.icon;
  const recommended = judgment.options.find((o) => o.id === judgment.recommendedOptionId);
  const remaining = judgment.estimate.remaining;
  const { lead, rest } = splitHeadline(judgment.headline);
  const reason = judgment.reason ?? rest;
  const headlineRef = useRef<HTMLHeadingElement>(null);
  const sizeIndex = useFitHeadline(headlineRef, lead);

  return (
    <section
      data-testid={testIds.judgment.conclusion}
      data-action={judgment.action}
      aria-labelledby="conclusion-headline"
      className={cn(
        "relative flex animate-step-in flex-col gap-2.5 rounded-3xl border-2 border-l-8 px-4 py-3.5 sm:p-5",
        style.surface,
        style.border,
      )}
    >
      {/* 枠の上辺に重ねて置き、高さを使わない */}
      {badge && <div className="absolute -top-4 right-3 max-w-[80%]">{badge}</div>}
      <p className={cn("flex items-center gap-2 text-lg font-extrabold", style.text)}>
        <span
          className={cn(
            "flex size-9 shrink-0 items-center justify-center rounded-xl border-2 bg-background",
            style.border,
          )}
        >
          <Icon className="size-5" strokeWidth={2.75} aria-hidden />
        </span>
        <span className="sr-only">{t("conclusion.label")}: </span>
        {t(`action.${judgment.action}`)}
      </p>

      <h2
        id="conclusion-headline"
        ref={headlineRef}
        data-testid={testIds.judgment.conclusionHeadline}
        data-size={sizeIndex}
        style={{ fontSize: `${headlineSizesRem[sizeIndex]}rem` }}
        className="leading-[1.2] font-extrabold tracking-tight break-words"
      >
        {lead}
      </h2>

      {reason && <p className="leading-snug font-bold text-pretty">{reason}</p>}

      {/* 補足は短い札にして並べる。見出しに出ている選択肢の名前は繰り返さない */}
      <ul className="flex flex-wrap gap-1 text-[0.8125rem]">
        {recommended && judgment.action !== "wait" && (
          <li className="rounded-md bg-background/60 px-1.5 py-0.5 font-bold">
            {lead.includes(recommended.label)
              ? t("conclusion.arrival", {
                  time: formatClockTime(recommended.arrivalTime, locale),
                })
              : t("conclusion.recommended", {
                  label: recommended.label,
                  time: formatClockTime(recommended.arrivalTime, locale),
                })}
          </li>
        )}
        {remaining && (
          <li className="rounded-md bg-background/60 px-1.5 py-0.5">
            {t("conclusion.remaining", remaining)}
          </li>
        )}
        <li className="rounded-md bg-background/60 px-1.5 py-0.5">
          {t("conclusion.confidence", { level: t(`confidence.${judgment.estimate.confidence}`) })}
        </li>
      </ul>
    </section>
  );
}
