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

// 見せておく時間。過ぎたら畳む
const expandedMs = 4500;

// 入力したばかりの掲示や発表。上部の帯の下に通知のようにせり出し、数秒で畳む
// 呼び出し側で key を観測 id にし、変わるたびにせり出させる
export function AnnouncementCard({
  entry,
  timeLabel,
  concealed = false,
}: {
  entry: TimelineEntry;
  timeLabel: string;
  // シートを開いている間は隠す。開いたシートの上端は再生バーのすぐ下まで来る
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

  // 数秒見せたら畳み、地図を広く残す。発表はシートの経過にも残る
  return (
    <section
      data-testid={testIds.replay.announcement}
      data-observation-id={entry.id}
      data-kind={entry.kind}
      data-expanded={expanded}
      data-map-obstacle
      aria-live="polite"
      className={cn(
        "glass pointer-events-auto flex w-full animate-drop-in items-start gap-2 rounded-xl px-3 py-2",
        (concealed || !expanded) && "hidden",
      )}
    >
      <Icon className="mt-0.5 size-4 shrink-0 text-muted" strokeWidth={1.75} aria-hidden />
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <p className="flex items-center gap-2 text-[12px] text-muted">
          <span className="font-medium text-foreground">{t(entry.kind)}</span>
          <span className="ml-auto tabular-nums">{timeLabel}</span>
        </p>
        <p className="line-clamp-2 text-[14px] leading-snug">
          {pickScenarioText(entry.text, locale)}
        </p>
      </div>
    </section>
  );
}
