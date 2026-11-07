"use client";

import type { InCarGuide, ResumeChance } from "@repo/schema";
import { useLocale, useTranslations } from "next-intl";
import type { CSSProperties } from "react";
import { cn } from "@/lib/utils";
import { buildInCarBand } from "../in-car-band";
import { buildChanceChart } from "../resume-chance";
import { testIds } from "../testids";
import { formatClockTime } from "../time";

// 地図に重ねる見込みの帯。見込みの幅を 1 本の帯の濃さで示し、境目の時刻に縦の印を付ける
// 値は判断の結果のものだけを使い、画面では位置を求めるだけにする

// 帯の濃さの下限。見込みの低い時間帯も帯の形が見えるようにする
const minAlpha = 0.08;

function toPercent(x: number): string {
  return `${(x * 100).toFixed(2)}%`;
}

// 端に近い文字は帯からはみ出さないよう内側へ寄せる
function alignAt(x: number): string {
  if (x < 0.15) return "translate-x-0";
  if (x > 0.85) return "-translate-x-full";
  return "-translate-x-1/2";
}

export function ResumeBand({
  chance,
  breakEvenTime,
  switching,
  className,
  style,
}: {
  chance: ResumeChance;
  breakEvenTime: string | null;
  // 結論が切り替えか。境目より後を切り替えの色にする
  switching: boolean;
  className?: string;
  style?: CSSProperties;
}) {
  const t = useTranslations("judgment.resumeBand");
  const locale = useLocale();
  const chart = buildChanceChart({ chance, breakEvenTime, nowMs: null, switching });
  const first = chart.points[0];
  const last = chart.points.at(-1);
  const breakEven = chart.marks.find((m) => m.kind === "breakEven") ?? null;
  if (!first || !last) return null;
  const clock = (iso: string) => formatClockTime(iso, locale);
  // 時刻ごとの動いている見込みを、帯の濃さの段階にする
  const stops = chart.points
    .map((p) => {
      const alpha = Math.max(minAlpha, p.y);
      return `color-mix(in srgb, var(--wait-border) ${Math.round(alpha * 100)}%, transparent) ${toPercent(p.x)}`;
    })
    .join(", ");

  return (
    <section
      data-testid={testIds.judgment.resumeBand}
      data-map-obstacle
      aria-label={t("label", {
        from: clock(first.tick.time),
        to: clock(last.tick.time),
        breakEven: breakEven ? clock(breakEven.time) : "—",
      })}
      className={cn("glass flex flex-col gap-1 rounded-2xl px-3 pt-2 pb-1.5", className)}
      style={style}
    >
      <div className="flex items-baseline justify-between gap-2 text-[12px] leading-none">
        <h2 className="font-semibold text-muted">{t("title")}</h2>
      </div>
      <div aria-hidden className="relative pt-4">
        {breakEven && (
          <span
            className={cn(
              "absolute top-0 flex items-center gap-1 text-[11px] leading-none font-bold whitespace-nowrap tabular-nums",
              alignAt(breakEven.x),
            )}
            style={{ left: toPercent(breakEven.x) }}
          >
            {t("breakEven")}
            <time dateTime={breakEven.time}>{clock(breakEven.time)}</time>
          </span>
        )}
        <div
          className="relative h-3 overflow-hidden rounded-full bg-foreground/5"
          style={{ backgroundImage: `linear-gradient(to right, ${stops})` }}
        >
          {/* 境目より後を切り替えの色で重ねる。切り替えの判断のときだけ */}
          {switching && breakEven && (
            <span
              className="absolute inset-y-0 right-0 bg-[var(--switch-border)]/30"
              style={{ left: toPercent(breakEven.x) }}
            />
          )}
        </div>
        {breakEven && (
          <span
            className="absolute bottom-[-3px] h-[18px] w-0.5 -translate-x-1/2 rounded-full bg-foreground"
            style={{ left: toPercent(breakEven.x) }}
          />
        )}
      </div>
      <div
        aria-hidden
        className="flex justify-between text-[11px] leading-none text-muted tabular-nums"
      >
        <time dateTime={first.tick.time}>{clock(first.tick.time)}</time>
        <time dateTime={last.tick.time}>{clock(last.tick.time)}</time>
      </div>
    </section>
  );
}

// 駅の間の車内の人に地図に重ねる帯。動き出す見込みの幅と、次の駅に着く見込みの時刻を示す
export function InCarBand({
  guide,
  className,
  style,
}: {
  guide: InCarGuide;
  className?: string;
  style?: CSSProperties;
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
      <div className="flex items-baseline justify-between gap-2 text-[12px] leading-none">
        <h2 className="font-semibold text-muted">{t("inCarTitle")}</h2>
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
