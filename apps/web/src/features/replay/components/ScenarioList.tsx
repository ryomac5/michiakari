"use client";

import { type IncidentTypeId, resolveIncidentType } from "@repo/core";
import {
  BellRing,
  Clock,
  CloudRain,
  Megaphone,
  Play,
  TrainFront,
  TriangleAlert,
  Wrench,
} from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import type { ReactNode } from "react";
import { EmptyState } from "@/components/PageShell";
import { testIds } from "@/features/judgment/testids";
import { formatClockTime } from "@/features/judgment/time";
import { pickScenarioText, type ReplayScenario } from "../scenario";
import { findScenarioCause, selectCauseLabelKey } from "../scenario-cause";

// 事象の種類ごとの印。ほかの種類は列車の印にする
const eventIcons: Partial<Record<IncidentTypeId, ReactNode>> = {
  heavy_rain: <CloudRain />,
  medical_response: <BellRing />,
  person_collision: <TriangleAlert />,
  vehicle_failure: <Wrench />,
};

function selectEventIcon(eventType: string): ReactNode {
  const type = resolveIncidentType({ eventType });
  return (type && eventIcons[type]) ?? <TrainFront />;
}

// 再生できるシナリオの格子。1 枚のカードを押すとそのシナリオを開く
export function ScenarioList({
  scenarios,
  onSelect,
}: {
  scenarios: ReplayScenario[];
  onSelect: (id: string) => void;
}) {
  const t = useTranslations("replay");
  const tEntry = useTranslations("entry");
  const locale = useLocale();

  if (scenarios.length === 0) {
    return <EmptyState icon={<TrainFront />} title={t("empty")} />;
  }

  return (
    <ul
      data-testid={testIds.replay.scenarioList}
      className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3"
    >
      {scenarios.map((scenario, i) => {
        const cause = findScenarioCause(scenario.event_type);
        const causeKey = cause ? selectCauseLabelKey(cause) : null;
        return (
          <li
            key={scenario.id}
            className="flex animate-rise-in"
            style={{ animationDelay: `${i * 60}ms` }}
          >
            <button
              type="button"
              data-testid={testIds.replay.scenario(scenario.id)}
              onClick={() => onSelect(scenario.id)}
              className="glass-strong group flex w-full flex-col gap-3 rounded-[24px] p-5 text-left sm:gap-4 transition-transform duration-150 hover:-translate-y-0.5 active:scale-[0.98]"
            >
              <span className="flex items-center gap-2.5">
                <span
                  aria-hidden
                  className="flex size-10 shrink-0 items-center justify-center rounded-[14px] bg-foreground/[0.06] [&>svg]:size-5 [&>svg]:stroke-[1.75]"
                >
                  {selectEventIcon(scenario.event_type)}
                </span>
                {causeKey && (
                  <span className="text-[13px] font-semibold text-muted">
                    {tEntry(causeKey as never)}
                  </span>
                )}
              </span>
              <span className="flex-1 text-[17px] leading-snug font-bold text-balance">
                {pickScenarioText(scenario.title, locale)}
              </span>
              <span className="flex flex-wrap items-center gap-1.5 text-[12px] font-medium text-muted">
                <Meta icon={<TrainFront />}>{scenario.line}</Meta>
                <Meta icon={<Clock />}>{formatClockTime(scenario.start_time, locale)}</Meta>
                <Meta icon={<Megaphone />}>
                  {t("observationCount", { count: scenario.timeline.length })}
                </Meta>
              </span>
              <span className="inline-flex h-9 w-fit items-center gap-2 rounded-full bg-primary pr-4 pl-3 text-[14px] font-semibold text-primary-foreground transition-transform duration-150 group-hover:translate-x-0.5">
                <Play className="size-4 fill-current" aria-hidden />
                {t("pick")}
              </span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}

function Meta({ icon, children }: { icon: ReactNode; children: ReactNode }) {
  return (
    <span className="inline-flex h-7 items-center gap-1 rounded-full bg-foreground/[0.05] px-2.5 tabular-nums [&>svg]:size-3.5 [&>svg]:stroke-[1.75]">
      {icon}
      {children}
    </span>
  );
}
