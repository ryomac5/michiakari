"use client";

import type { Place } from "@repo/schema";
import { ArrowRight, Pencil } from "lucide-react";
import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";
import { describePlace } from "@/features/stations/describe";
import { useJudgmentSession } from "../session";

// 出発地 → 行き先 の一行表示
export function TripSummary({
  origin,
  destination,
  testId,
}: {
  origin: Place;
  destination: Place;
  testId: string;
}) {
  const t = useTranslations();
  const locale = useLocale();
  const { stationNames, originNearest } = useJudgmentSession();
  const current = t("start.currentLocation");
  const from = describePlace(origin, locale, current, stationNames, originNearest).label;
  const to = describePlace(destination, locale, current, stationNames).label;

  return (
    <div data-testid={testId} className="flex items-center gap-2">
      <p className="flex min-w-0 flex-1 items-center gap-1.5 font-bold">
        <span className="sr-only">{t("judgment.trip", { origin: from, destination: to })}</span>
        <span aria-hidden className="truncate">
          {from}
        </span>
        <ArrowRight className="size-4 shrink-0 text-muted" aria-hidden />
        <span aria-hidden className="truncate">
          {to}
        </span>
      </p>
      <Link
        href="/"
        className="inline-flex h-11 shrink-0 items-center gap-1 rounded-xl px-3 text-sm font-bold text-muted hover:bg-surface-raised"
      >
        <Pencil className="size-4" aria-hidden />
        {t("situation.edit")}
      </Link>
    </div>
  );
}
