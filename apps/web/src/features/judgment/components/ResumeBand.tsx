"use client";

import type { InCarGuide } from "@repo/schema";
import { useLocale, useTranslations } from "next-intl";
import type { CSSProperties, ReactNode } from "react";
import { cn } from "@/lib/utils";
import { buildInCarBand } from "../in-car-band";
import { testIds } from "../testids";
import { formatClockTime } from "../time";

// 駅の間の車内の人に、地図に重ねる帯。値は判断の結果のものだけを使い、画面では位置を求めるだけにする

function toPercent(x: number): string {
  return `${(x * 100).toFixed(2)}%`;
}

// 端に近い文字は帯からはみ出さないよう内側へ寄せる
function alignAt(x: number): string {
  if (x < 0.15) return "translate-x-0";
  if (x > 0.85) return "-translate-x-full";
  return "-translate-x-1/2";
}

// 駅の間の車内の人に地図に重ねる帯。動き出す見込みの幅と、次の駅に着く見込みの時刻を示す
export function InCarBand({
  guide,
  className,
  style,
  status,
}: {
  guide: InCarGuide;
  className?: string;
  style?: CSSProperties;
  // 帯の左上に小さく添える運行の状態の札
  status?: ReactNode;
}) {
  const t = useTranslations("judgment.resumeBand");
  const locale = useLocale();
  const band = buildInCarBand(guide);
  if (!band) return null;
  const clock = (iso: string) => formatClockTime(iso, locale);
  const { departure, arrival } = band;
  const range = departure.late
    ? t("range", { from: clock(departure.early), to: clock(departure.late) })
    : clock(departure.early);

  return (
    <section
      data-testid={testIds.judgment.resumeBand}
      data-kind="in-car"
      data-map-obstacle
      aria-label={
        arrival
          ? t("inCarLabel", { range, station: arrival.station, time: clock(arrival.time) })
          : t("inCarLabelNoArrival", { range })
      }
      className={cn("glass flex flex-col gap-1 rounded-2xl px-3 pt-2 pb-1.5", className)}
      style={style}
    >
      <div className="flex items-center justify-between gap-2 text-[12px] leading-none">
        <div className="flex min-w-0 items-center gap-2">
          {status}
          <h2 className="shrink-0 font-semibold text-muted">{t("inCarTitle")}</h2>
        </div>
        <p aria-hidden className="font-bold tabular-nums">
          {range}
        </p>
      </div>
      <div aria-hidden className="relative pt-4">
        {arrival && (
          <span
            className={cn(
              "absolute top-0 flex items-center gap-1 text-[11px] leading-none font-bold whitespace-nowrap tabular-nums",
              alignAt(arrival.x),
            )}
            style={{ left: toPercent(arrival.x) }}
          >
            {t("arrival", { station: arrival.station, time: clock(arrival.time) })}
          </span>
        )}
        <div className="relative h-3 overflow-hidden rounded-full bg-foreground/5">
          <span
            className="absolute inset-y-0 rounded-full bg-[var(--wait-border)]/70"
            style={{
              left: toPercent(departure.from),
              width: `max(12px, ${toPercent(departure.to - departure.from)})`,
            }}
          />
        </div>
        {arrival && (
          <span
            className="absolute bottom-[-3px] h-[18px] w-0.5 -translate-x-1/2 rounded-full bg-foreground"
            style={{ left: toPercent(arrival.x) }}
          />
        )}
      </div>
    </section>
  );
}
