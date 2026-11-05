"use client";

import type { BreakEven, ResumeChance } from "@repo/schema";
import { AlarmClock, LoaderCircle, TriangleAlert } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import type { ReactNode } from "react";
import { useLineTranslator } from "@/features/map/use-line-label";
import { cn } from "@/lib/utils";
import { splitAroundClock } from "../break-even-text";
import { buildBreakEvenTimeline, type TimelineBasis } from "../break-even-timeline";
import type { SwitchStep } from "../switch-step";
import { testIds } from "../testids";
import { type Countdown, computeCountdown, computeCountdownFrom, formatClockTime } from "../time";
import { useNow } from "../use-now";
import { BreakEvenTimeline, ResumeCaption } from "./BreakEvenTimeline";
import { NoBreakText } from "./NoBreakText";
import { ResumeChanceChart } from "./ResumeChanceChart";

// 境目がこの秒数を切ったら「まもなく」と知らせる
const soonThresholdSeconds = 5 * 60;

type BreakEvenProps = {
  breakEven: BreakEven | null;
  known: boolean;
  stale: boolean;
  // 時間軸の図に使う値。再開見込みが分からなければ null で、図を出さない
  timeline?: TimelineBasis | null;
  // 時刻ごとの再開の見込みと、待ったほうが早く着く確率。無ければ従来の 1 行の見込みを出す
  chance?: ResumeChance | null;
  // 「発生から」の言い方を出すか。入口で止まってからの時間を答えていないときは出さない
  showOnset?: boolean;
  // リプレイではシナリオ内の時刻で残り時間を数える。省略時は端末の時計
  now?: Date | null;
  // 判断の基準時刻。見出しの時刻と同じ丸め方で残り時間を数える
  judgedAt?: string | null;
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

// 結論のカードの右上に置く数字 1 つ。待つときは境目までの残り時間、切り替えるときは到着の見込み
export function BreakEvenMetric(props: BreakEvenProps & { switchStep?: SwitchStep | null }) {
  const t = useTranslations("judgment.breakEven");
  const { breakEven, stale, switchStep = null } = props;
  const { countdown, state, urgent } = useBreakEvenState(props);

  return (
    <section
      data-testid={testIds.judgment.breakEven}
      data-state={state}
      data-stale={stale}
      data-mode={switchStep ? "switch" : "break-even"}
      aria-label={t("title")}
      className={cn("flex shrink-0 flex-col items-end", stale && "opacity-60")}
    >
      {stale && (
        <span className="flex items-center gap-1 text-[11px] text-muted">
          <LoaderCircle className="size-3 animate-spin" aria-hidden />
          {t("stale")}
        </span>
      )}
      {switchStep ? (
        <SwitchStepValue step={switchStep} />
      ) : breakEven ? (
        <p
          data-testid={testIds.judgment.breakEvenCountdown}
          data-kind={countdown?.kind ?? ""}
          className={cn(
            "flex items-center gap-1 text-[20px] leading-none font-bold whitespace-nowrap tabular-nums",
            urgent && "text-switch",
          )}
        >
          {state === "soon" && <AlarmClock className="size-4" aria-hidden />}
          {state === "passed" && <TriangleAlert className="size-4" aria-hidden />}
          {countdown ? formatCountdown(countdown, t) : "…"}
        </p>
      ) : state === "pending" ? (
        <span className="text-[12px] text-muted">{t("pending")}</span>
      ) : null}
      {!switchStep && state === "soon" && (
        <p role="status" className="sr-only">
          {t("soon")}
        </p>
      )}
      {!switchStep && state === "passed" && (
        <p role="status" className="sr-only">
          {t("passed")}
        </p>
      )}
    </section>
  );
}

// 切り替え先の到着の見込み。乗る路線と駅は見出しが言うので、見た目は時刻だけにする
function SwitchStepValue({ step }: { step: SwitchStep }) {
  const t = useTranslations("judgment.switchStep");
  const locale = useLocale();
  const translateLine = useLineTranslator();
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
    <p
      data-testid={testIds.judgment.switchStep}
      data-option-id={step.optionId}
      className="text-[20px] leading-none font-bold whitespace-nowrap tabular-nums"
    >
      <span className="sr-only">
        {t("title")}: {line ? `${line} ` : ""}
        {action}。{t("arrivalLabel")}{" "}
      </span>
      <time dateTime={step.arrivalTime}>
        {t("arrival", { time: formatClockTime(step.arrivalTime, locale) })}
      </time>
    </p>
  );
}

// 閉じたシートの 2 段目。再開の見込みを 1 つの図で示す。確率が無ければ、境目とおおよその再開を 1 行で示す
export function ResumeOutlook(props: BreakEvenProps) {
  const t = useTranslations("judgment.breakEven");
  const locale = useLocale();
  const { breakEven, stale, timeline = null, chance = null, showOnset = true } = props;
  const { now } = useBreakEvenState(props);
  if (!breakEven) return null;
  const relation = timeline && now ? buildBreakEvenTimeline({ ...timeline, now }).relation : null;

  return (
    <div className={cn("flex flex-col gap-1", stale && "opacity-60")}>
      {chance ? (
        <ResumeChanceChart
          chance={chance}
          breakEvenTime={breakEven.time}
          now={now}
          showOnset={showOnset}
          relation={relation}
        />
      ) : (
        <>
          <p className="flex items-center gap-1.5 text-[13px] text-muted">
            {t("title")}
            <time
              data-testid={testIds.judgment.breakEvenTime}
              dateTime={breakEven.time}
              className="font-semibold text-foreground tabular-nums"
            >
              {formatClockTime(breakEven.time, locale)}
            </time>
          </p>
          {timeline && now && <ResumeCaption basis={timeline} now={now} />}
        </>
      )}
    </div>
  );
}

// 開いたシートに出す、境目の時間軸と説明
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
      <h2 className="text-[13px] font-medium text-muted">{t("detailTitle")}</h2>
      {timeline && now && <BreakEvenTimeline basis={timeline} now={now} />}
      <BreakEvenSentence breakEven={breakEven} />
      <p data-testid={testIds.judgment.breakEvenMeaning} className="text-[13px] text-muted">
        {t("meaning")}
      </p>
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

// 「21:40 までに再開すれば…」。説明文の中の時刻を強調し、見つからなければ定型文で補う
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
