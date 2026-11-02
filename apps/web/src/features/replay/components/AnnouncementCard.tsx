"use client";

import type { ObservableKind, TimelineEntry } from "@repo/schema";
import {
  CloudRain,
  type LucideIcon,
  Megaphone,
  MonitorSmartphone,
  Radio,
  TrainFront,
} from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { testIds } from "@/features/judgment/testids";
import { pickScenarioText } from "../scenario";

const kindIcons: Record<ObservableKind, LucideIcon> = {
  announcement: Megaphone,
  signage: MonitorSmartphone,
  station_broadcast: Radio,
  weather: CloudRain,
  train_movement: TrainFront,
};

// 入力したばかりの掲示や発表。呼び出し側で key を観測 id にし、変わるたびにせり上がらせる
export function AnnouncementCard({
  entry,
  timeLabel,
}: {
  entry: TimelineEntry;
  timeLabel: string;
}) {
  const t = useTranslations("replay.kinds");
  const locale = useLocale();
  const Icon = kindIcons[entry.kind];

  return (
    <section
      data-testid={testIds.replay.announcement}
      data-observation-id={entry.id}
      data-kind={entry.kind}
      aria-live="polite"
      className="flex animate-rise-in flex-col gap-0.5 rounded-2xl border-2 border-border bg-surface-raised px-4 py-2"
    >
      <p className="flex items-center gap-2 text-sm font-bold text-muted">
        <Icon className="size-4" aria-hidden />
        <span>{t(entry.kind)}</span>
        <span className="ml-auto tabular-nums">{timeLabel}</span>
      </p>
      <p className="line-clamp-2 text-[0.9375rem] leading-snug font-bold">
        {pickScenarioText(entry.text, locale)}
      </p>
    </section>
  );
}
