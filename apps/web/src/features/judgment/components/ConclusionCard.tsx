"use client";

import type { Action, Judgment } from "@repo/schema";
import { useLocale, useTranslations } from "next-intl";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import { actionStyles } from "../action-style";
import { splitHeadline } from "../headline";
import { testIds } from "../testids";
import { formatClockTime } from "../time";
import { NoBreakText } from "./NoBreakText";

// 判断の種類のピル。アイコン・色・ラベルを必ず併せて出す
export function ActionPill({ action, className }: { action: Action; className?: string }) {
  const t = useTranslations("judgment");
  const style = actionStyles[action];
  const Icon = style.icon;

  return (
    <span
      className={cn(
        "inline-flex h-7 shrink-0 items-center gap-1.5 rounded-full pr-3 pl-2 text-[13px] font-semibold",
        style.surface,
        style.text,
        className,
      )}
    >
      <Icon className="size-4" strokeWidth={2.25} aria-hidden />
      <span className="sr-only">{t("conclusion.label")}: </span>
      {t(`action.${action}`)}
    </span>
  );
}

// 見込みが立てやすい事象では、理由に事象のよくある流れが入る。行動の理由がすぐ伝わるよう、閉じたシートに理由を出す
export function selectCardReason(judgment: Judgment | null): string | null {
  if (judgment?.typicalFlow?.predictability.level !== "high") return null;
  return judgment.reason ?? null;
}

// 結論を一つだけ大きく出す。閉じたシートに収まるよう、ピルと見出しと、流れが読める事象では理由だけにする
export function ConclusionCard({
  judgment,
  badge,
}: {
  judgment: Judgment;
  // ピルの横に添える印（リプレイの「判断が変わりました」）
  badge?: ReactNode;
}) {
  const t = useTranslations("judgment");
  const { lead } = splitHeadline(judgment.headline);
  const cardReason = selectCardReason(judgment);

  return (
    <section
      data-testid={testIds.judgment.conclusion}
      data-action={judgment.action}
      aria-labelledby="conclusion-headline"
      className="flex flex-col gap-2"
    >
      <div className="flex min-w-0 items-center gap-2">
        <ActionPill action={judgment.action} />
        {badge}
        <span className="ml-auto shrink-0 text-[12px] text-muted">
          {t("conclusion.confidence", { level: t(`confidence.${judgment.estimate.confidence}`) })}
        </span>
      </div>
      <h2
        id="conclusion-headline"
        data-testid={testIds.judgment.conclusionHeadline}
        className="line-clamp-2 text-[22px] leading-[1.3] font-bold tracking-tight text-balance"
      >
        <NoBreakText text={lead} />
      </h2>
      {cardReason && (
        <p
          data-testid={testIds.judgment.conclusionReason}
          className="line-clamp-3 text-[15px] leading-snug text-pretty"
        >
          <NoBreakText text={cardReason} />
        </p>
      )}
    </section>
  );
}

// 半分開いたときに見せる理由と補足
export function ConclusionDetail({ judgment }: { judgment: Judgment }) {
  const t = useTranslations("judgment");
  const locale = useLocale();
  const { lead, rest } = splitHeadline(judgment.headline);
  // 結論のカードが理由を出していれば、ここでは重ねない
  const reason = selectCardReason(judgment) ? null : (judgment.reason ?? rest);
  const recommended = judgment.options.find((o) => o.id === judgment.recommendedOptionId);
  const remaining = judgment.estimate.remaining;

  const chips: string[] = [];
  // 切り替えでは、閉じたシートが切り替え先の到着を出すので重ねない
  if (recommended && judgment.action === "hold") {
    chips.push(
      lead.includes(recommended.label)
        ? t("conclusion.arrival", { time: formatClockTime(recommended.arrivalTime, locale) })
        : t("conclusion.recommended", {
            label: recommended.label,
            time: formatClockTime(recommended.arrivalTime, locale),
          }),
    );
  }
  if (remaining && judgment.breakEven === null) chips.push(t("conclusion.remaining", remaining));
  if (!reason && chips.length === 0) return null;

  return (
    <div className="flex flex-col gap-2.5">
      {reason && (
        <p
          data-testid={testIds.judgment.conclusionReason}
          className="text-[15px] leading-relaxed text-pretty"
        >
          <NoBreakText text={reason} />
        </p>
      )}
      <ul className="flex flex-wrap gap-1.5 text-[12px] text-muted">
        {chips.map((chip) => (
          <li key={chip} className="rounded-lg bg-foreground/[0.06] px-2.5 py-1 tabular-nums">
            {chip}
          </li>
        ))}
      </ul>
    </div>
  );
}
