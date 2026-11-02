"use client";

import { ArrowLeft, Pause, Play, RotateCcw, SkipForward } from "lucide-react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { testIds } from "@/features/judgment/testids";
import { cn } from "@/lib/utils";
import { speedChoices } from "../clock";
import type { ReplayStatus } from "../use-replay-player";

// 画面上部に固定する再生バー。再生・一時停止、速度、次の発表、時刻と進捗
export function ReplayBar({
  title,
  subtitle,
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
  onBack,
}: {
  title: string;
  // 出発駅 → 行き先 と止まっている路線
  subtitle: string;
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
  onBack: () => void;
}) {
  const t = useTranslations("replay");
  const playing = status === "playing" || status === "judging";
  const speeds: number[] = speedChoices.includes(speed as (typeof speedChoices)[number])
    ? [...speedChoices]
    : [...speedChoices, speed];
  const playLabel = status === "ended" ? t("replay") : playing ? t("pause") : t("play");

  return (
    <section
      data-testid={testIds.replay.bar}
      data-state={status}
      aria-label={t("bar")}
      className="sticky top-0 z-20 border-b border-border bg-surface/95 backdrop-blur"
    >
      {/* 進捗は下端の線で示し、高さを使わない */}
      <div
        className="absolute inset-x-0 bottom-0 h-1 bg-surface-raised"
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(progress * 100)}
        aria-label={t("clock")}
      >
        <div
          className="h-full bg-brand transition-[width] duration-100 ease-linear"
          style={{ width: `${progress * 100}%` }}
        />
      </div>
      <div className="mx-auto flex max-w-2xl flex-col gap-1 px-4 pt-1 pb-1.5">
        <div className="flex items-center gap-2">
          <Button
            variant="ghost"
            size="icon"
            data-testid={testIds.replay.backButton}
            aria-label={t("back")}
            title={t("back")}
            onClick={onBack}
            className="-ml-2 shrink-0"
          >
            <ArrowLeft aria-hidden />
          </Button>
          <div className="flex min-w-0 flex-1 flex-col">
            <p data-testid={testIds.replay.title} className="truncate font-bold leading-snug">
              {title}
            </p>
            <p className="truncate text-xs font-bold text-muted">{subtitle}</p>
          </div>
          <p
            data-testid={testIds.replay.progress}
            data-entered={enteredCount}
            data-total={total}
            className="shrink-0 font-bold text-muted tabular-nums"
          >
            {t("progress", { count: enteredCount, total })}
          </p>
          <p
            data-testid={testIds.replay.clock}
            className="shrink-0 text-2xl leading-none font-extrabold tabular-nums"
          >
            <span className="sr-only">{t("clock")} </span>
            {clockLabel}
          </p>
        </div>

        <div className="flex items-center gap-2">
          <Button
            size="sm"
            data-testid={testIds.replay.playButton}
            data-playing={playing}
            aria-label={playLabel}
            onClick={onTogglePlay}
            className="h-11 min-w-24 shrink-0"
          >
            {status === "ended" ? (
              <RotateCcw aria-hidden />
            ) : playing ? (
              <Pause aria-hidden />
            ) : (
              <Play aria-hidden />
            )}
            {playLabel}
          </Button>
          <Button
            variant="outline"
            size="icon"
            data-testid={testIds.replay.nextButton}
            aria-label={t("next")}
            title={t("next")}
            onClick={onNext}
            disabled={status === "judging" || status === "ended"}
            className="size-11"
          >
            <SkipForward aria-hidden />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            data-testid={testIds.replay.restartButton}
            aria-label={t("restart")}
            title={t("restart")}
            onClick={onRestart}
            disabled={enteredCount === 0}
            className="size-11"
          >
            <RotateCcw aria-hidden />
          </Button>
          <fieldset
            aria-label={t("speed")}
            className="ml-auto flex rounded-xl border border-border bg-surface-raised"
          >
            {speeds.map((s) => (
              <button
                key={s}
                type="button"
                data-testid={testIds.replay.speed(s)}
                aria-pressed={s === speed}
                onClick={() => onChangeSpeed(s)}
                className={cn(
                  "h-11 min-w-11 rounded-[11px] px-2 text-sm font-bold text-muted tabular-nums",
                  s === speed && "bg-foreground text-background",
                )}
              >
                {s}x
              </button>
            ))}
          </fieldset>
        </div>
      </div>
    </section>
  );
}
