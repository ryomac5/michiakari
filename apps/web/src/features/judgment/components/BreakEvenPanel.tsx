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
import { BreakEvenTimeline, ResumeCaption } from "./BreakEvenTimeline";

// 分岐点がこの秒数を切ったら「まもなく」と知らせる
const soonThresholdSeconds = 5 * 60;

type BreakEvenProps = {
  breakEven: BreakEven | null;
  known: boolean;
  stale: boolean;
  // 時間軸の図に使う値。再開見込みが分からなければ null で、図を出さない
  timeline?: TimelineBasis | null;
  // リプレイではシナリオ内の時刻で残り時間を数える。省略時は端末の時計
  now?: Date | null;
};

type BreakEvenState = "pending" | "none" | "passed" | "soon" | "open";

function useBreakEvenState(props: BreakEvenProps) {
  const deviceNow = useNow();
  const now = props.now === undefined ? deviceNow : props.now;
  const { breakEven, known } = props;
  const countdown = breakEven && now ? computeCountdown(breakEven.time, now) : null;
  const soon =
    countdown !== null && !countdown.passed && countdown.totalSeconds <= soonThresholdSeconds;
  const state: BreakEvenState = !known
    ? "pending"
    : breakEven === null
      ? "none"
      : countdown?.passed
        ? "passed"
        : soon
          ? "soon"
          : "open";
  return { now, countdown, state, urgent: state === "soon" || state === "passed" };
}

// 閉じたシートに出す分岐点。「分岐点 21:40 まで あと 38 分」と小さな時間軸
export function BreakEvenSummary(props: BreakEvenProps) {
  const t = useTranslations("judgment.breakEven");
  const locale = useLocale();
  const { breakEven, stale, timeline = null } = props;
  const { now, countdown, state, urgent } = useBreakEvenState(props);

  return (
    <section
      data-testid={testIds.judgment.breakEven}
      data-state={state}
      data-stale={stale}
      aria-labelledby="break-even-title"
      className={cn("flex flex-col gap-2", stale && "opacity-60")}
    >
      <div className="flex items-center gap-2">
        <h2
          id="break-even-title"
          className="flex min-w-0 flex-1 items-center gap-1.5 text-[13px] text-muted"
        >
          <GitFork className="size-4 shrink-0" strokeWidth={1.75} aria-hidden />
          <span className="shrink-0">{t("title")}</span>
          {breakEven && (
            <time
              data-testid={testIds.judgment.breakEvenTime}
              dateTime={breakEven.time}
              className="font-semibold text-foreground"
            >
              {formatClockTime(breakEven.time, locale)}
            </time>
          )}
          {stale && (
            <span className="flex items-center gap-1">
              <LoaderCircle className="size-3.5 animate-spin" aria-hidden />
              {t("stale")}
            </span>
          )}
          {state === "pending" && <span>{t("pending")}</span>}
          {state === "none" && <span className="text-foreground">{t("none")}</span>}
        </h2>
        {breakEven && (
          <p
            data-testid={testIds.judgment.breakEvenCountdown}
            data-kind={countdown?.kind ?? ""}
            className={cn(
              "flex shrink-0 items-center gap-1 text-[17px] leading-none font-bold whitespace-nowrap tabular-nums",
              urgent && "text-switch",
            )}
          >
            {state === "soon" && <AlarmClock className="size-4" aria-hidden />}
            {state === "passed" && <TriangleAlert className="size-4" aria-hidden />}
            {countdown ? formatCountdown(countdown, t) : "…"}
          </p>
        )}
      </div>
      {breakEven && timeline && now && <ResumeCaption basis={timeline} now={now} />}
      {state === "soon" && (
        <p role="status" className="text-[13px] font-semibold text-switch">
          {t("soon")}
        </p>
      )}
      {/* 過ぎた瞬間を読み上げる。見た目は残り時間の表示が担う */}
      {state === "passed" && (
        <p role="status" className="sr-only">
          {t("passed")}
        </p>
      )}
    </section>
  );
}

// 半分開いたときに見せる時間軸の全体と、分岐点の説明
export function BreakEvenDetail(props: BreakEvenProps) {
  const t = useTranslations("judgment.breakEven");
  const { breakEven, timeline = null } = props;
  const { now, state } = useBreakEvenState(props);

  if (state === "none") {
    return <p className="text-[15px] leading-relaxed text-muted">{t("noneDetail")}</p>;
  }
  if (!breakEven) return null;
  return (
    <div className="flex flex-col gap-3">
      {timeline && now && <BreakEvenTimeline basis={timeline} now={now} />}
      <BreakEvenSentence breakEven={breakEven} />
    </div>
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
    <time dateTime={breakEven.time} className="font-semibold">
      {text}
    </time>
  );
  const className = "text-[15px] leading-relaxed";

  if (split) {
    return (
      <p data-testid={testIds.judgment.breakEvenSentence} className={className}>
        {split.before}
        {clock(split.clock)}
        {split.after}
      </p>
    );
  }
  const formatted = formatClockTime(breakEven.time, locale);
  return (
    <div data-testid={testIds.judgment.breakEvenSentence} className="flex flex-col gap-1">
      <p className={className}>
        {t.rich("condition", { time: formatted, clock: (chunks) => clock(chunks) })}
      </p>
      <p className="text-[13px] text-muted">{breakEven.explanation}</p>
    </div>
  );
}
