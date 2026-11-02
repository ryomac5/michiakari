"use client";

import type { Place } from "@repo/schema";
import { Pencil } from "lucide-react";
import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";
import { describePlace } from "@/features/stations/describe";

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
  const current = t("start.currentLocation");
  const from = describePlace(origin, locale, current).label;
  const to = describePlace(destination, locale, current).label;

  return (
    <div data-testid={testId} className="flex items-center gap-2 text-muted">
      <p className="min-w-0 flex-1 truncate font-bold">
        {t("judgment.trip", { origin: from, destination: to })}
      </p>
      <Link
        href="/"
        className="inline-flex h-9 shrink-0 items-center gap-1 rounded-lg px-2 text-sm font-bold hover:bg-surface-raised"
      >
        <Pencil className="size-4" aria-hidden />
        {t("situation.edit")}
      </Link>
    </div>
  );
}
