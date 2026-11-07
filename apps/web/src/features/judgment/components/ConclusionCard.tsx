"use client";

import type { Judgment } from "@repo/schema";
import { CornerDownRight } from "lucide-react";
import { useTranslations } from "next-intl";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import { splitHeadline } from "../headline";
import type { buildJudgmentChange } from "../judgment-change";
import { checkFollowStaff } from "../rule-outlook";
import { testIds } from "../testids";
import { ActionPill } from "./ActionPill";
import { JudgmentChangeCard } from "./JudgmentChangeCard";
import { NoBreakText } from "./NoBreakText";
import { ProtectionReading, StopReasonLine } from "./RuleOutlook";

export { ActionPill } from "./ActionPill";

// 理由の先頭の 1 文。閉じたシートで見出しの下に出す
export function selectCardReason(judgment: Judgment | null): string | null {
  return judgment?.reason?.match(/^.*?(?:。|[.!?](?=\s|$)|$)/s)?.[0]?.trim() || null;
}

// ひと目で分かる段。行動の見出し 1 行と、待つときの次の手、防護無線の読み、止まった理由、理由 1 行、数字 1 つだけを出す
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
          <ActionPill action={judgment.action} followStaff={checkFollowStaff(judgment)} />
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
            {/* 駅間の車内では 2 文目は動く見込みで、次の手ではない */}
            {!judgment.inCar && <span className="sr-only">{t("next")}: </span>}
            {/* flex の子に分けると時刻の前後に隙間が入るので、1 つの span にまとめる */}
            <span className="min-w-0">
              <NoBreakText text={rest} />
            </span>
          </p>
        )}
        <ProtectionReading judgment={judgment} />
        <StopReasonLine judgment={judgment} />
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
// 到着の時刻は 1 段目の数字と選択肢の行が示すので、ここでは繰り返さない
export function ConclusionDetail({ judgment }: { judgment: Judgment }) {
  const t = useTranslations("judgment");
  const cardReason = selectCardReason(judgment);
  // 閉じたシートに出した先頭の文を除き、残りだけを出す
  const reason = cardReason ? (judgment.reason ?? "").slice(cardReason.length).trim() : "";
  const remaining = judgment.estimate.remaining;
  const level = judgment.estimate.confidence;
  // 境目が無いときだけ、再開までの見込みの幅を添える。境目があれば 2 段目の図が示す
  const remainingText =
    remaining && judgment.breakEven === null ? t("conclusion.remaining", remaining) : null;

  return (
    <div className="flex flex-col gap-2">
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
      {/* 数字の札と見分けがつくよう、枠の無い小さな文字で添える */}
      <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[13px] text-muted">
        <span
          data-testid={testIds.judgment.confidence}
          data-level={level}
          className={cn(level === "low" && "font-semibold text-hold")}
        >
          {t("conclusion.confidence", { level: t(`confidence.${level}`) })}
        </span>
        {remainingText && <span className="tabular-nums">{remainingText}</span>}
      </p>
    </div>
  );
}
