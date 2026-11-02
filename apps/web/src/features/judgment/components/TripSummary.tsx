"use client";

import type { Place } from "@repo/schema";
import { ArrowRight } from "lucide-react";
import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";
import { describePlace } from "@/features/stations/describe";
import { useJudgmentSession } from "../session";

// 上部の帯に置く「大阪 → 京都」。押すと開始画面に戻って選び直せる
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

  return <TripChip testId={testId} from={from} to={to} href="/" />;
}

export function TripChip({
  from,
  to,
  testId,
  href = null,
}: {
  from: string;
  to: string;
  testId?: string;
  href?: string | null;
}) {
  const t = useTranslations();
  const content = (
    <span className="flex h-8 min-w-0 items-center gap-1 rounded-full bg-foreground/[0.06] px-2.5 text-[13px] font-semibold">
      <span className="sr-only">{t("judgment.trip", { origin: from, destination: to })}</span>
      <span aria-hidden className="truncate">
        {from}
      </span>
      <ArrowRight className="size-3.5 shrink-0 text-muted" aria-hidden />
      <span aria-hidden className="truncate">
        {to}
      </span>
    </span>
  );

  if (!href) {
    return (
      <div data-testid={testId} className="flex max-w-[55%] min-w-0 shrink-0 items-center">
        {content}
      </div>
    );
  }
  return (
    <Link
      href={href}
      data-testid={testId}
      title={t("situation.edit")}
      className="flex min-h-11 max-w-[55%] min-w-0 shrink-0 items-center rounded-full"
    >
      {content}
    </Link>
  );
}

// 「JR京都線 見合わせ」。色に加えて破線の印で止まっていることを示す
export function StatusChip({ line, testId }: { line: string; testId?: string }) {
  const t = useTranslations("judgment");

  return (
    <p
      data-testid={testId}
      className="flex h-8 min-w-0 shrink items-center gap-1.5 rounded-full bg-danger/10 px-2.5 text-[12px] font-semibold text-danger"
    >
      <svg viewBox="0 0 14 4" className="h-1 w-3.5 shrink-0" aria-hidden>
        <line
          x1="0"
          y1="2"
          x2="14"
          y2="2"
          stroke="currentColor"
          strokeWidth="4"
          strokeDasharray="4 2.5"
        />
      </svg>
      <span className="truncate">{t("status", { line })}</span>
    </p>
  );
}
