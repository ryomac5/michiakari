"use client";

import type { Judgment } from "@repo/schema";
import { useLocale, useTranslations } from "next-intl";
import { type ReactNode, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import { actionStyles } from "../action-style";
import { headlineSizesRem, splitHeadline } from "../headline";
import { testIds } from "../testids";
import { formatClockTime } from "../time";
import { useFitHeadline } from "../use-fit-headline";
import { useOverflow } from "../use-overflow";

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
  const reasonRef = useRef<HTMLParagraphElement>(null);
  const reasonClamped = useOverflow(reasonRef, reason ?? "");
  // 全文を開いた理由。判断が変わったら閉じた状態に戻る
  const [openReason, setOpenReason] = useState<string | null>(null);
  const reasonOpen = reason !== undefined && reason !== "" && openReason === reason;

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

      {/* スマートフォンでは理由を 2 行に切り詰め、タップで全文を出す */}
      {reason && (
        <div className="relative">
          <p
            ref={reasonRef}
            data-testid={testIds.judgment.conclusionReason}
            data-expanded={reasonOpen}
            className={cn(
              "leading-snug font-bold text-pretty",
              !reasonOpen && "line-clamp-2 sm:line-clamp-none",
            )}
          >
            {reason}
          </p>
          {(reasonClamped || reasonOpen) && (
            <button
              type="button"
              aria-expanded={reasonOpen}
              aria-label={t("conclusion.expandReason")}
              onClick={() => setOpenReason(reasonOpen ? null : reason)}
              className="absolute inset-0 min-h-11 w-full rounded-md"
            />
          )}
        </div>
      )}

      {/* 補足は短い札にして 1 行に並べる。見出しに出ている選択肢の名前は繰り返さない */}
      {/* 再開までの残りは、分岐点の時間軸が出るときはそちらに任せる */}
      <ul className="flex gap-1 overflow-hidden text-[0.8125rem] whitespace-nowrap">
        {recommended && judgment.action !== "wait" && (
          <li className="flex min-w-0 rounded-md bg-background/60 px-1.5 py-0.5 font-bold">
            {lead.includes(recommended.label)
              ? t("conclusion.arrival", {
                  time: formatClockTime(recommended.arrivalTime, locale),
                })
              : t.rich("conclusion.recommended", {
                  label: recommended.label,
                  time: formatClockTime(recommended.arrivalTime, locale),
                  name: (chunks) => <span className="min-w-0 truncate">{chunks}</span>,
                })}
          </li>
        )}
        {remaining && judgment.breakEven === null && (
          <li className="shrink-0 rounded-md bg-background/60 px-1.5 py-0.5">
            {t("conclusion.remaining", remaining)}
          </li>
        )}
        <li className="shrink-0 rounded-md bg-background/60 px-1.5 py-0.5">
          {t("conclusion.confidence", { level: t(`confidence.${judgment.estimate.confidence}`) })}
        </li>
      </ul>
    </section>
  );
}
