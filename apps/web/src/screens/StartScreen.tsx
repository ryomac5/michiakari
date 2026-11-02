"use client";

import { ArrowRight, Info, LoaderCircle, LocateFixed, PlayCircle } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { useCallback } from "react";
import { Button, buttonVariants } from "@/components/ui/button";
import { useJudgmentSession } from "@/features/judgment/session";
import { testIds } from "@/features/judgment/testids";
import { StationSearch } from "@/features/stations/components/StationSearch";
import { describePlace, formatDistance } from "@/features/stations/describe";
import { provisionalStations } from "@/features/stations/fixtures/stations";
import { useCurrentLocation } from "@/features/stations/use-current-location";

export function StartScreen() {
  const t = useTranslations();
  const locale = useLocale();
  const router = useRouter();
  const { origin, destination, setOrigin, setDestination } = useJudgmentSession();

  const handleLocated = useCallback(
    (point: { lat: number; lon: number }) => setOrigin({ kind: "coord", ...point }),
    [setOrigin],
  );
  const { status: locateStatus, locate } = useCurrentLocation(handleLocated);

  const currentLabel = t("start.currentLocation");
  const originLabel = origin ? describePlace(origin, locale, currentLabel) : null;
  const destinationLabel = destination ? describePlace(destination, locale, currentLabel) : null;

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
      data-testid={testIds.start.screen}
      className="mx-auto flex max-w-2xl flex-col gap-8 px-4 py-8"
    >
      <div className="flex flex-col gap-3">
        <h1 className="text-3xl leading-tight font-extrabold">{t("app.title")}</h1>
        <p className="text-lg leading-relaxed text-muted">{t("start.lead")}</p>
      </div>

      <section className="flex flex-col gap-6">
        <StationSearch
          label={t("start.originLabel")}
          placeholder={t("start.originPlaceholder")}
          stations={provisionalStations}
          selectedLabel={originLabel?.label ?? null}
          selectedDetail={
            originLabel?.nearest
              ? t("start.nearest", {
                  station: originLabel.nearest.station,
                  distance: formatDistance(originLabel.nearest.meters),
                })
              : undefined
          }
          onSelect={(station) => setOrigin({ kind: "station", name: station.name })}
          onClear={() => setOrigin(null)}
          testIds={{
            search: testIds.start.originSearch,
            option: testIds.start.originOption,
            selected: testIds.start.originSelected,
            clear: testIds.start.originClear,
          }}
        >
          <Button
            variant="outline"
            data-testid={testIds.start.locateButton}
            onClick={locate}
            disabled={locateStatus === "locating"}
            className="self-start"
          >
            {locateStatus === "locating" ? (
              <LoaderCircle className="animate-spin" aria-hidden />
            ) : (
              <LocateFixed aria-hidden />
            )}
            {t("start.locate")}
          </Button>
          {locateMessage && (
            <p data-testid={testIds.start.locateStatus} role="status" className="text-muted">
              {locateMessage}
            </p>
          )}
        </StationSearch>

        <StationSearch
          label={t("start.destinationLabel")}
          placeholder={t("start.destinationPlaceholder")}
          stations={provisionalStations}
          selectedLabel={destinationLabel?.label ?? null}
          onSelect={(station) => setDestination({ kind: "station", name: station.name })}
          onFreeText={(text) => setDestination({ kind: "station", name: text })}
          onClear={() => setDestination(null)}
          testIds={{
            search: testIds.start.destinationSearch,
            option: testIds.start.destinationOption,
            selected: testIds.start.destinationSelected,
            clear: testIds.start.destinationClear,
          }}
        />
      </section>

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

      <div className="flex flex-col gap-2">
        <Link
          href="/replay"
          data-testid={testIds.start.replayLink}
          className={buttonVariants({ variant: "outline", className: "w-full" })}
        >
          <PlayCircle aria-hidden />
          {t("start.replayLink")}
        </Link>
        <p className="text-sm text-muted">{t("start.replayNote")}</p>
      </div>

      <div className="flex flex-col gap-1 border-t border-border pt-4 text-sm text-muted">
        <p className="flex items-start gap-2">
          <Info className="mt-0.5 size-4 shrink-0" aria-hidden />
          <span>{t("disclaimer.short")}</span>
        </p>
        <p className="pl-6">{t("start.stationListNote")}</p>
      </div>
    </main>
  );
}
