"use client";

import type { DetectedSignal, Estimate } from "@repo/schema";
import { ChevronDown } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import type { KnowledgeCatalog } from "@/features/knowledge/catalog";
import { buildEvidenceLines, listNextSignalPhrases, selectEvidenceEntries } from "../evidence-text";
import { testIds } from "../testids";

// 根拠は見たい人だけが開ける。既定は閉
// 中身は最大 3 つの項目で、聞いたことと、そこから読めるいまの段階の 2 行にする
// 先頭のいまの段階の項目には、次に聞こえたら再開が近づく放送の言い回しを 1 行添える
export function EvidenceSection({
  estimate,
  signals,
  catalog,
  heardCause = null,
}: {
  estimate: Estimate | null;
  signals: readonly DetectedSignal[];
  catalog: KnowledgeCatalog;
  // 入口で選んだ原因の呼び名。発表の引用が無いときに聞いた言葉として出す
  heardCause?: string | null;
}) {
  const t = useTranslations("judgment.evidence");
  const locale = useLocale();
  const entries = selectEvidenceEntries({ catalog, estimate, signals, locale, heardCause });
  const lines = buildEvidenceLines(entries, (key, values) => t(key as never, values as never));
  const nextPhrase = listNextSignalPhrases(catalog, estimate, locale)[0] ?? null;

  return (
    <Collapsible
      data-testid={testIds.judgment.evidence}
      // 項目が無い間は隠す。更新中に消しても開いた状態を保つため、外さずに隠す
      hidden={lines.length === 0}
      className="group rounded-2xl bg-foreground/[0.03]"
    >
      <CollapsibleTrigger
        data-testid={testIds.judgment.evidenceToggle}
        className="flex min-h-12 w-full items-center justify-between gap-2 rounded-2xl px-4 text-left text-[15px] font-semibold"
      >
        {t("title")}
        <ChevronDown
          className="size-5 text-muted transition-transform duration-200 group-data-[state=open]:rotate-180"
          strokeWidth={1.75}
          aria-hidden
        />
      </CollapsibleTrigger>
      <CollapsibleContent className="px-4 pb-4">
        <ul className="flex flex-col gap-2">
          {lines.map((line, index) => (
            <li
              key={line.id}
              data-testid={testIds.judgment.evidenceItem(line.id)}
              data-phase-id={line.phaseId ?? ""}
              data-signal-ids={line.signalIds.join(" ")}
              data-current={line.current}
              className="rounded-xl bg-surface px-3 py-2.5"
            >
              <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-[14px] leading-snug">
                <dt className="pt-px text-[12px] text-muted">{t("heard")}</dt>
                <dd data-testid={testIds.judgment.evidenceHeard} className="font-medium">
                  {line.heard}
                </dd>
                <dt className="pt-px text-[12px] text-muted">{t("reading.label")}</dt>
                <dd data-testid={testIds.judgment.evidenceReading}>{line.reading}</dd>
              </dl>
              {index === 0 && nextPhrase && (
                <p
                  data-testid={testIds.judgment.evidenceNext}
                  className="mt-1.5 text-[13px] leading-snug text-muted"
                >
                  {t("next", { phrase: nextPhrase })}
                </p>
              )}
            </li>
          ))}
        </ul>
      </CollapsibleContent>
    </Collapsible>
  );
}
