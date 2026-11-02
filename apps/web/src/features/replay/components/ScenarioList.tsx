"use client";

import { ChevronRight, Clock, TrainFront } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { testIds } from "@/features/judgment/testids";
import { formatClockTime } from "@/features/judgment/time";
import {
  findCatalogEvent,
  type KnowledgeCatalog,
  pickLocalized,
} from "@/features/knowledge/catalog";
import { pickScenarioText, type ReplayScenario } from "../scenario";

// 再生できるシナリオの一覧
export function ScenarioList({
  scenarios,
  catalog,
  onSelect,
}: {
  scenarios: ReplayScenario[];
  catalog: KnowledgeCatalog;
  onSelect: (id: string) => void;
}) {
  const t = useTranslations("replay");
  const locale = useLocale();

  if (scenarios.length === 0) return <p className="text-[14px] text-muted">{t("empty")}</p>;

  return (
    <ul data-testid={testIds.replay.scenarioList} className="-mx-2 flex flex-col">
      {scenarios.map((scenario) => {
        const event = findCatalogEvent(catalog, scenario.event_type);
        return (
          <li key={scenario.id}>
            <button
              type="button"
              data-testid={testIds.replay.scenario(scenario.id)}
              onClick={() => onSelect(scenario.id)}
              className="flex w-full items-center gap-3 rounded-2xl px-2 py-3 text-left transition-colors hover:bg-foreground/5"
            >
              <div className="flex min-w-0 flex-1 flex-col gap-1">
                {event && (
                  <span className="text-[12px] font-medium text-muted">
                    {pickLocalized(event.name, locale)}
                  </span>
                )}
                <p className="text-[15px] leading-snug font-semibold">
                  {pickScenarioText(scenario.title, locale)}
                </p>
                <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[12px] text-muted">
                  <span className="inline-flex items-center gap-1">
                    <TrainFront className="size-3.5" strokeWidth={1.75} aria-hidden />
                    {scenario.line}
                  </span>
                  <span className="inline-flex items-center gap-1 tabular-nums">
                    <Clock className="size-3.5" strokeWidth={1.75} aria-hidden />
                    {formatClockTime(scenario.start_time, locale)}
                  </span>
                  <span>{t("observationCount", { count: scenario.timeline.length })}</span>
                </p>
              </div>
              <ChevronRight className="size-5 shrink-0 text-muted" strokeWidth={1.75} aria-hidden />
            </button>
          </li>
        );
      })}
    </ul>
  );
}
