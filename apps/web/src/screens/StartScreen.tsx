"use client";

import type { RawInput } from "@repo/schema";
import { useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from "react";
import { AppHeader } from "@/components/AppHeader";
import { sheetTopInset } from "@/components/MapSheet";
import { EntryMap, type EntryMapApi } from "@/features/entry/EntryMap";
import { DemoDock, PromptCard } from "@/features/entry/EntryOverlays";
import { EntrySheet } from "@/features/entry/EntrySheet";
import {
  AreaStep,
  DestinationStep,
  InputStep,
  MethodStep,
  StationStep,
  TripCard,
} from "@/features/entry/EntrySteps";
import {
  createEntryData,
  type EntryData,
  type EntryLine,
  type EntryPlace,
  findAreaAt,
  findStationChoice,
  listEntryHubs,
  openStationChoice,
  type Position,
  pickPlaceName,
  resolveConfiguredArea,
} from "@/features/entry/entry-places";
import { initialEntryState, reduceEntry } from "@/features/entry/flow";
import { buildLineObservation } from "@/features/entry/seed";
import { useJudgmentSession } from "@/features/judgment/session";
import { testIds } from "@/features/judgment/testids";
import { loadMapGeoData, type MapGeoData } from "@/features/map/geo-data";
import type { MapInsets } from "@/features/map/MapPanel";
import { findFocusArea } from "@/features/map/station-guide";
import type { StationChoice } from "@/features/stations/catalog";
import { fetchNearestStations } from "@/features/stations/client";
import { describePlace, formatDistance, pickStationName } from "@/features/stations/describe";
import { useCurrentLocation } from "@/features/stations/use-current-location";
import { desktopMediaQuery, useMediaQuery } from "@/lib/use-media-query";

// 判断の画面が最初に寄せる大阪駅のまわりの拡大率に近い値
const handoffZoom = 15.8;
// PC 幅の右パネルの幅と余白
const panelInset = 400 + 32;

// 高さを測って地図の余白に使う
function useElementHeight<T extends HTMLElement>() {
  const [height, setHeight] = useState(0);
  const observerRef = useRef<ResizeObserver | null>(null);
  const ref = useCallback((el: T | null) => {
    observerRef.current?.disconnect();
    if (!el) {
      setHeight(0);
      return;
    }
    const measure = () => setHeight(el.offsetHeight);
    measure();
    observerRef.current = new ResizeObserver(measure);
    observerRef.current.observe(el);
  }, []);
  return [ref, height] as const;
}

function useEntryData(): { geo: MapGeoData | null; data: EntryData | null } {
  const [geo, setGeo] = useState<MapGeoData | null>(null);
  useEffect(() => {
    let cancelled = false;
    loadMapGeoData()
      .then((loaded) => {
        if (!cancelled) setGeo(loaded);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);
  const data = useMemo(() => (geo ? createEntryData(geo.nodes, geo.index) : null), [geo]);
  return { geo, data };
}

// 入口。大阪を中心にした地図で駅を選び、同じ地図の上のシートで状況まで入れて判断へ渡す
export function StartScreen() {
  const t = useTranslations();
  const locale = useLocale();
  const router = useRouter();
  const session = useJudgmentSession();
  const {
    origin,
    destination,
    originLine,
    setOrigin,
    setDestination,
    setOriginLine,
    setOriginNearest,
    rememberStationName,
    stationNames,
    catalog,
    state: judgment,
    startJudgment,
  } = session;
  const { geo, data } = useEntryData();
  const hubs = useMemo(() => (data ? listEntryHubs(data) : []), [data]);
  const [entry, dispatch] = useReducer(reduceEntry, initialEntryState);
  const [note, setNote] = useState<string | null>(null);
  const [handingOff, setHandingOff] = useState(false);
  const mapApi = useRef<EntryMapApi | null>(null);
  const desktop = useMediaQuery(desktopMediaQuery);
  const narrow = useMediaQuery("(max-width: 639px)");
  const [promptRef, promptHeight] = useElementHeight<HTMLDivElement>();
  const [dockRef, dockHeight] = useElementHeight<HTMLDivElement>();
  const [sheetHeight, setSheetHeight] = useState(0);

  // 判断の画面から戻ったときは、選んだ駅・路線・行き先の状態に戻す
  const restoredRef = useRef(false);
  useEffect(() => {
    if (!data || restoredRef.current) return;
    restoredRef.current = true;
    if (origin?.kind !== "station" || !originLine) return;
    const choice = findStationChoice(data, origin.name);
    const opened = choice ? openStationChoice(data, choice) : null;
    if (!opened) return;
    dispatch({ type: "openPlace", area: opened.area, place: opened.place });
    dispatch({ type: "chooseLine", line: originLine });
    if (destination) dispatch({ type: "chooseDestination" });
  }, [data, origin, originLine, destination]);

  const openPlace = useCallback(
    (choice: StationChoice) => {
      if (!data) return;
      const opened = openStationChoice(data, choice);
      if (opened) dispatch({ type: "openPlace", area: opened.area, place: opened.place });
    },
    [data],
  );

  // 現在地から最寄りの駅を開く。位置は最寄り駅を調べるためだけに送る
  const handleLocated = useCallback(
    (point: { lat: number; lon: number }) => {
      setNote(null);
      fetchNearestStations(point)
        .then(([first]) => {
          if (!first) return;
          openPlace(first.station);
          setNote(
            t("entry.nearby", {
              station: pickStationName(first.station, locale),
              distance: formatDistance(first.meters),
            }),
          );
        })
        .catch(() => setNote(t("start.nearestFailed")));
    },
    [openPlace, t, locale],
  );
  const { status: locateStatus, locate } = useCurrentLocation(handleLocated);
  const locateMessage =
    locateStatus === "locating"
      ? t("start.locating")
      : locateStatus === "failed"
        ? t("start.locateFailed")
        : locateStatus === "unsupported"
          ? t("start.locateUnsupported")
          : note && entry.stage === "kansai"
            ? note
            : null;

  function handleTap(point: Position) {
    if (!data) return;
    if (entry.stage === "kansai") {
      const area = findAreaAt(data, point);
      if (area) dispatch({ type: "openArea", area });
    } else if (entry.stage === "station") {
      dispatch({ type: "back" });
    }
  }

  function handleBack() {
    const next = reduceEntry(entry, { type: "back" });
    if (next.stage === "area" || next.stage === "kansai") {
      setOrigin(null);
      setOriginLine(null);
      setNote(null);
    }
    dispatch({ type: "back" });
  }

  function chooseLine(line: EntryLine) {
    rememberStationName(line.stationName, line.stationNameEn);
    setOrigin({ kind: "station", name: line.stationName });
    setOriginNearest(null);
    setOriginLine(line);
    dispatch({ type: "chooseLine", line });
  }

  function chooseDestination(target: StationChoice | string) {
    const choice = typeof target === "string" && data ? findStationChoice(data, target) : target;
    if (choice && typeof choice !== "string") {
      rememberStationName(choice.name, choice.nameEn);
      setDestination({ kind: "station", name: choice.name });
    } else if (typeof target === "string") {
      setDestination({ kind: "station", name: target });
    }
    dispatch({ type: "chooseDestination" });
  }

  // 判断を始め、出発の駅へ寄せてから判断の画面へ移る。地図はそのまま判断の地図に引き継ぐ
  async function submit(input: RawInput) {
    if (!entry.line || origin === null) return;
    startJudgment(input, [buildLineObservation(entry.line, new Date())]);
    setHandingOff(true);
    if (findFocusArea(origin)) await mapApi.current?.zoomToOrigin(handoffZoom);
    router.push("/judgment");
  }

  const showSheet = entry.stage !== "kansai";
  const insets: MapInsets = desktop
    ? {
        top: showSheet ? sheetTopInset : sheetTopInset + promptHeight + 8,
        right: showSheet ? panelInset : 0,
        bottom: showSheet ? 0 : dockHeight,
        left: 0,
      }
    : {
        top: showSheet ? sheetTopInset : sheetTopInset + promptHeight + 8,
        right: 0,
        bottom: showSheet ? sheetHeight : dockHeight,
        left: 0,
      };

  const originName = entry.place ? pickPlaceName(entry.place, locale) : "";
  const lineOriginName =
    entry.line && origin
      ? describePlace(origin, locale, t("start.currentLocation"), stationNames).label
      : originName;
  const destinationLabel = destination
    ? describePlace(destination, locale, t("start.currentLocation"), stationNames).label
    : "";
  const destinationChoice =
    destination?.kind === "station" && data ? findStationChoice(data, destination.name) : null;
  const destinationMarker = destinationChoice
    ? {
        position: [destinationChoice.lon, destinationChoice.lat] as Position,
        label: destinationLabel,
      }
    : null;
  const suggestions = hubs.filter(
    (h) => h.areaId !== entry.area?.id && h.stationName !== entry.line?.stationName,
  );

  return (
    <div data-testid={testIds.start.screen} data-stage={entry.stage} className="h-dvh">
      <EntryMap
        geo={geo}
        stage={entry.stage}
        hubs={hubs}
        area={entry.area}
        place={entry.place}
        lineId={entry.line?.lineId ?? null}
        destination={destinationMarker}
        insets={insets}
        narrow={narrow}
        apiRef={mapApi}
        onSelectHub={(areaId) => {
          const area = data ? resolveConfiguredArea(data, areaId) : null;
          if (area) dispatch({ type: "openArea", area });
        }}
        onSelectPlace={(place: EntryPlace) => {
          if (entry.area) dispatch({ type: "openPlace", area: entry.area, place });
        }}
        onTap={handleTap}
      />
      <AppHeader
        variant="map"
        below={
          entry.stage === "kansai" ? (
            <PromptCard
              ref={promptRef}
              locateStatus={locateStatus}
              message={locateMessage}
              onLocate={locate}
              onSelect={openPlace}
            />
          ) : undefined
        }
      />
      <main id="main">
        {entry.stage === "kansai" && <DemoDock ref={dockRef} />}
        {showSheet && (
          <EntrySheet
            stageKey={`${entry.stage}:${entry.area?.id}:${entry.place?.key}`}
            onBack={handleBack}
            onHeightChange={setSheetHeight}
          >
            {entry.stage === "area" && entry.area && (
              <AreaStep
                area={entry.area}
                onSelect={(place) =>
                  entry.area && dispatch({ type: "openPlace", area: entry.area, place })
                }
              />
            )}
            {entry.stage === "station" && entry.place && (
              <StationStep place={entry.place} note={note} onSelect={chooseLine} />
            )}
            {entry.stage === "destination" && entry.line && (
              <DestinationStep
                originName={lineOriginName}
                line={entry.line}
                suggestions={suggestions}
                onSelect={chooseDestination}
                onFreeText={chooseDestination}
              />
            )}
            {(entry.stage === "method" || entry.stage === "input") && entry.line && (
              <TripCard
                originName={lineOriginName}
                destinationName={destinationLabel}
                line={entry.line}
                onEditLine={() => dispatch({ type: "editLine" })}
                onEditDestination={() => dispatch({ type: "editDestination" })}
              />
            )}
            {entry.stage === "method" && (
              <MethodStep onSelect={(method) => dispatch({ type: "chooseMethod", method })} />
            )}
            {entry.stage === "input" && entry.method && (
              <InputStep
                method={entry.method}
                catalog={catalog}
                busy={handingOff || judgment.status === "streaming"}
                onSubmit={(input) => void submit(input)}
              />
            )}
          </EntrySheet>
        )}
      </main>
    </div>
  );
}
