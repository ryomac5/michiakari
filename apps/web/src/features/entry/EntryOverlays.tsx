"use client";

import { ChevronRight, Info, LoaderCircle, LocateFixed, Play } from "lucide-react";
import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";
import { forwardRef } from "react";
import { testIds } from "@/features/judgment/testids";
import type { StationChoice } from "@/features/stations/catalog";
import { StationSearch } from "@/features/stations/components/StationSearch";
import type { LocateStatus } from "@/features/stations/use-current-location";
import { cn } from "@/lib/utils";
import { type EntryHub, pickLocalized } from "./entry-places";

// 関西の段で地図の上に重ねる部品。上に問いかけと検索、下にデモへの札

export const PromptCard = forwardRef<
  HTMLDivElement,
  {
    locateStatus: LocateStatus;
    message: string | null;
    onLocate: () => void;
    onSelect: (station: StationChoice) => void;
    // PC 幅で検索の下に並べる、よく使う駅
    quickPicks: EntryHub[] | null;
    onQuickPick: (stationName: string) => void;
  }
>(function PromptCard({ locateStatus, message, onLocate, onSelect, quickPicks, onQuickPick }, ref) {
  const t = useTranslations();
  const locale = useLocale();
  return (
    <div
      ref={ref}
      data-testid={testIds.start.prompt}
      className="glass-strong pointer-events-auto flex animate-drop-in flex-col gap-3 rounded-[24px] p-4 lg:p-5"
    >
      <div className="flex flex-col gap-0.5 px-1">
        <h1 className="text-[22px] leading-tight font-bold tracking-tight text-balance">
          {t("entry.question")}
        </h1>
        <p className="text-[14px] leading-snug text-muted">{t("entry.hint")}</p>
      </div>
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <StationSearch
            hideLabel
            label={t("start.originLabel")}
            placeholder={t("entry.searchPlaceholder")}
            onSelect={onSelect}
            testIds={{
              search: testIds.start.originSearch,
              option: testIds.start.originOption,
            }}
          />
        </div>
        <button
          type="button"
          data-testid={testIds.start.locateButton}
          onClick={onLocate}
          disabled={locateStatus === "locating"}
          aria-label={t("start.locate")}
          title={t("start.locate")}
          className="flex size-12 shrink-0 items-center justify-center rounded-xl bg-foreground/[0.06] text-focus transition-[transform,background-color] duration-150 hover:bg-foreground/10 active:scale-95 disabled:opacity-50"
        >
          {locateStatus === "locating" ? (
            <LoaderCircle className="size-5 animate-spin" aria-hidden />
          ) : (
            <LocateFixed className="size-5" strokeWidth={1.75} aria-hidden />
          )}
        </button>
      </div>
      {quickPicks && quickPicks.length > 0 && (
        <div className="flex flex-col gap-2 px-1 pt-1">
          <p className="text-[12px] font-medium text-muted">{t("entry.quickPicks")}</p>
          <div className="flex flex-wrap gap-1.5">
            {quickPicks.map((hub) => (
              <button
                key={hub.areaId}
                type="button"
                data-testid={testIds.start.quickPick(hub.areaId)}
                onClick={() => onQuickPick(hub.stationName)}
                className="inline-flex min-h-11 items-center gap-1.5 rounded-full bg-foreground/[0.05] px-3.5 text-[14px] font-semibold transition-[transform,background-color] duration-150 hover:bg-foreground/[0.09] active:scale-95"
              >
                <span aria-hidden className="size-2 rounded-full bg-brand" />
                {pickLocalized(hub.label, locale)}
              </button>
            ))}
          </div>
        </div>
      )}
      {message && (
        <p
          data-testid={testIds.start.locateStatus}
          role="status"
          className="px-1 text-[13px] text-muted"
        >
          {message}
        </p>
      )}
    </div>
  );
});

// inline は PC 幅で、左の列の問いかけの下に続けて置く
export const DemoDock = forwardRef<HTMLDivElement, { inline?: boolean }>(function DemoDock(
  { inline = false },
  ref,
) {
  const t = useTranslations();
  return (
    <div
      ref={ref}
      className={cn(
        "flex flex-col gap-2",
        inline
          ? "pointer-events-auto"
          : "fixed inset-x-0 bottom-0 z-10 px-3 pb-[max(28px,calc(env(safe-area-inset-bottom)+20px))]",
      )}
    >
      <Link
        href="/replay"
        data-testid={testIds.start.replayLink}
        className="glass-strong flex min-h-16 animate-rise-in items-center gap-3 rounded-[20px] py-2.5 pr-3 pl-2.5 transition-transform duration-150 active:scale-[0.98]"
      >
        <span className="flex size-11 shrink-0 items-center justify-center rounded-full bg-brand/15 text-brand">
          <Play className="size-4 translate-x-px fill-current" aria-hidden />
        </span>
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="text-[15px] font-bold">{t("start.replayLink")}</span>
          <span className="truncate text-[12px] text-muted">{t("entry.demoNote")}</span>
        </span>
        <ChevronRight className="size-5 shrink-0 text-muted" aria-hidden />
      </Link>
      <p className="flex items-center gap-1.5 px-2 text-[12px] font-medium text-foreground/80 [text-shadow:0_0_4px_var(--background)]">
        <Info className="size-3.5 shrink-0" strokeWidth={1.75} aria-hidden />
        {t("disclaimer.short")}
      </p>
    </div>
  );
});
