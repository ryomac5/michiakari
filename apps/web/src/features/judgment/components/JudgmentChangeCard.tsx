"use client";

import { useTranslations } from "next-intl";
import { createContext, useContext } from "react";
import { testIds } from "@/lib/testids";
import { buildEvidenceLines } from "../evidence-text";
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
  const tEvidence = useTranslations("judgment.evidence");
  const tChance = useTranslations("judgment.resumeChance");
  if (!data) return null;

  // 読めることの文は、根拠の欄と同じ組み立てで作る
  const reading = data.evidence
    ? buildEvidenceLines([data.evidence], (key, values) =>
        tEvidence(key as never, values as never),
      )[0]?.reading
    : null;
  // 前の値が無いときは後の値だけを出す。後の値が無ければ行ごと出さない
  const chance =
    data.afterChance === null
      ? null
      : data.beforeChance === null
        ? formatTenths(tChance, data.afterChance)
        : `${formatTenths(tChance, data.beforeChance)} → ${formatTenths(tChance, data.afterChance)}`;

  // 放送、そこから読めること、判断の前後の順に並べる
  return (
    <section
      data-testid={testIds.judgment.change}
      data-from={data.before}
      data-to={data.after}
      aria-label={t("change.title")}
      className="flex flex-col gap-1 rounded-xl border border-border bg-foreground/[0.03] px-3 py-1.5"
    >
      <p className="text-[12px] font-semibold">{t("change.title")}</p>
      <p
        className="line-clamp-2 text-[12px] leading-snug"
        data-testid={testIds.judgment.changeAnnouncement}
      >
        <span className="text-muted">{t("change.announcement")}: </span>
        {data.announcement ?? t("change.noAnnouncement")}
      </p>
      {reading && (
        <p
          className="line-clamp-2 text-[12px] leading-snug"
          data-testid={testIds.judgment.changeReading}
          data-phase-id={data.evidence?.phaseId ?? ""}
        >
          <span className="text-muted">{t("evidence.reading.label")}: </span>
          {reading}
        </p>
      )}
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
      {chance && (
        <p className="text-[12px] leading-snug text-muted">
          {t("change.probability")}
          <span
            data-testid={testIds.judgment.changeProbability}
            className="ml-1 whitespace-nowrap font-semibold tabular-nums text-foreground"
          >
            {chance}
          </span>
        </p>
      )}
    </section>
  );
}
