"use client";

import { ArrowRight, ArrowRightLeft, Footprints, Star } from "lucide-react";
import { useTranslations } from "next-intl";
import { cn } from "@/lib/utils";
import type { BubblePlacement } from "./focus-areas";
import type { GuideLine, GuideStation, StationGuide } from "./station-guide";
import { mapTestIds } from "./testids";

// 地図の上の吹き出し。駅名、乗れる路線、運行の状態、徒歩の分数、振替の対象、おすすめの印
// おすすめは full で詳しく出す。ほかは PC 幅では medium、スマートフォン幅では compact に縮める
// medium は駅名・事業者・分数と、路線色付きの路線名 1 行。compact は駅名・路線色・分数だけ
export type BubbleVariant = "full" | "medium" | "compact";

const tailClass: Record<BubblePlacement, string> = {
  top: "after:top-full after:left-1/2 after:-translate-x-1/2 after:border-t-[var(--bubble-bg)] after:border-x-transparent after:border-b-transparent",
  bottom:
    "after:bottom-full after:left-1/2 after:-translate-x-1/2 after:border-b-[var(--bubble-bg)] after:border-x-transparent after:border-t-transparent",
  left: "after:left-full after:top-1/2 after:-translate-y-1/2 after:border-l-[var(--bubble-bg)] after:border-y-transparent after:border-r-transparent",
  right:
    "after:right-full after:top-1/2 after:-translate-y-1/2 after:border-r-[var(--bubble-bg)] after:border-y-transparent after:border-l-transparent",
};

function LineSwatch({ line }: { line: GuideLine }) {
  return (
    <span
      aria-hidden
      className="h-3 w-1.5 shrink-0 rounded-full"
      style={{ backgroundColor: line.color }}
    />
  );
}

export function LineChip({
  line,
  recommended = false,
}: {
  line: GuideLine;
  recommended?: boolean;
}) {
  const t = useTranslations("map");
  return (
    <span
      className={cn(
        "inline-flex h-6 max-w-full items-center gap-1.5 rounded-md px-1.5 text-[11px] leading-none font-medium whitespace-nowrap",
        line.suspended ? "bg-danger/10 text-danger" : "bg-foreground/[0.06] text-foreground",
      )}
    >
      {line.suspended ? (
        <svg viewBox="0 0 12 4" className="h-1 w-3 shrink-0" aria-hidden>
          <line
            x1="0"
            y1="2"
            x2="12"
            y2="2"
            stroke="currentColor"
            strokeWidth="4"
            strokeDasharray="3 2"
          />
        </svg>
      ) : (
        <LineSwatch line={line} />
      )}
      <span className="truncate">{line.name}</span>
      {line.suspended && <span className="font-semibold">{t("suspended")}</span>}
      {line.transferService && (
        <span className="flex shrink-0 items-center gap-0.5 font-normal text-muted">
          <ArrowRightLeft className="size-3" aria-hidden />
          {t("transferShort")}
        </span>
      )}
      {recommended && <Star className="size-3 shrink-0 fill-current text-switch" aria-hidden />}
    </span>
  );
}

export function StationBubble({
  station,
  placement,
  variant,
  onSelect,
}: {
  station: GuideStation;
  placement: BubblePlacement;
  variant: BubbleVariant;
  onSelect: (() => void) | null;
}) {
  const compact = variant === "compact";
  const t = useTranslations("map");
  const status = station.suspended ? t("statusSuspended") : t("statusRunning");
  const label = [
    station.recommended ? t("recommended") : null,
    `${station.name} ${station.operator}`,
    station.lines.map((l) => l.name).join("、"),
    status,
    t("walk", { minutes: station.walkMinutes }),
    station.transferService ? t("transferService") : null,
  ]
    .filter(Boolean)
    .join(" ");

  const body = compact ? (
    <span className="flex items-center gap-1.5">
      <span className="flex gap-0.5">
        {station.lines.slice(0, 3).map((line) => (
          <LineSwatch key={line.lineId} line={line} />
        ))}
      </span>
      <span className="text-[12px] font-semibold whitespace-nowrap">{station.shortName}</span>
      <span className="text-[12px] font-semibold whitespace-nowrap text-muted tabular-nums">
        {t("minutesShort", { minutes: station.walkMinutes })}
      </span>
    </span>
  ) : variant === "medium" ? (
    <span className="flex w-[176px] flex-col gap-1 text-left">
      <span className="flex items-baseline justify-between gap-2">
        <span className="min-w-0 truncate text-[13px] font-bold">
          {station.name}
          <span className="ml-1.5 text-[11px] font-normal text-muted">{station.operator}</span>
        </span>
        <span className="shrink-0 text-[13px] font-bold tabular-nums">
          {t("minutesShort", { minutes: station.walkMinutes })}
        </span>
      </span>
      <span className="flex min-w-0 items-center gap-1.5 text-[11px] text-muted">
        <span
          aria-hidden
          className={cn(
            "size-1.5 shrink-0 rounded-full",
            station.suspended ? "bg-danger" : "bg-emerald-500",
          )}
        />
        <span className="flex shrink-0 gap-0.5">
          {station.lines.slice(0, 3).map((line) => (
            <LineSwatch key={line.lineId} line={line} />
          ))}
        </span>
        <span className="min-w-0 truncate">
          {station.suspended ? status : station.lines.map((l) => l.name).join("・")}
        </span>
        {station.transferService && (
          <ArrowRightLeft className="size-3 shrink-0" aria-label={t("transferService")} />
        )}
      </span>
    </span>
  ) : (
    <span className="flex w-[172px] flex-col gap-1.5 text-left sm:w-[196px]">
      {station.recommended && (
        <span className="flex items-center gap-1 text-[11px] font-bold text-switch">
          <Star className="size-3 fill-current" aria-hidden />
          {t("recommended")}
        </span>
      )}
      <span className="flex items-baseline justify-between gap-2">
        <span className="min-w-0">
          <span className="block truncate text-[15px] leading-tight font-bold">{station.name}</span>
          <span className="block truncate text-[11px] text-muted">{station.operator}</span>
        </span>
        <span className="flex shrink-0 items-center gap-0.5 text-[15px] font-bold tabular-nums">
          <Footprints className="size-3.5 text-muted" strokeWidth={2} aria-hidden />
          {t("minutesShort", { minutes: station.walkMinutes })}
        </span>
      </span>
      {station.route ? (
        // 推奨の乗り方。結論が名前に出す路線まで、乗り継ぎを含めて 2 段で示す
        <span data-route="true" className="flex flex-col items-start gap-1">
          <LineChip line={station.route.first} />
          {station.route.via && (
            <span className="flex max-w-full flex-wrap items-center gap-1 text-[11px] text-muted">
              <ArrowRight className="size-3 shrink-0" aria-hidden />
              {t("changeAt", { station: station.route.via.stationName })}
              <LineChip line={station.route.via.line} />
            </span>
          )}
        </span>
      ) : (
        <span className="flex flex-wrap gap-1">
          {station.lines.slice(0, 2).map((line) => (
            <LineChip key={line.lineId} line={line} />
          ))}
        </span>
      )}
      <span className="flex items-center gap-2 text-[11px] font-medium">
        <span className="flex items-center gap-1">
          <span
            aria-hidden
            className={cn(
              "size-2 rounded-full",
              station.suspended ? "bg-danger" : "bg-emerald-500",
            )}
          />
          {status}
        </span>
      </span>
    </span>
  );

  const className = cn(
    "relative block rounded-xl text-foreground shadow-[0_2px_10px_rgb(0_0_0/0.16)] [--bubble-bg:var(--surface)]",
    "after:absolute after:border-[6px] after:content-['']",
    tailClass[placement],
    compact ? "bg-surface px-2 py-1.5" : "bg-surface px-3 py-2.5",
    station.recommended && "ring-2 ring-switch-border",
  );

  const testProps = {
    "data-testid": mapTestIds.station(station.key),
    "data-recommended": station.recommended,
    "data-status": station.suspended ? "suspended" : "running",
    "data-walk-minutes": station.walkMinutes,
    "data-transfer-service": station.transferService,
    "data-variant": variant,
    "data-route-line": station.route?.first.lineId ?? "",
    "data-route-main-line": station.route?.via?.line.lineId ?? station.route?.first.lineId ?? "",
  };

  if (!onSelect) {
    return (
      <div {...testProps} role="img" aria-label={label} className={className}>
        {body}
      </div>
    );
  }
  // 見た目は小さくても、押せる高さは 44px にする
  return (
    <button
      type="button"
      {...testProps}
      aria-label={label}
      onClick={onSelect}
      className="flex min-h-11 items-center"
    >
      <span className={className}>{body}</span>
    </button>
  );
}

// 現在地。脈打つ丸と「いま 大阪駅」の札に、止まっている路線と動いている路線を添える
export function HereMarker({
  here,
  placement,
  compact,
}: {
  here: StationGuide["here"];
  placement: BubblePlacement;
  // 狭い画面では、路線を色の印だけにして 1 行に収める
  compact: boolean;
}) {
  const t = useTranslations("map");
  const side =
    placement === "left"
      ? "right-[calc(100%+10px)] top-1/2 -translate-y-1/2"
      : placement === "right"
        ? "left-[calc(100%+10px)] top-1/2 -translate-y-1/2"
        : placement === "top"
          ? "bottom-[calc(100%+10px)] left-1/2 -translate-x-1/2"
          : "top-[calc(100%+10px)] left-1/2 -translate-x-1/2";

  return (
    <div data-testid={mapTestIds.here} className="relative size-5">
      <span aria-hidden className="absolute -inset-3 animate-here-pulse rounded-full bg-focus/30" />
      <span
        aria-hidden
        className="absolute inset-0 rounded-full border-[3px] border-white bg-focus shadow-[0_1px_6px_rgb(0_0_0/0.35)]"
      />
      <div
        className={cn(
          "absolute flex w-max max-w-[220px] flex-col gap-1 rounded-xl bg-surface px-2.5 py-2 shadow-[0_2px_10px_rgb(0_0_0/0.16)]",
          side,
        )}
      >
        <p className="flex items-center gap-1.5 text-[13px] leading-tight font-bold">
          <span className="text-focus">{t("here")}</span>
          {here.name}
          {compact &&
            here.lines.slice(0, 3).map((line) =>
              line.suspended ? (
                <span
                  key={line.lineId}
                  role="img"
                  aria-label={`${line.name} ${t("suspended")}`}
                  className="flex h-4 items-center rounded bg-danger/10 px-1 text-danger"
                >
                  <svg viewBox="0 0 12 4" className="h-1 w-3" aria-hidden>
                    <line
                      x1="0"
                      y1="2"
                      x2="12"
                      y2="2"
                      stroke="currentColor"
                      strokeWidth="4"
                      strokeDasharray="3 2"
                    />
                  </svg>
                </span>
              ) : (
                <span
                  key={line.lineId}
                  role="img"
                  aria-label={line.name}
                  className="h-3 w-1.5 rounded-full"
                  style={{ backgroundColor: line.color }}
                />
              ),
            )}
        </p>
        <div className={cn("flex flex-col items-start gap-1", compact && "hidden")}>
          {here.lines.slice(0, 3).map((line) => (
            <LineChip
              key={line.lineId}
              line={line}
              recommended={line.lineId === here.recommendedLineId}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

// 止まっている路線の上に 1 つだけ置く札
export function BlockedTag() {
  const t = useTranslations("map");
  return (
    <div
      data-testid={mapTestIds.blockedTag}
      className="flex items-center gap-1 rounded-md bg-danger px-1.5 py-0.5 text-[11px] font-bold whitespace-nowrap text-white shadow-[0_1px_4px_rgb(0_0_0/0.25)]"
    >
      <svg viewBox="0 0 12 4" className="h-1 w-3" aria-hidden>
        <line
          x1="0"
          y1="2"
          x2="12"
          y2="2"
          stroke="currentColor"
          strokeWidth="4"
          strokeDasharray="3 2"
        />
      </svg>
      {t("suspended")}
    </div>
  );
}
