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

  if (scenarios.length === 0) return <p className="text-muted">{t("empty")}</p>;

  return (
    <ul data-testid={testIds.replay.scenarioList} className="flex flex-col gap-3">
      {scenarios.map((scenario) => {
        const event = findCatalogEvent(catalog, scenario.event_type);
        return (
          <li key={scenario.id}>
            <button
              type="button"
              data-testid={testIds.replay.scenario(scenario.id)}
              onClick={() => onSelect(scenario.id)}
              className="flex w-full items-center gap-3 rounded-3xl border-2 border-border bg-surface p-4 text-left transition-colors hover:bg-surface-raised"
            >
              <div className="flex min-w-0 flex-1 flex-col gap-1.5">
                {event && (
                  <span className="w-fit rounded-full bg-surface-raised px-2 py-0.5 text-sm font-bold">
                    {pickLocalized(event.name, locale)}
                  </span>
                )}
                <p className="text-lg leading-snug font-extrabold">
                  {pickScenarioText(scenario.title, locale)}
                </p>
                <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted">
                  <span className="inline-flex items-center gap-1">
                    <TrainFront className="size-4" aria-hidden />
                    {scenario.line}
                  </span>
                  <span className="inline-flex items-center gap-1 tabular-nums">
                    <Clock className="size-4" aria-hidden />
                    {formatClockTime(scenario.start_time, locale)}
                  </span>
                  <span>{t("observationCount", { count: scenario.timeline.length })}</span>
                </p>
              </div>
              <ChevronRight className="size-6 shrink-0 text-muted" aria-hidden />
            </button>
          </li>
        );
      })}
    </ul>
  );
}
