"use client";

import type { BreakEven } from "@repo/schema";
import { AlarmClock, GitFork, LoaderCircle, TriangleAlert } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import { splitAroundClock } from "../break-even-text";
import type { TimelineBasis } from "../break-even-timeline";
import { testIds } from "../testids";
import { type Countdown, computeCountdown, formatClockTime } from "../time";
import { useNow } from "../use-now";
import { BreakEvenTimeline } from "./BreakEvenTimeline";

// 分岐点がこの秒数を切ったら「まもなく」と知らせる
const soonThresholdSeconds = 5 * 60;

export function BreakEvenPanel({
  breakEven,
  known,
  stale,
  now: nowOverride,
  timeline = null,
}: {
  breakEven: BreakEven | null;
  known: boolean;
  stale: boolean;
  // 時間軸の図に使う値。再開見込みが分からなければ null で、図を出さない
  timeline?: TimelineBasis | null;
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
        "flex flex-col gap-2 rounded-3xl border-2 border-border bg-surface px-4 py-3 sm:p-5",
        urgent && "border-switch-border",
        stale && "opacity-70",
      )}
    >
      {/* 見出しと残り時間を 1 行に並べる。狭ければ見出しの中で折り返す */}
      <div className="flex items-center justify-between gap-x-3">
        <h2
          id="break-even-title"
          className="flex min-w-0 flex-wrap items-center gap-x-1.5 text-sm leading-tight font-extrabold text-muted"
        >
          <span className="flex min-w-0 items-center gap-1.5">
            <GitFork className="size-4 shrink-0" aria-hidden />
            {t("title")}
          </span>
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
              "flex shrink-0 items-center gap-2 text-[1.75rem] leading-none font-extrabold whitespace-nowrap tabular-nums sm:text-[2rem]",
              urgent && "text-switch",
            )}
          >
            {state === "soon" && <AlarmClock className="size-7 shrink-0" aria-hidden />}
            {state === "passed" && <TriangleAlert className="size-7 shrink-0" aria-hidden />}
            {countdown ? formatCountdown(countdown, t) : "…"}
          </p>
        )}
      </div>

      {breakEven && timeline && now && <BreakEvenTimeline basis={timeline} now={now} />}

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
      <p className="text-[0.9375rem] leading-snug font-bold sm:text-lg">
        {split.before}
        {clock(split.clock)}
        {split.after}
      </p>
    );
  }
  const formatted = formatClockTime(breakEven.time, locale);
  return (
    <div className="flex flex-col gap-1">
      <p className="text-[0.9375rem] leading-snug font-bold sm:text-lg">
        {t.rich("condition", { time: formatted, clock: (chunks) => clock(chunks) })}
      </p>
      <p className="text-muted">{breakEven.explanation}</p>
    </div>
  );
}
