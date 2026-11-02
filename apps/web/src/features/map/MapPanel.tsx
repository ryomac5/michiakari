"use client";

import "maplibre-gl/dist/maplibre-gl.css";
import type { Place, RouteOption, Section } from "@repo/schema";
import type { GeoJSONSource, Map as MapLibreMap } from "maplibre-gl";
import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";
import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { testIds } from "@/features/judgment/testids";
import { loadMapGeoData, type MapGeoData } from "./geo-data";
import { selectMapLabels } from "./labels";
import {
  buildBaseStyle,
  buildDataLayers,
  buildTransferFilter,
  listPaintValues,
  type MapPalette,
  type MapTheme,
  mapPalettes,
  sourceIds,
  transferHaloLayerId,
} from "./layers";
import { MapLegend } from "./MapLegend";
import { fetchReachAreas, type ReachArea } from "./reach";
import { buildMapScene, buildStationPoints, type MapScene } from "./scene";
import { mapTestIds } from "./testids";

export type MapPanelProps = {
  origin: Place;
  destination: Place;
  options: RouteOption[];
  recommendedOptionId: string | null;
  // 止まっている区間。観測から分かったもの
  blockedSection: Section | null;
  // 止まっている路線の名前（観測の line）。無ければ「待つ」経路の路線から推し量る
  blockedLine?: string | null;
};

// updating は描画済みの地図にレイヤーの差し替えを反映している間
type MapStatus = "loading" | "updating" | "ready" | "error";

const defaultCenter: [number, number] = [135.5, 34.7];
const fitPadding = { top: 40, bottom: 52, left: 28, right: 28 };

function subscribeTheme(onChange: () => void): () => void {
  const observer = new MutationObserver(onChange);
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });
  return () => observer.disconnect();
}

function readTheme(): MapTheme {
  return document.documentElement.classList.contains("light") ? "light" : "dark";
}

function useDocumentTheme(): MapTheme {
  return useSyncExternalStore(subscribeTheme, readTheme, () => "dark");
}

// MapLibre の worker は別ファイル。バンドラに資産として出させ、その URL を渡す
async function loadMapLibre(): Promise<typeof import("maplibre-gl")> {
  const maplibre = await import("maplibre-gl");
  maplibre.setWorkerUrl(new URL("maplibre-gl/dist/maplibre-gl-worker.mjs", import.meta.url).href);
  return maplibre;
}

function prefersReducedMotion(): boolean {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

function addDataLayers(map: MapLibreMap, geo: MapGeoData, palette: MapPalette): void {
  const empty = { type: "FeatureCollection" as const, features: [] };
  map.addSource(sourceIds.lines, { type: "geojson", data: geo.lines });
  map.addSource(sourceIds.stations, { type: "geojson", data: buildStationPoints(geo) });
  for (const id of [
    sourceIds.reach,
    sourceIds.blocked,
    sourceIds.route,
    sourceIds.reachable,
    sourceIds.places,
    sourceIds.labels,
  ]) {
    map.addSource(id, { type: "geojson", data: empty });
  }
  for (const layer of buildDataLayers(palette)) map.addLayer(layer);
}

function applyMapScene(map: MapLibreMap, scene: MapScene): void {
  const updates: [string, unknown][] = [
    [sourceIds.reach, scene.reach],
    [sourceIds.blocked, scene.blocked],
    [sourceIds.route, scene.route],
    [sourceIds.reachable, scene.reachableStations],
    [sourceIds.places, scene.places],
    [sourceIds.labels, scene.stationLabels],
  ];
  for (const [id, data] of updates) {
    map.getSource<GeoJSONSource>(id)?.setData(data as Parameters<GeoJSONSource["setData"]>[0]);
  }
  map.setFilter(transferHaloLayerId, buildTransferFilter(scene.transferLineIds));
}

function applyMapPalette(map: MapLibreMap, palette: MapPalette): void {
  for (const { layerId, key, value } of listPaintValues(palette)) {
    if (map.getLayer(layerId)) {
      type PaintArgs = Parameters<MapLibreMap["setPaintProperty"]>;
      map.setPaintProperty(layerId, key as PaintArgs[1], value as PaintArgs[2]);
    }
  }
}

// 毎回新しい配列を返すと地図の組み立てが描画のたびに走るので、空は 1 つを使い回す
const noReachAreas: readonly ReachArea[] = [];

// 現在地の駅の到達範囲を取ってくる。駅でない現在地や取得の失敗は空（円の概算）にする
// 取得が済むまでは null を返し、円から多角形への描き替えでちらつかないようにする
function useReachAreas(origin: Place): readonly ReachArea[] | null {
  const stationName = origin.kind === "station" ? origin.name : null;
  const [reach, setReach] = useState<{ stationName: string; areas: ReachArea[] } | null>(null);

  useEffect(() => {
    if (stationName === null) return;
    const controller = new AbortController();
    fetchReachAreas(stationName, controller.signal)
      .then((areas) => setReach({ stationName, areas }))
      .catch(() => {
        if (!controller.signal.aborted) setReach({ stationName, areas: [] });
      });
    return () => controller.abort();
  }, [stationName]);

  if (stationName === null) return noReachAreas;
  return reach?.stationName === stationName ? reach.areas : null;
}

// 実距離の路線図に、止まっている区間・徒歩の到達範囲・動いている駅・推奨経路を重ねる
export function MapPanel(props: MapPanelProps) {
  const t = useTranslations("map");
  const labels = selectMapLabels(useLocale());
  const theme = useDocumentTheme();
  const palette = mapPalettes[theme];

  const containerRef = useRef<HTMLDivElement>(null);
  const paletteRef = useRef(palette);
  paletteRef.current = palette;
  const labelsRef = useRef(labels);
  labelsRef.current = labels;
  const fittedBoundsRef = useRef<string | null>(null);

  const [geo, setGeo] = useState<MapGeoData | null>(null);
  const [map, setMap] = useState<MapLibreMap | null>(null);
  const [status, setStatus] = useState<MapStatus>("loading");

  useEffect(() => {
    let cancelled = false;
    loadMapGeoData()
      .then((data) => {
        if (!cancelled) setGeo(data);
      })
      .catch(() => {
        if (!cancelled) setStatus("error");
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // 地図は 1 度だけ作り、以降はデータと塗りだけを入れ替える
  useEffect(() => {
    const container = containerRef.current;
    if (!geo || !container) return;
    let disposed = false;
    let instance: MapLibreMap | null = null;

    loadMapLibre()
      .then(({ Map: MapClass }) => {
        if (disposed) return;
        const gestures = labelsRef.current.gestures;
        instance = new MapClass({
          container,
          style: buildBaseStyle(paletteRef.current),
          center: defaultCenter,
          zoom: 10,
          minZoom: 7,
          maxZoom: 17,
          attributionControl: false,
          cooperativeGestures: true,
          dragRotate: false,
          pitchWithRotate: false,
          touchPitch: false,
          locale: {
            "CooperativeGesturesHandler.WindowsHelpText": gestures.windows,
            "CooperativeGesturesHandler.MacHelpText": gestures.mac,
            "CooperativeGesturesHandler.MobileHelpText": gestures.mobile,
          },
        });
        instance.touchZoomRotate.disableRotation();
        const loaded = instance;
        loaded.on("load", () => {
          addDataLayers(loaded, geo, paletteRef.current);
          setMap(loaded);
        });
      })
      .catch(() => {
        if (!disposed) setStatus("error");
      });

    return () => {
      disposed = true;
      instance?.remove();
      fittedBoundsRef.current = null;
      setMap(null);
    };
  }, [geo]);

  const { origin, destination, options, recommendedOptionId, blockedSection, blockedLine } = props;
  const reachAreas = useReachAreas(origin);
  const scene = useMemo(
    () =>
      geo && reachAreas
        ? buildMapScene(
            geo,
            {
              origin,
              destination,
              options,
              recommendedOptionId,
              blockedSection,
              blockedLine,
              reachAreas,
            },
            labels,
          )
        : null,
    [
      geo,
      reachAreas,
      origin,
      destination,
      options,
      recommendedOptionId,
      blockedSection,
      blockedLine,
      labels,
    ],
  );

  // 判断の状態が変わるたびにレイヤーを差し替え、選択肢の範囲へ寄せる
  useEffect(() => {
    if (!map || !scene) return;
    applyMapScene(map, scene);
    const boundsKey = JSON.stringify(scene.bounds);
    if (scene.bounds && boundsKey !== fittedBoundsRef.current) {
      const first = fittedBoundsRef.current === null;
      map.fitBounds(scene.bounds, {
        padding: fitPadding,
        maxZoom: 15,
        duration: first || prefersReducedMotion() ? 0 : 600,
      });
      fittedBoundsRef.current = boundsKey;
    }
    setStatus((s) => (s === "ready" ? "updating" : s));
    map.once("idle", () => setStatus("ready"));
    map.triggerRepaint();
  }, [map, scene]);

  useEffect(() => {
    if (map) applyMapPalette(map, palette);
  }, [map, palette]);

  return (
    <section
      data-testid={testIds.judgment.map}
      data-state={status}
      data-recommended-option={recommendedOptionId ?? ""}
      data-blocked={scene ? scene.blocked.features.length > 0 : false}
      data-reach-source={scene?.reachSource ?? ""}
      aria-label={t("title")}
      className="flex flex-col gap-3"
    >
      <div className="relative h-[300px] w-full overflow-hidden rounded-3xl border-2 border-border bg-surface-raised sm:h-[380px]">
        <div ref={containerRef} data-testid={mapTestIds.canvas} className="h-full w-full" />
        {(status === "loading" || status === "error") && (
          <p
            role="status"
            className="pointer-events-none absolute inset-0 flex items-center justify-center font-bold text-muted"
          >
            {status === "error" ? labels.error : labels.loading}
          </p>
        )}
        <div
          data-testid={mapTestIds.attribution}
          className="pointer-events-none absolute right-0 bottom-0 left-0 flex items-end text-[10px] leading-snug text-muted"
        >
          <p
            aria-hidden
            data-testid={mapTestIds.attributionLine}
            className="min-w-0 flex-1 truncate bg-background/75 py-0.5 pl-2.5 tracking-tight"
          >
            {labels.attribution.short}
          </p>
          <ul className="sr-only">
            {labels.attribution.full.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
          {/* 文字は小さいまま、押せる高さは 44px にする */}
          <Link
            href="/about"
            className="pointer-events-auto flex h-11 shrink-0 items-end font-bold underline underline-offset-2"
          >
            <span className="bg-background/75 py-0.5 pr-2.5 pl-2">{labels.attribution.link}</span>
          </Link>
        </div>
      </div>
      <MapLegend palette={palette} labels={labels} reachSource={scene?.reachSource ?? null} />
    </section>
  );
}
