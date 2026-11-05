"use client";

import type { Judgment } from "@repo/schema";
import { CornerDownRight } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import { splitHeadline } from "../headline";
import type { buildJudgmentChange } from "../judgment-change";
import { testIds } from "../testids";
import { formatClockTime } from "../time";
import { ActionPill } from "./ActionPill";
import { JudgmentChangeCard } from "./JudgmentChangeCard";
import { NoBreakText } from "./NoBreakText";

export { ActionPill } from "./ActionPill";

// 理由の先頭の 1 文。閉じたシートで見出しの下に出す
export function selectCardReason(judgment: Judgment | null): string | null {
  return judgment?.reason?.match(/^.*?(?:。|[.!?](?=\s|$)|$)/s)?.[0]?.trim() || null;
}

// ひと目で分かる段。行動の見出し 1 行と、待つときの次の手、理由 1 行、数字 1 つだけを出す
export function ConclusionCard({
  judgment,
  badge,
  change,
  metric,
}: {
  judgment: Judgment;
  // ピルの横に添える印（リプレイの「判断が変わりました」）
  badge?: ReactNode;
  change?: ReturnType<typeof buildJudgmentChange>;
  // 右上に置く数字。境目までの残り時間か到着の見込み
  metric?: ReactNode;
}) {
  const t = useTranslations("judgment.conclusion");
  const { lead, rest } = splitHeadline(judgment.headline);
  const cardReason = selectCardReason(judgment);

  return (
    <>
      <section
        data-testid={testIds.judgment.conclusion}
        data-action={judgment.action}
        aria-labelledby="conclusion-headline"
        className="flex flex-col gap-2"
      >
        <div className="flex min-w-0 items-center gap-2">
          <ActionPill action={judgment.action} />
          {badge}
          <div className="ml-auto">{metric}</div>
        </div>
        <h2
          id="conclusion-headline"
          data-testid={testIds.judgment.conclusionHeadline}
          className="text-[24px] leading-[1.25] font-bold tracking-tight text-balance"
        >
          <NoBreakText text={lead.replace(/。$/, "")} />
        </h2>
        {rest && (
          <p
            data-testid={testIds.judgment.conclusionNext}
            className="-mt-1 flex items-center gap-1.5 text-[15px] font-semibold text-muted"
          >
            <CornerDownRight className="size-4 shrink-0" strokeWidth={2} aria-hidden />
            <span className="sr-only">{t("next")}: </span>
            <NoBreakText text={rest} />
          </p>
        )}
        {cardReason && (
          <p
            data-testid={testIds.judgment.conclusionReason}
            className="line-clamp-2 text-[15px] leading-snug text-pretty"
          >
            <NoBreakText text={cardReason} />
          </p>
        )}
      </section>
      <JudgmentChangeCard change={change} />
    </>
  );
}

// 開いて読む段の先頭。理由の残りの文と、見込みの確かさ
export function ConclusionDetail({ judgment }: { judgment: Judgment }) {
  const t = useTranslations("judgment");
  const locale = useLocale();
  const cardReason = selectCardReason(judgment);
  // 閉じたシートに出した先頭の文を除き、残りだけを出す
  const reason = cardReason ? (judgment.reason ?? "").slice(cardReason.length).trim() : "";
  const recommended = judgment.options.find((o) => o.id === judgment.recommendedOptionId);
  const remaining = judgment.estimate.remaining;
  const level = judgment.estimate.confidence;

  const chips: string[] = [];
  // 待つときは、待った場合の到着を添える。切り替えでは閉じたシートが到着を出すので重ねない
  if (recommended && judgment.action !== "switch") {
    chips.push(t("conclusion.arrival", { time: formatClockTime(recommended.arrivalTime, locale) }));
  }
  if (remaining && judgment.breakEven === null) chips.push(t("conclusion.remaining", remaining));

  return (
    <div className="flex flex-col gap-2.5">
      {reason && (
        <h2 className="text-[13px] font-medium text-muted">{t("conclusion.reasonTitle")}</h2>
      )}
      {reason && (
        <p
          data-testid={testIds.judgment.conclusionReasonDetail}
          className="text-[15px] leading-relaxed text-pretty"
        >
          <NoBreakText text={reason} />
        </p>
      )}
      <ul className="flex flex-wrap gap-1.5 text-[12px] text-muted">
        <li
          data-testid={testIds.judgment.confidence}
          data-level={level}
          className={cn(
            "rounded-lg px-2.5 py-1",
            level === "low" ? "bg-hold-surface text-hold" : "bg-foreground/[0.06]",
          )}
        >
          {t("conclusion.confidence", { level: t(`confidence.${level}`) })}
        </li>
        {chips.map((chip) => (
          <li key={chip} className="rounded-lg bg-foreground/[0.06] px-2.5 py-1 tabular-nums">
            {chip}
          </li>
        ))}
      </ul>
    </div>
  );
}
