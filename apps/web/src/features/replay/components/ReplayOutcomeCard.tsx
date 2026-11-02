"use client";

import type { ReplayOutcome } from "@repo/core";
import { CircleCheck, CircleX, Flag, TriangleAlert } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { actionStyles } from "@/features/judgment/action-style";
import { testIds } from "@/features/judgment/testids";
import { formatClockTime } from "@/features/judgment/time";
import { cn } from "@/lib/utils";
import { selectOutcomeSummary } from "../outcome";

type DeadlineCheck = ReplayOutcome["followedDeadline"];

// リプレイの結末。判断に従った人と待ち続けた人の到着時刻を並べる
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
  const followedTone = outcome.switchedAt ? "switch" : "wait";

  return (
    <section
      data-testid={testIds.replay.outcome}
      data-verdict={outcome.verdict}
      data-followed-arrival={outcome.followedArrival}
      data-waited-arrival={outcome.waitedArrival}
      data-diff-minutes={outcome.diffMinutes}
      data-alternative-diff-minutes={outcome.alternativeDiffMinutes ?? ""}
      aria-labelledby="replay-outcome-title"
      className="flex animate-rise-in flex-col gap-3 rounded-3xl border-2 border-border bg-surface px-4 py-4 sm:p-5"
    >
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <h2 id="replay-outcome-title" className="flex items-center gap-2 text-xl font-extrabold">
          <Flag className="size-5" aria-hidden />
          {t("replay.outcome.title")}
        </h2>
        <p className="text-sm font-bold text-muted">
          {t("replay.outcome.resumed", { time: formatClockTime(outcome.resumedAt, locale) })}
        </p>
      </div>

      <p
        data-testid={testIds.replay.outcomeSummary}
        data-summary={summary.key}
        className="text-lg leading-snug font-extrabold"
      >
        {t(`replay.outcome.summary.${summary.key}`, { minutes: summary.minutes, deadline })}
        {summary.deadlineKey && (
          <> {t(`replay.outcome.deadline.${summary.deadlineKey}`, { deadline })}</>
        )}
      </p>

      <div className="grid grid-cols-2 gap-2.5">
        <OutcomeColumn
          testId={testIds.replay.outcomeFollowed}
          tone={followedTone}
          label={t("replay.outcome.followed")}
          note={
            outcome.switchedAt
              ? t("replay.outcome.switchedAt", {
                  time: formatClockTime(outcome.switchedAt, locale),
                })
              : t("replay.outcome.neverSwitched")
          }
          arrival={outcome.followedArrival}
          deadline={outcome.followedDeadline}
        />
        <OutcomeColumn
          testId={testIds.replay.outcomeWaited}
          tone={null}
          label={t("replay.outcome.waited")}
          note={t("replay.outcome.waitedNote")}
          arrival={outcome.waitedArrival}
          deadline={outcome.waitedDeadline}
        />
      </div>

      {outcome.diffMinutes !== 0 && (
        <p className="text-center text-sm font-bold text-muted tabular-nums">
          {t("replay.outcome.diff", { minutes: Math.abs(outcome.diffMinutes) })}
        </p>
      )}

      <div className="flex flex-col gap-1.5 border-t border-border pt-3 text-sm text-muted">
        <p className="flex items-start gap-2 font-bold">
          <TriangleAlert className="mt-0.5 size-4 shrink-0" aria-hidden />
          {t("disclaimer.short")}
        </p>
        <p>{t("replay.outcome.method")}</p>
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
  // 判断に従った人は行動の色、待ち続けた人は色を付けない
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
        "flex min-w-0 flex-col gap-1 rounded-2xl border-2 px-3 py-2.5",
        style ? [style.surface, style.border] : "border-border bg-background",
      )}
    >
      <p className={cn("text-sm leading-tight font-extrabold", style?.text)}>{label}</p>
      <p className="text-xs leading-tight text-muted">{note}</p>
      {/* 見出しの行数が列で違っても、到着時刻の高さを揃える */}
      <div className="mt-auto flex flex-col gap-1 pt-1">
        <p className="flex flex-col">
          <span className="text-xs font-bold text-muted">{t("arrival")}</span>
          <span className="text-3xl leading-tight font-extrabold tabular-nums sm:text-4xl">
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
        "flex w-fit items-center gap-1 rounded-full bg-background px-2 py-0.5 text-xs font-extrabold",
        deadline.onTime ? "text-foreground" : "text-danger",
      )}
    >
      <Icon className="size-3.5" aria-hidden />
      {deadline.onTime ? t("onTime") : t("late", { minutes: -deadline.marginMinutes })}
    </p>
  );
}
