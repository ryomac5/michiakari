"use client";

import type { BreakEven } from "@repo/schema";
import { AlarmClock, GitFork, LoaderCircle, TriangleAlert } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import type { ReactNode } from "react";
import { useLineTranslator } from "@/features/map/use-line-label";
import { cn } from "@/lib/utils";
import { optionIcons } from "../action-style";
import { splitAroundClock } from "../break-even-text";
import type { TimelineBasis } from "../break-even-timeline";
import type { SwitchStep } from "../switch-step";
import { testIds } from "../testids";
import { type Countdown, computeCountdown, computeCountdownFrom, formatClockTime } from "../time";
import { useNow } from "../use-now";
import { BreakEvenTimeline, ResumeCaption } from "./BreakEvenTimeline";
import { NoBreakText } from "./NoBreakText";

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
  // 判断の基準時刻。見出しの「あと23分」と同じ丸め方で残り時間を数え、2 つの数字をそろえる
  judgedAt?: string | null;
  // 結論のカードが理由を出すときは、分岐点の意味の一文を省いて閉じたシートを短く保つ
  hideMeaning?: boolean;
};

type BreakEvenSummaryProps = BreakEvenProps & {
  // 切り替えの判断では、分岐点と残り時間の代わりに切り替え先の行動を出す。分岐点は全部開いたシートの図に残す
  switchStep?: SwitchStep | null;
  // 切り替え先の路線色。地図の吹き出しと同じ色
  switchLineColor?: string | null;
};

type BreakEvenState = "pending" | "none" | "passed" | "soon" | "open";

function useBreakEvenState(props: BreakEvenProps) {
  const deviceNow = useNow();
  const now = props.now === undefined ? deviceNow : props.now;
  const { breakEven, known, judgedAt = null } = props;
  const countdown =
    breakEven && now
      ? judgedAt
        ? computeCountdownFrom(breakEven.time, judgedAt, now)
        : computeCountdown(breakEven.time, now)
      : null;
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
export function BreakEvenSummary(props: BreakEvenSummaryProps) {
  const t = useTranslations("judgment.breakEven");
  const locale = useLocale();
  const { breakEven, stale, timeline = null, switchStep = null } = props;
  const { now, countdown, state, urgent } = useBreakEvenState(props);

  return (
    <section
      data-testid={testIds.judgment.breakEven}
      data-state={state}
      data-stale={stale}
      aria-labelledby="break-even-title"
      data-mode={switchStep ? "switch" : "break-even"}
      className={cn("flex flex-col gap-2", stale && "opacity-60")}
    >
      {switchStep ? (
        <SwitchStepRow step={switchStep} lineColor={props.switchLineColor ?? null} />
      ) : (
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
      )}
      {/* 分岐点の意味を一文で添える。数値は持たず、時刻は上の行が示す */}
      {!switchStep && breakEven && state === "open" && !props.hideMeaning && (
        <p data-testid={testIds.judgment.breakEvenMeaning} className="text-[13px] text-muted">
          {t("meaning")}
        </p>
      )}
      {breakEven && timeline && now && <ResumeCaption basis={timeline} now={now} />}
      {!switchStep && state === "soon" && (
        <p role="status" className="text-[13px] font-semibold text-switch">
          {t("soon")}
        </p>
      )}
      {/* 過ぎた瞬間を読み上げる。見た目は残り時間の表示が担う */}
      {!switchStep && state === "passed" && (
        <p role="status" className="sr-only">
          {t("passed")}
        </p>
      )}
    </section>
  );
}

// 「阪急京都線 大阪梅田まで徒歩 9 分」と到着時刻。数値は推奨の選択肢の値をそのまま出す
function SwitchStepRow({ step, lineColor }: { step: SwitchStep; lineColor: string | null }) {
  const t = useTranslations("judgment.switchStep");
  const locale = useLocale();
  const translateLine = useLineTranslator();
  const Icon = optionIcons[step.kind];
  const line = step.line ? translateLine(step.line) : null;
  const action =
    step.kind === "taxi"
      ? t("taxi")
      : step.station === null
        ? t("walk", { minutes: step.walkMinutes })
        : step.walkMinutes > 0
          ? t("walkTo", { station: step.station, minutes: step.walkMinutes })
          : t("boardAt", { station: step.station });

  return (
    <div
      data-testid={testIds.judgment.switchStep}
      data-option-id={step.optionId}
      className="flex items-center gap-2"
    >
      <h2
        id="break-even-title"
        className="flex min-w-0 flex-1 items-center gap-1.5 text-[13px] leading-snug text-muted"
      >
        <span className="sr-only">{t("title")}: </span>
        {line && lineColor ? (
          <span
            aria-hidden
            className="h-3.5 w-1.5 shrink-0 rounded-full"
            style={{ backgroundColor: lineColor }}
          />
        ) : (
          <Icon className="size-4 shrink-0 text-switch" strokeWidth={1.75} aria-hidden />
        )}
        {/* 路線名と行動はそれぞれ途中で折らず、収まらなければ行動を次の行へ送る */}
        <span className="flex min-w-0 flex-wrap gap-x-1.5">
          {line && <span className="font-semibold whitespace-nowrap text-foreground">{line}</span>}
          <span className="whitespace-nowrap">{action}</span>
        </span>
      </h2>
      <p className="shrink-0 text-[17px] leading-none font-bold whitespace-nowrap tabular-nums">
        <time dateTime={step.arrivalTime}>
          {t("arrival", { time: formatClockTime(step.arrivalTime, locale) })}
        </time>
      </p>
    </div>
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
        <NoBreakText text={split.before} />
        {clock(split.clock)}
        <NoBreakText text={split.after} />
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
