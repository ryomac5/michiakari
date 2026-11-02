"use client";

import type { BreakEven } from "@repo/schema";
import { AlarmClock, GitFork, LoaderCircle, TriangleAlert } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import { splitAroundClock } from "../break-even-text";
import { testIds } from "../testids";
import { type Countdown, computeCountdown, formatClockTime } from "../time";
import { useNow } from "../use-now";

// 分岐点がこの秒数を切ったら「まもなく」と知らせる
const soonThresholdSeconds = 5 * 60;

export function BreakEvenPanel({
  breakEven,
  known,
  stale,
  now: nowOverride,
}: {
  breakEven: BreakEven | null;
  known: boolean;
  stale: boolean;
  // リプレイではシナリオ内の時刻で残り時間を数える。省略時は端末の時計
  now?: Date | null;
}) {
  const t = useTranslations("judgment.breakEven");
  const deviceNow = useNow();
  const now = nowOverride === undefined ? deviceNow : nowOverride;
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
  const urgent = state === "soon" || state === "passed";

  return (
    <section
      data-testid={testIds.judgment.breakEven}
      data-state={state}
      data-stale={stale}
      aria-labelledby="break-even-title"
      className={cn(
        "flex flex-col gap-2 rounded-3xl border-2 border-border bg-surface p-4 sm:p-5",
        urgent && "border-switch-border",
        stale && "opacity-70",
      )}
    >
      {/* 見出しと残り時間を 1 行に並べ、狭ければ折り返す */}
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
        <h2
          id="break-even-title"
          className="flex items-center gap-1.5 text-sm font-extrabold text-muted"
        >
          <GitFork className="size-4" aria-hidden />
          {t("title")}
          {stale && (
            <span className="flex items-center gap-1 text-sm font-bold">
              <LoaderCircle className="size-4 animate-spin" aria-hidden />
              {t("stale")}
            </span>
          )}
        </h2>
        {breakEven && (
          <p
            data-testid={testIds.judgment.breakEvenCountdown}
            data-kind={countdown?.kind ?? ""}
            className={cn(
              "flex items-center gap-2 text-[2rem] leading-tight font-extrabold tabular-nums",
              urgent && "text-switch",
            )}
          >
            {state === "soon" && <AlarmClock className="size-8 shrink-0" aria-hidden />}
            {state === "passed" && <TriangleAlert className="size-8 shrink-0" aria-hidden />}
            {countdown ? formatCountdown(countdown, t) : "…"}
          </p>
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
          <BreakEvenSentence breakEven={breakEven} />
          {state === "soon" && (
            <p role="status" className="font-extrabold text-switch">
              {t("soon")}
            </p>
          )}
          {/* 過ぎた瞬間を読み上げる。見た目は上の大きな表示が担う */}
          {state === "passed" && (
            <p role="status" className="sr-only">
              {t("passed")}
            </p>
          )}
        </>
      )}
    </section>
  );
}

function formatCountdown(
  countdown: Countdown,
  t: ReturnType<typeof useTranslations<"judgment.breakEven">>,
): string {
  switch (countdown.kind) {
    case "passed":
      return t("passed");
    case "imminent":
      return t("imminent");
    case "hours":
      return t("countdownHours", { hours: countdown.hours, minutes: countdown.minutes });
    case "minutes":
      return t("countdownMinutes", { minutes: countdown.minutes });
  }
}

// 「21:40 までに再開しなければ…」。説明文の中の時刻を強調し、見つからなければ定型文で補う
function BreakEvenSentence({ breakEven }: { breakEven: BreakEven }) {
  const t = useTranslations("judgment.breakEven");
  const locale = useLocale();
  const split = splitAroundClock(breakEven.explanation, breakEven.time, locale);
  const clock = (text: ReactNode) => (
    <time
      data-testid={testIds.judgment.breakEvenTime}
      dateTime={breakEven.time}
      className="rounded-md bg-surface-raised px-1 font-extrabold tabular-nums"
    >
      {text}
    </time>
  );

  if (split) {
    return (
      <p className="leading-snug font-bold sm:text-lg">
        {split.before}
        {clock(split.clock)}
        {split.after}
      </p>
    );
  }
  const formatted = formatClockTime(breakEven.time, locale);
  return (
    <div className="flex flex-col gap-1">
      <p className="leading-snug font-bold sm:text-lg">
        {t.rich("condition", { time: formatted, clock: (chunks) => clock(chunks) })}
      </p>
      <p className="text-muted">{breakEven.explanation}</p>
    </div>
  );
}
