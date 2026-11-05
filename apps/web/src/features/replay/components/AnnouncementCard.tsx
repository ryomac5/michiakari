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
import { useEffect, useState } from "react";
import { testIds } from "@/features/judgment/testids";
import { cn } from "@/lib/utils";
import { pickScenarioText } from "../scenario";

const kindIcons: Record<ObservableKind, LucideIcon> = {
  announcement: Megaphone,
  signage: MonitorSmartphone,
  station_broadcast: Radio,
  weather: CloudRain,
  train_movement: TrainFront,
};

// 全文を見せておく時間。過ぎたら 1 行に縮める
const expandedMs = 4500;

// 入力したばかりの掲示や発表。上から通知のようにせり出し、数秒で小さくなる
// 呼び出し側で key を観測 id にし、変わるたびにせり出させる
export function AnnouncementCard({
  entry,
  timeLabel,
  concealed = false,
}: {
  entry: TimelineEntry;
  timeLabel: string;
  // シートを全部開いている間は隠す
  concealed?: boolean;
}) {
  const t = useTranslations("replay.kinds");
  const locale = useLocale();
  const Icon = kindIcons[entry.kind];
  const [expanded, setExpanded] = useState(true);

  useEffect(() => {
    const timer = window.setTimeout(() => setExpanded(false), expandedMs);
    return () => window.clearTimeout(timer);
  }, []);

  return (
    <section
      data-testid={testIds.replay.announcement}
      data-observation-id={entry.id}
      data-kind={entry.kind}
      data-expanded={expanded}
      data-map-obstacle
      aria-live="polite"
      className={cn(
        "glass pointer-events-auto flex w-full animate-drop-in items-start gap-2.5 rounded-2xl px-3 py-2.5",
        concealed && "hidden",
      )}
    >
      <span className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-full bg-foreground/[0.07]">
        <Icon className="size-4" strokeWidth={1.75} aria-hidden />
      </span>
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <p className="flex items-center gap-2 text-[12px] text-muted">
          <span className="font-medium text-foreground">{t(entry.kind)}</span>
          <span className="ml-auto tabular-nums">{timeLabel}</span>
        </p>
        <p className={cn("text-[13px] leading-snug", expanded ? "line-clamp-3" : "line-clamp-1")}>
          {pickScenarioText(entry.text, locale)}
        </p>
      </div>
    </section>
  );
}
