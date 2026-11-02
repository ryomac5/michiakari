"use client";

import type { BreakEven } from "@repo/schema";
import { AlarmClock, GitFork, LoaderCircle, TriangleAlert } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { cn } from "@/lib/utils";
import { testIds } from "../testids";
import { computeCountdown, formatClockTime } from "../time";
import { useNow } from "../use-now";

// 分岐点がこの秒数を切ったら「まもなく」と知らせる
const soonThresholdSeconds = 5 * 60;

export function BreakEvenPanel({
  breakEven,
  known,
  stale,
}: {
  breakEven: BreakEven | null;
  known: boolean;
  stale: boolean;
}) {
  const t = useTranslations("judgment.breakEven");
  const locale = useLocale();
  const now = useNow();
  const countdown = breakEven && now ? computeCountdown(breakEven.time, now) : null;
  const soon =
    countdown !== null && !countdown.passed && countdown.totalSeconds <= soonThresholdSeconds;
  const state = !known
    ? "pending"
    : breakEven === null
      ? "none"
      : countdown?.passed
        ? "passed"
        : soon
          ? "soon"
          : "open";

  return (
    <section
      data-testid={testIds.judgment.breakEven}
      data-state={state}
      data-stale={stale}
      aria-labelledby="break-even-title"
      className={cn(
        "flex flex-col gap-3 rounded-3xl border-2 border-border bg-surface p-5",
        (state === "soon" || state === "passed") && "border-switch-border",
        stale && "opacity-70",
      )}
    >
      <div className="flex items-center justify-between gap-2">
        <h2 id="break-even-title" className="flex items-center gap-2 text-lg font-extrabold">
          <GitFork className="size-5" aria-hidden />
          {t("title")}
        </h2>
        {stale && (
          <span className="flex items-center gap-1 text-sm font-bold text-muted">
            <LoaderCircle className="size-4 animate-spin" aria-hidden />
            {t("stale")}
          </span>
        )}
      </div>

      {state === "pending" && <p className="text-muted">{t("pending")}</p>}

      {state === "none" && (
        <div className="flex flex-col gap-1">
          <p className="text-xl font-extrabold">{t("none")}</p>
          <p className="text-muted">{t("noneDetail")}</p>
        </div>
      )}

      {breakEven && (
        <>
          {/* 残り時間を最も大きく、分岐点の時刻は右に小さく添える */}
          <div className="flex flex-wrap items-end justify-between gap-x-4 gap-y-2">
            <div className="flex flex-col gap-1">
              <span className="text-sm font-bold text-muted">{t("remaining")}</span>
              <p
                data-testid={testIds.judgment.breakEvenCountdown}
                aria-live="off"
                className={cn(
                  "text-6xl leading-none font-extrabold tabular-nums",
                  (state === "soon" || state === "passed") && "text-switch",
                )}
              >
                {countdown ? countdown.label : "--:--"}
              </p>
            </div>
            <div className="flex items-baseline gap-2">
              <span className="text-sm font-bold text-muted">{t("time")}</span>
              <p
                data-testid={testIds.judgment.breakEvenTime}
                className="text-2xl leading-none font-extrabold tabular-nums"
              >
                <time dateTime={breakEven.time}>{formatClockTime(breakEven.time, locale)}</time>
              </p>
            </div>
          </div>
          <p className="text-lg leading-snug font-bold">{breakEven.explanation}</p>
          {state === "soon" && (
            <p role="status" className="flex items-center gap-2 font-extrabold text-switch">
              <AlarmClock className="size-5" aria-hidden />
              {t("soon")}
            </p>
          )}
          {state === "passed" && (
            <p role="status" className="flex items-center gap-2 font-extrabold text-switch">
              <TriangleAlert className="size-5" aria-hidden />
              {t("passed")}
            </p>
          )}
        </>
      )}
    </section>
  );
}
