"use client";

import { ArrowRight, Info, LoaderCircle, LocateFixed, Play } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { useCallback, useMemo, useState } from "react";
import { AppHeader } from "@/components/AppHeader";
import { Button } from "@/components/ui/button";
import { useJudgmentSession } from "@/features/judgment/session";
import { testIds } from "@/features/judgment/testids";
import { BackdropMap } from "@/features/map/BackdropMap";
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
  const places = useMemo(
    () => [origin, destination].filter((p) => p !== null),
    [origin, destination],
  );

  const locateMessage =
    locateStatus === "locating"
      ? t("start.locating")
      : locateStatus === "failed"
        ? t("start.locateFailed")
        : locateStatus === "unsupported"
          ? t("start.locateUnsupported")
          : null;

  return (
    <>
      <BackdropMap places={places} />
      <AppHeader />
      <main
        id="main"
        data-testid={testIds.start.screen}
        className="relative z-10 mx-auto flex min-h-dvh max-w-md flex-col gap-4 px-4 pt-[96px] pb-10"
      >
        <section className="glass-strong flex flex-col gap-5 rounded-[24px] p-5">
          <div className="flex flex-col gap-1.5">
            <h1 className="text-[26px] leading-tight font-bold tracking-tight">
              {t("app.tagline")}
            </h1>
            <p className="text-[14px] leading-relaxed text-muted">{t("start.lead")}</p>
          </div>

          <div className="flex flex-col gap-4">
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
              <button
                type="button"
                data-testid={testIds.start.locateButton}
                onClick={locate}
                disabled={locateStatus === "locating"}
                className="inline-flex min-h-11 w-fit items-center gap-1.5 rounded-lg pr-2 text-[13px] font-medium text-focus disabled:opacity-50"
              >
                {locateStatus === "locating" ? (
                  <LoaderCircle className="size-4 animate-spin" aria-hidden />
                ) : (
                  <LocateFixed className="size-4" strokeWidth={1.75} aria-hidden />
                )}
                {t("start.locate")}
              </button>
              {locateMessage && (
                <p
                  data-testid={testIds.start.locateStatus}
                  role="status"
                  className="text-[13px] text-muted"
                >
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
            data-testid={testIds.start.nextButton}
            disabled={origin === null || destination === null}
            onClick={() => router.push("/situation")}
            className="w-full"
          >
            {t("start.next")}
            <ArrowRight aria-hidden />
          </Button>
        </section>

        <div className="flex flex-col items-center gap-1.5">
          <Link
            href="/replay"
            data-testid={testIds.start.replayLink}
            className="glass inline-flex min-h-11 items-center gap-2 rounded-full px-4 text-[14px] font-medium"
          >
            <Play className="size-3.5 fill-current" aria-hidden />
            {t("start.replayLink")}
          </Link>
          <p className="max-w-xs text-center text-[12px] leading-snug text-muted">
            {t("start.replayNote")}
          </p>
        </div>

        <div className="mt-auto flex flex-col gap-1 pt-6 pb-4 text-[12px] text-muted">
          <p className="flex items-center gap-1.5 font-medium text-foreground/80">
            <Info className="size-3.5 shrink-0" strokeWidth={1.75} aria-hidden />
            {t("disclaimer.short")}
          </p>
          <p className="pl-5">{t("start.locationNote")}</p>
        </div>
      </main>
    </>
  );
}
