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
    <div
      data-testid={testIds.replay.bar}
      data-state={status}
      className="sticky top-0 z-20 border-b border-border bg-surface/95 backdrop-blur"
    >
      <div className="mx-auto flex max-w-2xl flex-col gap-2 px-4 py-2">
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
          <p data-testid={testIds.replay.title} className="min-w-0 flex-1 truncate font-bold">
            {title}
          </p>
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

        <div
          className="h-1.5 w-full overflow-hidden rounded-full bg-surface-raised"
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

        <div className="flex items-center gap-2">
          <Button
            size="sm"
            data-testid={testIds.replay.playButton}
            data-playing={playing}
            aria-label={playLabel}
            onClick={onTogglePlay}
            className="min-w-24 shrink-0"
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
            className="size-10"
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
            className="size-10"
          >
            <RotateCcw aria-hidden />
          </Button>
          <fieldset
            aria-label={t("speed")}
            className="ml-auto flex rounded-xl bg-surface-raised p-1"
          >
            {speeds.map((s) => (
              <button
                key={s}
                type="button"
                data-testid={testIds.replay.speed(s)}
                aria-pressed={s === speed}
                onClick={() => onChangeSpeed(s)}
                className={cn(
                  "h-8 rounded-lg px-2.5 text-sm font-bold text-muted tabular-nums",
                  s === speed && "bg-surface text-foreground shadow-sm",
                )}
              >
                {s}x
              </button>
            ))}
          </fieldset>
        </div>
      </div>
    </div>
  );
}
