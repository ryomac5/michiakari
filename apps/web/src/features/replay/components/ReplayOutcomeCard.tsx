"use client";

import type { ReplayOutcome } from "@repo/core";
import { CircleCheck, CircleX, Flag, TriangleAlert } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { actionStyles } from "@/features/judgment/action-style";
import { testIds } from "@/features/judgment/testids";
import { formatClockTime } from "@/features/judgment/time";
import { cn } from "@/lib/utils";
import { selectOutcomeSummary } from "../outcome";

type DeadlineCheck = ReplayOutcome["followed"]["deadline"];

// リプレイの結末。判断に従った人と、比べる相手の到着時刻を並べる
// 相手は、切り替えの判断なら待ち続けた人、待つ判断なら最初に切り替えた人
export function ReplayOutcomeCard({
  outcome,
  deadlineClock,
}: {
  outcome: ReplayOutcome;
  deadlineClock: string | null;
}) {
  const t = useTranslations();
  const locale = useLocale();
  const summary = selectOutcomeSummary(outcome);
  const deadline = deadlineClock ?? "";
  const { followed, counterpart } = outcome;
  const counterpartTime = counterpart.switchedAt
    ? formatClockTime(counterpart.switchedAt, locale)
    : "";

  return (
    <section
      data-testid={testIds.replay.outcome}
      data-verdict={outcome.verdict}
      data-followed-arrival={followed.arrival}
      data-counterpart-arrival={counterpart.arrival}
      data-counterpart-switched-at={counterpart.switchedAt ?? ""}
      data-diff-minutes={outcome.diffMinutes}
      aria-labelledby="replay-outcome-title"
      className="flex animate-rise-in flex-col gap-2.5"
    >
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <h2
          id="replay-outcome-title"
          className="flex items-center gap-1.5 text-[17px] font-semibold"
        >
          <Flag className="size-4" strokeWidth={1.75} aria-hidden />
          {t("replay.outcome.title")}
        </h2>
        <p className="text-[12px] text-muted tabular-nums">
          {t("replay.outcome.resumed", { time: formatClockTime(outcome.resumedAt, locale) })}
        </p>
      </div>

      <p
        data-testid={testIds.replay.outcomeSummary}
        data-summary={summary.key}
        data-minutes={summary.minutes}
        className="text-[15px] leading-snug font-medium text-pretty"
      >
        {t(`replay.outcome.summary.${summary.key}`, {
          minutes: summary.minutes,
          deadline,
          time: counterpartTime,
        })}
        {summary.deadlineKey && (
          <> {t(`replay.outcome.deadline.${summary.deadlineKey}`, { deadline })}</>
        )}
      </p>

      <div className="grid grid-cols-2 gap-2">
        <OutcomeColumn
          testId={testIds.replay.outcomeFollowed}
          tone={followed.switchedAt ? "switch" : "wait"}
          label={t("replay.outcome.followed")}
          note={
            followed.switchedAt
              ? t("replay.outcome.switchedAt", {
                  time: formatClockTime(followed.switchedAt, locale),
                })
              : t("replay.outcome.neverSwitched")
          }
          arrival={followed.arrival}
          deadline={followed.deadline}
        />
        <OutcomeColumn
          testId={testIds.replay.outcomeCounterpart}
          tone={null}
          label={t(counterpart.switchedAt ? "replay.outcome.switched" : "replay.outcome.waited")}
          note={
            counterpart.switchedAt
              ? t("replay.outcome.switchedAt", { time: counterpartTime })
              : t("replay.outcome.waitedNote")
          }
          arrival={counterpart.arrival}
          deadline={counterpart.deadline}
        />
      </div>

      {outcome.diffMinutes !== 0 && (
        <p className="text-center text-[12px] text-muted tabular-nums">
          {t("replay.outcome.diff", { minutes: Math.abs(outcome.diffMinutes) })}
        </p>
      )}

      <div className="flex flex-col gap-0.5 text-[11px] leading-snug text-muted">
        <p className="flex items-center gap-1.5">
          <TriangleAlert className="size-3 shrink-0" aria-hidden />
          {t("disclaimer.short")}
        </p>
        <p>{t("replay.fictional")}</p>
      </div>
    </section>
  );
}

function OutcomeColumn({
  testId,
  tone,
  label,
  note,
  arrival,
  deadline,
}: {
  testId: string;
  // 判断に従った人は行動の色、比べる相手は色を付けない
  tone: keyof typeof actionStyles | null;
  label: string;
  note: string;
  arrival: string;
  deadline: DeadlineCheck;
}) {
  const t = useTranslations("replay.outcome");
  const locale = useLocale();
  const style = tone ? actionStyles[tone] : null;

  return (
    <div
      data-testid={testId}
      data-arrival={arrival}
      data-on-time={deadline ? String(deadline.onTime) : ""}
      className={cn(
        "flex min-w-0 flex-col gap-0.5 rounded-2xl px-3 py-2.5",
        style ? [style.surface, "ring-1 ring-inset", style.ring] : "bg-foreground/[0.04]",
      )}
    >
      <p className={cn("text-[13px] leading-tight font-semibold", style?.text)}>{label}</p>
      <p className="text-[11px] leading-tight text-muted">{note}</p>
      {/* 見出しの行数が列で違っても、到着時刻の高さを揃える */}
      <div className="mt-auto flex flex-col gap-1 pt-1">
        <p className="flex flex-col">
          <span className="text-[11px] text-muted">{t("arrival")}</span>
          <span className="text-[26px] leading-tight font-bold tracking-tight tabular-nums">
            {formatClockTime(arrival, locale)}
          </span>
        </p>
        {deadline && <DeadlineBadge deadline={deadline} />}
      </div>
    </div>
  );
}

function DeadlineBadge({ deadline }: { deadline: NonNullable<DeadlineCheck> }) {
  const t = useTranslations("replay.outcome");
  const Icon = deadline.onTime ? CircleCheck : CircleX;

  return (
    <p
      className={cn(
        "flex w-fit items-center gap-1 rounded-full bg-surface px-2 py-0.5 text-[11px] font-semibold",
        deadline.onTime ? "text-foreground" : "text-danger",
      )}
    >
      <Icon className="size-3.5" aria-hidden />
      {deadline.onTime ? t("onTime") : t("late", { minutes: -deadline.marginMinutes })}
    </p>
  );
}
