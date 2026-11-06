"use client";

import { Pause, Play, RotateCcw, SkipBack, SkipForward } from "lucide-react";
import { useTranslations } from "next-intl";
import { testIds } from "@/features/judgment/testids";
import { cn } from "@/lib/utils";
import { speedChoices } from "../clock";
import type { ReplayStatus } from "../use-replay-player";

// 上部の帯の中に置く再生の操作。再生・一時停止、次の発表、時刻と進捗、速度
// 帯を 1 本にまとめて地図を広く残す。進捗は帯の下端の細い線で示す
export function ReplayBar({
  status,
  clockLabel,
  progress,
  enteredCount,
  total,
  speed,
  onTogglePlay,
  onNext,
  onRestart,
  onChangeSpeed,
}: {
  status: ReplayStatus;
  clockLabel: string;
  progress: number;
  enteredCount: number;
  total: number;
  speed: number;
  onTogglePlay: () => void;
  onNext: () => void;
  onRestart: () => void;
  onChangeSpeed: (speed: number) => void;
}) {
  const t = useTranslations("replay");
  const playing = status === "playing" || status === "judging";
  const speeds: number[] = speedChoices.includes(speed as (typeof speedChoices)[number])
    ? [...speedChoices]
    : [...speedChoices, speed];
  const playLabel = status === "ended" ? t("replay") : playing ? t("pause") : t("play");
  const iconButton =
    "inline-flex size-11 shrink-0 items-center justify-center rounded-full transition-colors hover:bg-foreground/5 disabled:opacity-35 [&_svg]:size-5";

  return (
    <section
      data-testid={testIds.replay.bar}
      data-state={status}
      aria-label={t("bar")}
      className="flex min-w-0 flex-1 items-center gap-0.5"
    >
      <button
        type="button"
        data-testid={testIds.replay.playButton}
        data-playing={playing}
        aria-label={playLabel}
        title={playLabel}
        onClick={onTogglePlay}
        className="inline-flex size-11 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground transition-opacity hover:opacity-90 [&_svg]:size-5"
      >
        {status === "ended" ? (
          <RotateCcw aria-hidden />
        ) : playing ? (
          <Pause className="fill-current" aria-hidden />
        ) : (
          <Play className="translate-x-px fill-current" aria-hidden />
        )}
      </button>
      <button
        type="button"
        data-testid={testIds.replay.nextButton}
        aria-label={t("next")}
        title={t("next")}
        onClick={onNext}
        disabled={status === "judging" || status === "ended"}
        className={iconButton}
      >
        <SkipForward strokeWidth={1.75} aria-hidden />
      </button>
      {/* 狭い画面では帯に収まらないので出さない。終わった後は再生のボタンが最初から流し直す */}
      <button
        type="button"
        data-testid={testIds.replay.restartButton}
        aria-label={t("restart")}
        title={t("restart")}
        onClick={onRestart}
        disabled={enteredCount === 0}
        className={cn(iconButton, "max-[429px]:hidden")}
      >
        <SkipBack strokeWidth={1.75} aria-hidden />
      </button>

      <div className="flex min-w-[3.25rem] flex-1 flex-col items-start pl-1 leading-none">
        <p
          data-testid={testIds.replay.clock}
          className="text-[15px] font-bold tracking-tight tabular-nums"
        >
          <span className="sr-only">{t("clock")} </span>
          {clockLabel}
        </p>
        <p
          data-testid={testIds.replay.progress}
          data-entered={enteredCount}
          data-total={total}
          className="mt-0.5 text-[11px] text-muted tabular-nums"
        >
          <span className="sr-only">{t("announcements")} </span>
          {t("progress", { count: enteredCount, total })}
        </p>
      </div>

      <fieldset
        aria-label={t("speed")}
        className="flex shrink-0 rounded-full bg-foreground/[0.06] p-0.5"
      >
        {speeds.map((s) => (
          <button
            key={s}
            type="button"
            data-testid={testIds.replay.speed(s)}
            aria-pressed={s === speed}
            onClick={() => onChangeSpeed(s)}
            className={cn(
              "h-11 min-w-7 rounded-full px-1 text-[12px] font-semibold text-muted tabular-nums transition-colors",
              s === speed && "bg-surface text-foreground shadow-sm",
            )}
          >
            {s}x
          </button>
        ))}
      </fieldset>

      {/* 進捗は帯の下端の細い線で示す */}
      <div
        className="absolute inset-x-4 bottom-0 h-[3px] overflow-hidden rounded-full bg-foreground/[0.06]"
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(progress * 100)}
        aria-label={t("clock")}
      >
        <div
          className="h-full rounded-full bg-foreground transition-[width] duration-100 ease-linear"
          style={{ width: `${progress * 100}%` }}
        />
      </div>
    </section>
  );
}
