"use client";

import type { WeatherTrend } from "@repo/schema";
import {
  ArrowDownRight,
  ArrowRight,
  ArrowUpRight,
  CircleHelp,
  CloudRain,
  LoaderCircle,
  type LucideIcon,
  TriangleAlert,
} from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { cn } from "@/lib/utils";
import type { WeatherCheck } from "../state";
import { testIds } from "../testids";
import { formatClockTime } from "../time";
import { buildWeatherChart, formatWarningName, hasWeatherWarning } from "../weather-chart";

// 判断に使った 10 分雨量の推移を小さな棒グラフで示す。推移の向きは矢印と文字で、警報は文字で出す
// 新しい棒だけがせり上がる。動きは motion-reduce と globals.css の prefers-reduced-motion の規則で止まる

// 棒を描く領域の高さ（px）。上に最新値の文字の分を空ける
const PLOT_HEIGHT = 52;
const LABEL_SPACE = 18;
const CHART_HEIGHT = PLOT_HEIGHT + LABEL_SPACE;

const trendIcons: Record<WeatherTrend, LucideIcon> = {
  rising: ArrowUpRight,
  falling: ArrowDownRight,
  steady: ArrowRight,
  unknown: CircleHelp,
};

function formatMm(mm: number): string {
  return Number.isInteger(mm) ? String(mm) : mm.toFixed(1);
}

export function WeatherPanel({ weather, stale }: { weather: WeatherCheck; stale: boolean }) {
  const t = useTranslations("judgment.weather");
  const locale = useLocale();
  const chart = buildWeatherChart(weather.readings);
  const warning = hasWeatherWarning(weather.warnings);
  const TrendIcon = trendIcons[weather.trend];
  const latest = chart.bars.find((b) => b.latest);
  const first = weather.readings[0];
  const last = weather.readings.at(-1);
  const chartLabel = t("chartLabel", {
    values: weather.readings
      .map(
        (r) =>
          `${formatClockTime(r.time, locale)} ${
            r.rainfall10minMm === null ? t("missing") : t("mm", { mm: formatMm(r.rainfall10minMm) })
          }`,
      )
      .join(locale === "ja" ? "、" : ", "),
  });

  return (
    <section
      data-testid={testIds.judgment.weather}
      data-trend={weather.trend}
      data-reading-count={weather.readings.length}
      data-source={weather.source}
      data-warning={warning}
      data-stale={stale}
      aria-labelledby="weather-title"
      className={cn(
        "flex flex-col gap-2 rounded-3xl border-2 border-border bg-surface px-4 py-3 sm:p-5",
        stale && "opacity-70",
      )}
    >
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
        <h2
          id="weather-title"
          className="flex items-center gap-1.5 text-sm leading-tight font-extrabold text-muted"
        >
          <CloudRain className="size-4 shrink-0" aria-hidden />
          {t("title")}
          {stale && (
            <span className="flex items-center gap-1 font-bold">
              <LoaderCircle className="size-4 animate-spin" aria-hidden />
              {t("stale")}
            </span>
          )}
        </h2>
        <p
          data-testid={testIds.judgment.weatherTrend}
          className="flex items-center gap-1 rounded-full border-2 border-border px-2.5 py-0.5 text-sm font-extrabold"
        >
          <TrendIcon className="size-4 shrink-0" aria-hidden />
          {t(`trend.${weather.trend}`)}
        </p>
      </div>

      <ul data-testid={testIds.judgment.weatherWarnings} className="flex flex-wrap gap-1.5 text-sm">
        {weather.warnings.length > 0 ? (
          weather.warnings.map((name) => {
            const isWarning = hasWeatherWarning([name]);
            return (
              <li
                key={name}
                className={cn(
                  "flex items-center gap-1 rounded-md border-2 px-2 py-0.5 font-bold",
                  isWarning
                    ? "border-switch-border bg-switch-surface text-switch"
                    : "border-border text-foreground",
                )}
              >
                {isWarning && <TriangleAlert className="size-4 shrink-0" aria-hidden />}
                {t("issued", { name: formatWarningName(name, locale) })}
              </li>
            );
          })
        ) : (
          <li className="text-muted">
            {weather.source === "scenario" ? t("noWarnings") : t("warningsUnknown")}
          </li>
        )}
      </ul>

      <div className="flex flex-col gap-1">
        <div
          data-testid={testIds.judgment.weatherChart}
          className="relative w-full"
          style={{ height: CHART_HEIGHT }}
        >
          <svg
            role="img"
            aria-label={chartLabel}
            className="absolute inset-x-0 bottom-0 w-full overflow-visible"
            style={{ height: PLOT_HEIGHT }}
            viewBox={`0 0 100 ${PLOT_HEIGHT}`}
            preserveAspectRatio="none"
          >
            <line
              x1={0}
              x2={100}
              y1={PLOT_HEIGHT}
              y2={PLOT_HEIGHT}
              stroke="var(--border)"
              strokeWidth={2}
              vectorEffect="non-scaling-stroke"
            />
            {chart.bars.map((bar) =>
              bar.mm === null ? (
                <rect
                  key={bar.time}
                  data-missing="true"
                  x={bar.x * 100}
                  width={bar.width * 100}
                  y={PLOT_HEIGHT - 12}
                  height={12}
                  fill="none"
                  stroke="var(--muted)"
                  strokeWidth={1.5}
                  strokeDasharray="3 3"
                  vectorEffect="non-scaling-stroke"
                />
              ) : (
                <rect
                  key={bar.time}
                  data-bar="true"
                  data-latest={bar.latest}
                  x={bar.x * 100}
                  width={bar.width * 100}
                  // 0mm でも位置が分かるよう、細い線を残す
                  y={PLOT_HEIGHT - Math.max(bar.height * PLOT_HEIGHT, 1.5)}
                  height={Math.max(bar.height * PLOT_HEIGHT, 1.5)}
                  fill="var(--wait)"
                  fillOpacity={bar.latest ? 1 : 0.5}
                  className="origin-bottom animate-bar-grow [transform-box:fill-box] motion-reduce:animate-none"
                />
              ),
            )}
          </svg>
          {latest && latest.mm !== null && (
            <span
              aria-hidden
              className="absolute -translate-x-1/2 text-xs font-extrabold whitespace-nowrap tabular-nums"
              style={{
                left: `${((latest.x + latest.width / 2) * 100).toFixed(3)}%`,
                bottom: Math.max(latest.height * PLOT_HEIGHT, 1.5) + 2,
              }}
            >
              {t("mm", { mm: formatMm(latest.mm) })}
            </span>
          )}
          <span aria-hidden className="absolute top-0 left-0 text-xs text-muted tabular-nums">
            {t("scaleMax", { mm: chart.scaleMaxMm })}
          </span>
        </div>
        <div
          aria-hidden
          className="flex items-center justify-between gap-2 text-xs text-muted tabular-nums"
        >
          <span>{first ? formatClockTime(first.time, locale) : ""}</span>
          {chart.missingCount > 0 && (
            <span data-testid={testIds.judgment.weatherMissing} className="flex items-center gap-1">
              <span className="inline-block h-2.5 w-2 border-[1.5px] border-dashed border-muted" />
              {t("missingCount", { count: chart.missingCount })}
            </span>
          )}
          <span>{last ? formatClockTime(last.time, locale) : ""}</span>
        </div>
      </div>

      <p data-testid={testIds.judgment.weatherSummary} className="leading-snug font-bold">
        {weather.summary}
      </p>
      <p className="text-xs text-muted">
        {t("source")}
        {weather.source === "scenario" && (
          <>
            {" · "}
            <span data-testid={testIds.judgment.weatherFictional}>{t("fictional")}</span>
          </>
        )}
      </p>
    </section>
  );
}
