"use client";

import type { TimelineEntry } from "@repo/schema";
import { useLocale, useTranslations } from "next-intl";
import { actionStyles } from "@/features/judgment/action-style";
import { testIds } from "@/features/judgment/testids";
import { formatClockTime } from "@/features/judgment/time";
import { cn } from "@/lib/utils";
import { pickScenarioText, resolveScenarioTime } from "../scenario";
import type { ReplayHistoryEntry } from "../use-replay-player";

// これまでに入力した発表と、それぞれの後の判断。新しいものを上に置く
export function ReplayHistory({
  startTime,
  entries,
  history,
}: {
  startTime: string;
  entries: TimelineEntry[];
  history: ReplayHistoryEntry[];
}) {
  const t = useTranslations();
  const locale = useLocale();
  if (entries.length === 0) return null;

  return (
    <section
      data-testid={testIds.replay.history}
      aria-labelledby="replay-history-title"
      className="flex flex-col gap-2"
    >
      <h2 id="replay-history-title" className="text-[13px] font-medium text-muted">
        {t("replay.history")}
      </h2>
      <ol className="flex flex-col gap-1.5">
        {[...entries].reverse().map((entry) => {
          const judged = history.find((h) => h.observationId === entry.id);
          const style = judged ? actionStyles[judged.action] : null;
          const Icon = style?.icon;
          return (
            <li
              key={entry.id}
              data-testid={testIds.replay.historyItem(entry.id)}
              data-observation-id={entry.id}
              data-action={judged?.action ?? ""}
              data-phase-id={judged?.phaseId ?? ""}
              data-evidence-ids={judged?.evidenceIds.join(" ") ?? ""}
              data-break-even-shown={judged ? String(judged.breakEvenShown) : ""}
              className="flex flex-col gap-1 rounded-2xl bg-foreground/[0.03] px-3 py-2.5"
            >
              <div className="flex items-center gap-2 text-[12px] text-muted">
                <span className="tabular-nums">
                  {formatClockTime(resolveScenarioTime(startTime, entry.offset_minutes), locale)}
                </span>
                <span>{t(`replay.kinds.${entry.kind}`)}</span>
                {judged && style && Icon && (
                  <span
                    className={cn(
                      "ml-auto inline-flex items-center gap-1 rounded-full px-2 py-0.5 font-semibold",
                      style.surface,
                      style.text,
                    )}
                  >
                    <Icon className="size-3.5" aria-hidden />
                    {t(`judgment.action.${judged.action}`)}
                  </span>
                )}
              </div>
              <p className="text-[13px] leading-relaxed">{pickScenarioText(entry.text, locale)}</p>
            </li>
          );
        })}
      </ol>
    </section>
  );
}
