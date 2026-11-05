"use client";

import { useTranslations } from "next-intl";
import { createContext, useContext } from "react";
import { testIds } from "@/lib/testids";
import type { buildJudgmentChange } from "../judgment-change";
import { formatTenths } from "../resume-chance";
import { ActionPill } from "./ActionPill";

type JudgmentChange = ReturnType<typeof buildJudgmentChange>;

// 通常画面ではセッションから渡し、リプレイでは確定した判断を明示して渡す
export const JudgmentChangeContext = createContext<JudgmentChange>(null);

export function JudgmentChangeCard({ change }: { change?: JudgmentChange }) {
  const sessionChange = useContext(JudgmentChangeContext);
  const data = change === undefined ? sessionChange : change;
  const t = useTranslations("judgment");
  const tChance = useTranslations("judgment.resumeChance");
  if (!data) return null;

  function formatChance(value: number | null) {
    if (value === null) return t("change.notCalculated");
    return formatTenths(tChance, value);
  }

  return (
    <section
      data-testid={testIds.judgment.change}
      data-from={data.before}
      data-to={data.after}
      aria-label={t("change.title")}
      className="flex flex-col gap-1 rounded-xl border border-border bg-foreground/[0.03] px-3 py-1.5"
    >
      <p className="text-[12px] font-semibold">{t("change.title")}</p>
      <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-2">
        <div
          data-testid={testIds.judgment.changeBefore}
          className="flex flex-wrap items-center gap-1"
        >
          <span className="text-[11px] text-muted">{t("change.before")}</span>
          <ActionPill action={data.before} className="h-6 gap-1 px-2 text-[12px]" />
        </div>
        <span aria-hidden>→</span>
        <div
          data-testid={testIds.judgment.changeAfter}
          className="flex flex-wrap items-center gap-1"
        >
          <span className="text-[11px] text-muted">{t("change.after")}</span>
          <ActionPill action={data.after} className="h-6 gap-1 px-2 text-[12px]" />
        </div>
      </div>
      <p
        className="line-clamp-2 text-[12px] leading-snug"
        data-testid={testIds.judgment.changeAnnouncement}
      >
        <span className="text-muted">{t("change.announcement")}: </span>
        {data.announcement ?? t("change.noAnnouncement")}
      </p>
      <p className="text-[12px] leading-snug text-muted">
        {t("change.probability")}
        <span
          data-testid={testIds.judgment.changeProbability}
          className="ml-1 whitespace-nowrap font-semibold tabular-nums text-foreground"
        >
          {formatChance(data.beforeChance)} → {formatChance(data.afterChance)}
        </span>
      </p>
    </section>
  );
}
