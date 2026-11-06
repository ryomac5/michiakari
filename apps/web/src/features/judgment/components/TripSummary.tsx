"use client";

import type { StopScope } from "@repo/core";
import type { Place } from "@repo/schema";
import { ArrowRight } from "lucide-react";
import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";
import { describePlace } from "@/features/stations/describe";
import { useMediaQuery } from "@/lib/use-media-query";
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
  const { stationNames, originNearest, trainPosition } = useJudgmentSession();
  const current = t("start.currentLocation");
  const nameOf = (name: string) =>
    describePlace({ kind: "station", name }, locale, current, stationNames).label;
  // 駅と駅の間の車内なら、出発の駅ではなく「大阪〜塚本」のように駅の間にいることを出す
  const between =
    trainPosition?.kind === "between_stations" &&
    trainPosition.previousStation &&
    trainPosition.nextStation
      ? { from: trainPosition.previousStation, to: trainPosition.nextStation }
      : null;
  const from = between
    ? t("judgment.tripBetween", { from: nameOf(between.from), to: nameOf(between.to) })
    : describePlace(origin, locale, current, stationNames, originNearest).label;
  const to = describePlace(destination, locale, current, stationNames).label;
  // 狭い画面では「大阪〜塚本 → 三ノ宮」が見合わせの札と並ばないので、出発と行き先を 2 段に重ねる
  const narrow = useMediaQuery("(max-width: 639px)");

  return (
    <TripChip testId={testId} from={from} to={to} href="/" stacked={between !== null && narrow} />
  );
}

export function TripChip({
  from,
  to,
  testId,
  href = null,
  stacked = false,
}: {
  from: string;
  to: string;
  testId?: string;
  href?: string | null;
  // 出発と行き先を 2 段に重ねて、横幅を抑える
  stacked?: boolean;
}) {
  const t = useTranslations();
  const content = stacked ? (
    <span className="flex h-8 min-w-0 items-center rounded-full bg-foreground/[0.06] px-2 text-[11px] leading-[1.15] font-semibold whitespace-nowrap">
      <span className="sr-only">{t("judgment.trip", { origin: from, destination: to })}</span>
      <span aria-hidden className="flex min-w-0 flex-col">
        <span className="truncate">{from}</span>
        <span className="flex min-w-0 items-center gap-0.5">
          <ArrowRight className="size-3 shrink-0 text-muted" aria-hidden />
          <span className="truncate">{to}</span>
        </span>
      </span>
    </span>
  ) : (
    <span className="flex h-8 min-w-0 items-center gap-0.5 rounded-full bg-foreground/[0.06] px-2 text-[13px] font-semibold whitespace-nowrap">
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
      <div data-testid={testId} className="flex min-w-0 shrink items-center">
        {content}
      </div>
    );
  }
  return (
    <Link
      href={href}
      data-testid={testId}
      title={t("situation.edit")}
      className="flex min-h-11 min-w-0 shrink items-center rounded-full"
    >
      {content}
    </Link>
  );
}

// 「JR京都線 見合わせ」。色に加えて破線の印で止まっていることを示す
// 英語名の無い通称のときは line が null で、「Service suspended」だけを出す
// その列車だけが止まる事象では見合わせと言わず、「大阪〜塚本で停車中」か「JR京都線 後続に遅れ」にする
export function StatusChip({
  line,
  testId,
  scope = "section",
  place = null,
}: {
  line: string | null;
  testId?: string;
  scope?: StopScope;
  // その列車が止まっている場所の表示名。駅で待っている人には null
  place?: string | null;
}) {
  const t = useTranslations("judgment");

  if (scope === "train") {
    const text = place
      ? t("statusStopped", { place })
      : line
        ? t("statusDelayed", { line })
        : t("statusDelayedOnly");
    return (
      <p
        data-testid={testId}
        data-scope="train"
        className="flex h-8 min-w-0 shrink items-center rounded-full bg-hold-surface px-2 text-[12px] font-semibold whitespace-nowrap text-hold"
      >
        <span className="truncate">{text}</span>
      </p>
    );
  }

  return (
    <p
      data-testid={testId}
      data-scope="section"
      className="flex h-8 min-w-0 shrink items-center gap-1 rounded-full bg-danger/10 px-2 text-[12px] font-semibold whitespace-nowrap text-danger"
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
      <span className="truncate">{line ? t("status", { line }) : t("statusOnly")}</span>
    </p>
  );
}
