"use client";

import { useTranslations } from "next-intl";
import { createContext, useContext } from "react";
import type { buildJudgmentChange } from "../judgment-change";
import { ActionPill } from "./ActionPill";

type JudgmentChange = ReturnType<typeof buildJudgmentChange>;

// 通常画面ではセッションから渡し、リプレイでは確定した判断を明示して渡す
export const JudgmentChangeContext = createContext<JudgmentChange>(null);

export function JudgmentChangeCard({ change }: { change?: JudgmentChange }) {
  const sessionChange = useContext(JudgmentChangeContext);
  const data = change === undefined ? sessionChange : change;
  const t = useTranslations("judgment");
  if (!data) return null;

  function formatChance(value: number | null) {
    if (value === null) return t("change.notCalculated");
    if (value <= 0) return t("resumeChance.chance.under");
    if (value >= 10) return t("resumeChance.chance.over");
    return t("resumeChance.chance.tenths", { n: value });
  }

  return (
    <section
      data-testid="judgment-change"
      data-from={data.before}
      data-to={data.after}
      aria-label={t("change.title")}
      className="flex flex-col gap-1 rounded-xl border border-border bg-foreground/[0.03] px-3 py-1.5"
    >
      <p className="text-[12px] font-semibold">{t("change.title")}</p>
      <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-2">
        <div data-testid="judgment-change-before" className="flex flex-wrap items-center gap-1">
          <span className="text-[11px] text-muted">{t("change.before")}</span>
          <ActionPill action={data.before} className="h-6 gap-1 px-2 text-[12px]" />
        </div>
        <span aria-hidden>→</span>
        <div data-testid="judgment-change-after" className="flex flex-wrap items-center gap-1">
          <span className="text-[11px] text-muted">{t("change.after")}</span>
          <ActionPill action={data.after} className="h-6 gap-1 px-2 text-[12px]" />
        </div>
      </div>
      <p
        className="line-clamp-2 text-[12px] leading-snug"
        data-testid="judgment-change-announcement"
      >
        <span className="text-muted">{t("change.announcement")}: </span>
        {data.announcement ?? t("change.noAnnouncement")}
      </p>
      <p className="text-[12px] leading-snug text-muted">
        {t("change.probability")}
        <span
          data-testid="judgment-change-probability"
          className="ml-1 whitespace-nowrap font-semibold tabular-nums text-foreground"
        >
          {formatChance(data.beforeChance)} → {formatChance(data.afterChance)}
        </span>
      </p>
    </section>
  );
}
