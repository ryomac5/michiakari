"use client";

import { ArrowRight, Info, LoaderCircle, LocateFixed, PlayCircle } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { useCallback, useState } from "react";
import { LogoMark } from "@/components/LogoMark";
import { Button, buttonVariants } from "@/components/ui/button";
import { useJudgmentSession } from "@/features/judgment/session";
import { testIds } from "@/features/judgment/testids";
import type { StationChoice } from "@/features/stations/catalog";
import { fetchNearestStations } from "@/features/stations/client";
import { StationSearch } from "@/features/stations/components/StationSearch";
import { describePlace, formatDistance } from "@/features/stations/describe";
import { useCurrentLocation } from "@/features/stations/use-current-location";

export function StartScreen() {
  const t = useTranslations();
  const locale = useLocale();
  const router = useRouter();
  const {
    origin,
    destination,
    setOrigin,
    setDestination,
    stationNames,
    rememberStationName,
    originNearest,
    setOriginNearest,
  } = useJudgmentSession();
  const [nearestFailed, setNearestFailed] = useState(false);

  // 現在地を出発地にし、最寄り駅はサーバーで調べる。位置はこの要求にだけ使う
  const handleLocated = useCallback(
    (point: { lat: number; lon: number }) => {
      setOrigin({ kind: "coord", ...point });
      setOriginNearest(null);
      setNearestFailed(false);
      fetchNearestStations(point)
        .then(([first]) => {
          if (first) {
            setOriginNearest({
              name: first.station.name,
              nameEn: first.station.nameEn,
              meters: first.meters,
            });
          }
        })
        .catch(() => setNearestFailed(true));
    },
    [setOrigin, setOriginNearest],
  );
  const { status: locateStatus, locate } = useCurrentLocation(handleLocated);

  function selectStation(station: StationChoice, set: typeof setOrigin) {
    rememberStationName(station.name, station.nameEn);
    set({ kind: "station", name: station.name });
  }

  const currentLabel = t("start.currentLocation");
  const originLabel = origin
    ? describePlace(origin, locale, currentLabel, stationNames, originNearest)
    : null;
  const destinationLabel = destination
    ? describePlace(destination, locale, currentLabel, stationNames)
    : null;

  const locateMessage =
    locateStatus === "locating"
      ? t("start.locating")
      : locateStatus === "failed"
        ? t("start.locateFailed")
        : locateStatus === "unsupported"
          ? t("start.locateUnsupported")
          : null;

  return (
    <main
      id="main"
      data-testid={testIds.start.screen}
      className="mx-auto flex max-w-2xl flex-col gap-7 px-4 pt-6 pb-10"
    >
      <div className="flex items-center gap-4">
        <LogoMark className="size-16 sm:size-20" />
        <div className="flex min-w-0 flex-col gap-1">
          <h1 className="text-3xl leading-none font-extrabold tracking-tight sm:text-4xl">
            {t("app.name")}
          </h1>
          <p className="text-lg leading-snug font-bold text-brand">{t("app.tagline")}</p>
        </div>
      </div>
      <p className="-mt-2 leading-relaxed text-muted">{t("start.lead")}</p>

      <div className="flex flex-col gap-6">
        <StationSearch
          label={t("start.originLabel")}
          placeholder={t("start.originPlaceholder")}
          selectedLabel={originLabel?.label ?? null}
          selectedDetail={
            origin?.kind === "coord"
              ? originLabel?.nearest
                ? t("start.nearest", {
                    station: originLabel.nearest.station,
                    distance: formatDistance(originLabel.nearest.meters),
                  })
                : nearestFailed
                  ? t("start.nearestFailed")
                  : t("start.locating")
              : undefined
          }
          onSelect={(station) => selectStation(station, setOrigin)}
          onClear={() => {
            setOrigin(null);
            setOriginNearest(null);
          }}
          testIds={{
            search: testIds.start.originSearch,
            option: testIds.start.originOption,
            selected: testIds.start.originSelected,
            clear: testIds.start.originClear,
          }}
        >
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <span className="text-sm text-muted">{t("start.or")}</span>
            <Button
              variant="outline"
              data-testid={testIds.start.locateButton}
              onClick={locate}
              disabled={locateStatus === "locating"}
            >
              {locateStatus === "locating" ? (
                <LoaderCircle className="animate-spin" aria-hidden />
              ) : (
                <LocateFixed aria-hidden />
              )}
              {t("start.locate")}
            </Button>
          </div>
          {locateMessage && (
            <p data-testid={testIds.start.locateStatus} role="status" className="text-muted">
              {locateMessage}
            </p>
          )}
        </StationSearch>

        <StationSearch
          label={t("start.destinationLabel")}
          placeholder={t("start.destinationPlaceholder")}
          selectedLabel={destinationLabel?.label ?? null}
          onSelect={(station) => selectStation(station, setDestination)}
          onFreeText={(text) => setDestination({ kind: "station", name: text })}
          onClear={() => setDestination(null)}
          testIds={{
            search: testIds.start.destinationSearch,
            option: testIds.start.destinationOption,
            selected: testIds.start.destinationSelected,
            clear: testIds.start.destinationClear,
          }}
        />
      </div>

      <Button
        size="lg"
        data-testid={testIds.start.nextButton}
        disabled={origin === null || destination === null}
        onClick={() => router.push("/situation")}
        className="w-full"
      >
        {t("start.next")}
        <ArrowRight aria-hidden />
      </Button>

      <div className="flex flex-col gap-2 rounded-3xl border-2 border-border bg-surface p-4">
        <Link
          href="/replay"
          data-testid={testIds.start.replayLink}
          className={buttonVariants({ variant: "secondary", className: "w-full" })}
        >
          <PlayCircle aria-hidden />
          {t("start.replayLink")}
        </Link>
        <p className="text-sm leading-relaxed text-muted">{t("start.replayNote")}</p>
      </div>

      <div className="flex flex-col gap-1.5 border-t border-border pt-4 text-sm text-muted">
        <p className="flex items-start gap-2">
          <Info className="mt-0.5 size-4 shrink-0" aria-hidden />
          <span className="font-bold">{t("disclaimer.short")}</span>
        </p>
        <p className="pl-6">{t("start.locationNote")}</p>
      </div>
    </main>
  );
}
