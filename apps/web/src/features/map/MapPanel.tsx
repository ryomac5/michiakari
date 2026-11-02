"use client";

import "maplibre-gl/dist/maplibre-gl.css";
import type { Action, Place, RouteOption, Section } from "@repo/schema";
import { LocateFixed } from "lucide-react";
import type { GeoJSONSource, Map as MapLibreMap, Marker } from "maplibre-gl";
import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";
import { useEffect, useMemo, useRef, useState } from "react";
import { selectOptionTone } from "@/features/judgment/action-style";
import { testIds } from "@/features/judgment/testids";
import { prefersReducedMotion, useDocumentTheme } from "@/lib/use-document-theme";
import { loadMapGeoData, type MapGeoData } from "./geo-data";
import { selectMapLabels } from "./labels";
import {
  buildBaseStyle,
  buildDataLayers,
  listPaintValues,
  type MapPalette,
  mapPalettes,
  sourceIds,
} from "./layers";
import { fetchReachAreas, type ReachArea } from "./reach";
import {
  buildMapScene,
  buildStationLabels,
  type MapScene,
  type Position,
  type ReachSource,
} from "./scene";
import { mapTestIds } from "./testids";

// 地図の上に重なる部品（上部の帯・シート・パネル）が占める幅。地図を寄せるときの余白にする
export type MapInsets = { top: number; right: number; bottom: number; left: number };

export type MapPanelProps = {
  origin: Place;
  destination: Place;
  options: RouteOption[];
  recommendedOptionId: string | null;
  // 止まっている区間。観測から分かったもの
  blockedSection: Section | null;
  // 止まっている路線の名前（観測の line）。無ければ「待つ」経路の路線から推し量る
  blockedLine?: string | null;
  insets: MapInsets;
  onReachSourceChange?: (source: ReachSource | null) => void;
};

// updating は描画済みの地図にレイヤーの差し替えを反映している間
type MapStatus = "loading" | "updating" | "ready" | "error";

const defaultCenter: [number, number] = [135.5, 34.7];
// 重なる部品からさらに空ける余白
const fitMargin = { x: 64, y: 36 };
const fitDurationMs = 700;

// 推奨経路の色。推奨の選択肢が待つなら青、それ以外は橙
export function selectRouteTone(
  options: RouteOption[],
  recommendedOptionId: string | null,
): Action {
  const recommended = options.find((o) => o.id === recommendedOptionId);
  return recommended ? selectOptionTone(recommended.kind) : "wait";
}

// MapLibre の worker は別ファイル。バンドラに資産として出させ、その URL を渡す
export async function loadMapLibre(): Promise<typeof import("maplibre-gl")> {
  const maplibre = await import("maplibre-gl");
  maplibre.setWorkerUrl(new URL("maplibre-gl/dist/maplibre-gl-worker.mjs", import.meta.url).href);
  return maplibre;
}

function addDataLayers(map: MapLibreMap, geo: MapGeoData, palette: MapPalette, tone: Action) {
  const empty = { type: "FeatureCollection" as const, features: [] };
  map.addSource(sourceIds.lines, { type: "geojson", data: geo.lines });
  map.addSource(sourceIds.labels, {
    type: "geojson",
    data: buildStationLabels(geo.nodes, new Set()),
  });
  for (const id of [
    sourceIds.reach,
    sourceIds.blocked,
    sourceIds.route,
    sourceIds.routeLabel,
    sourceIds.alternatives,
    sourceIds.keyStations,
  ]) {
    map.addSource(id, { type: "geojson", data: empty });
  }
  for (const layer of buildDataLayers(palette, tone)) map.addLayer(layer);
}

function applyMapScene(map: MapLibreMap, scene: MapScene): void {
  const updates: [string, unknown][] = [
    [sourceIds.reach, scene.reach],
    [sourceIds.blocked, scene.blocked],
    [sourceIds.route, scene.route],
    [sourceIds.routeLabel, scene.routeLabel],
    [sourceIds.alternatives, scene.alternatives],
    [sourceIds.keyStations, scene.keyStations],
  ];
  for (const [id, data] of updates) {
    map.getSource<GeoJSONSource>(id)?.setData(data as Parameters<GeoJSONSource["setData"]>[0]);
  }
}

function applyMapPalette(map: MapLibreMap, palette: MapPalette, tone: Action): void {
  for (const { layerId, key, value } of listPaintValues(palette, tone)) {
    if (map.getLayer(layerId)) {
      type PaintArgs = Parameters<MapLibreMap["setPaintProperty"]>;
      map.setPaintProperty(layerId, key as PaintArgs[1], value as PaintArgs[2]);
    }
  }
}

function buildPadding(insets: MapInsets) {
  return {
    top: insets.top + fitMargin.y,
    right: insets.right + fitMargin.x,
    bottom: insets.bottom + fitMargin.y,
    left: insets.left + fitMargin.x,
  };
}

// 出発は丸、行き先はピン。色はテーマの文字色に合わせる
function createPlaceElement(role: "origin" | "destination"): HTMLElement {
  const el = document.createElement("div");
  el.setAttribute("aria-hidden", "true");
  if (role === "origin") {
    el.className =
      "size-[18px] rounded-full border-[3px] border-white bg-foreground shadow-[0_1px_6px_rgb(0_0_0/0.35)]";
  } else {
    el.className = "text-foreground drop-shadow-[0_2px_4px_rgb(0_0_0/0.3)]";
    el.innerHTML =
      '<svg width="28" height="36" viewBox="0 0 28 36"><path d="M14 35c-6-8-12-13-12-20a12 12 0 0 1 24 0c0 7-6 12-12 20Z" fill="currentColor" stroke="white" stroke-width="2"/><circle cx="14" cy="14" r="4.5" fill="white"/></svg>';
  }
  return el;
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

// 地図を画面全体に敷き、止まっている区間・徒歩の到達範囲・推奨経路・代替経路を重ねる
export function MapPanel(props: MapPanelProps) {
  const t = useTranslations("map");
  const locale = useLocale();
  const labels = selectMapLabels(locale);
  const theme = useDocumentTheme();
  const palette = mapPalettes[theme];
  const { origin, destination, options, recommendedOptionId, blockedSection, blockedLine } = props;
  const tone = selectRouteTone(options, recommendedOptionId);

  const containerRef = useRef<HTMLDivElement>(null);
  const paletteRef = useRef(palette);
  paletteRef.current = palette;
  const toneRef = useRef(tone);
  toneRef.current = tone;
  const fittedRef = useRef<string | null>(null);
  const markersRef = useRef<{ origin: Marker | null; destination: Marker | null }>({
    origin: null,
    destination: null,
  });
  const markerClassRef = useRef<typeof Marker | null>(null);

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
    const markers = markersRef.current;

    loadMapLibre()
      .then(({ Map: MapClass, Marker: MarkerClass }) => {
        if (disposed) return;
        markerClassRef.current = MarkerClass;
        instance = new MapClass({
          container,
          style: buildBaseStyle(paletteRef.current),
          center: defaultCenter,
          zoom: 10,
          minZoom: 7,
          maxZoom: 17,
          attributionControl: false,
          dragRotate: false,
          pitchWithRotate: false,
          touchPitch: false,
        });
        instance.touchZoomRotate.disableRotation();
        const loaded = instance;
        loaded.on("load", () => {
          addDataLayers(loaded, geo, paletteRef.current, toneRef.current);
          setMap(loaded);
        });
      })
      .catch(() => {
        if (!disposed) setStatus("error");
      });

    return () => {
      disposed = true;
      markers.origin?.remove();
      markers.destination?.remove();
      markers.origin = null;
      markers.destination = null;
      instance?.remove();
      fittedRef.current = null;
      setMap(null);
    };
  }, [geo]);

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
            { ...labels, english: locale === "en" },
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
      locale,
    ],
  );

  const { onReachSourceChange } = props;
  const reachSource = scene?.reachSource ?? null;
  useEffect(() => {
    onReachSourceChange?.(reachSource);
  }, [reachSource, onReachSourceChange]);

  const { top, right, bottom, left } = props.insets;
  const fitToScene = useMemo(
    () => (instant: boolean) => {
      if (!map || !scene?.bounds) return;
      map.fitBounds(scene.bounds, {
        padding: buildPadding({ top, right, bottom, left }),
        maxZoom: 14,
        duration: instant || prefersReducedMotion() ? 0 : fitDurationMs,
      });
    },
    [map, scene, top, right, bottom, left],
  );

  // 判断の状態が変わるたびにレイヤーを差し替え、出発・行き先・経路・区間が収まるよう寄せる
  useEffect(() => {
    if (!map || !scene) return;
    applyMapScene(map, scene);
    const fitKey = JSON.stringify([scene.bounds, top, right, bottom, left]);
    if (scene.bounds && fitKey !== fittedRef.current) {
      fitToScene(fittedRef.current === null);
      fittedRef.current = fitKey;
    }
    setStatus((s) => (s === "ready" ? "updating" : s));
    map.once("idle", () => setStatus("ready"));
    map.triggerRepaint();
  }, [map, scene, fitToScene, top, right, bottom, left]);

  // 出発と行き先のピン
  useEffect(() => {
    const MarkerClass = markerClassRef.current;
    if (!map || !scene || !MarkerClass) return;
    const entries: ["origin" | "destination", Position | null][] = [
      ["origin", scene.origin],
      ["destination", scene.destination],
    ];
    for (const [role, position] of entries) {
      const current = markersRef.current[role];
      if (position === null) {
        current?.remove();
        markersRef.current[role] = null;
      } else if (current) {
        current.setLngLat(position);
      } else {
        markersRef.current[role] = new MarkerClass({
          element: createPlaceElement(role),
          anchor: role === "origin" ? "center" : "bottom",
        })
          .setLngLat(position)
          .addTo(map);
      }
    }
  }, [map, scene]);

  useEffect(() => {
    if (map) applyMapPalette(map, palette, tone);
  }, [map, palette, tone]);

  return (
    <section
      data-testid={testIds.judgment.map}
      data-state={status}
      data-recommended-option={recommendedOptionId ?? ""}
      data-route-tone={tone}
      data-blocked={scene ? scene.blocked.features.length > 0 : false}
      data-reach-source={scene?.reachSource ?? ""}
      aria-label={t("title")}
      className="fixed inset-0 z-0 bg-background"
    >
      <div ref={containerRef} data-testid={mapTestIds.canvas} className="h-full w-full" />
      {(status === "loading" || status === "error") && (
        <p
          role="status"
          className="pointer-events-none absolute inset-0 flex items-center justify-center text-[13px] text-muted"
        >
          {status === "error" ? labels.error : labels.loading}
        </p>
      )}
      <button
        type="button"
        onClick={() => fitToScene(false)}
        aria-label={labels.recenter}
        title={labels.recenter}
        disabled={!scene?.bounds}
        style={{ bottom: bottom + 40, right: right + 12 }}
        className="glass absolute z-10 flex size-11 items-center justify-center rounded-full text-foreground transition-[bottom] duration-200 disabled:opacity-0"
      >
        <LocateFixed className="size-5" strokeWidth={1.75} aria-hidden />
      </button>
      {/* 出典は隅に 1 行で常設する。文字は小さいまま、押せる高さは 44px にする */}
      <div
        data-testid={mapTestIds.attribution}
        style={{ bottom: bottom, left: left, right: right }}
        className="pointer-events-none absolute z-10 flex items-end px-3 text-[10px] leading-snug text-muted transition-[bottom] duration-200"
      >
        <p
          aria-hidden
          data-testid={mapTestIds.attributionLine}
          className="min-w-0 flex-1 truncate py-0.5 tracking-tight opacity-80 [text-shadow:0_0_3px_var(--background)]"
        >
          {labels.attribution.short}
        </p>
        <ul className="sr-only">
          {labels.attribution.full.map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
        <Link
          href="/about"
          className="pointer-events-auto flex h-11 shrink-0 items-end pb-0.5 pl-2 font-medium underline underline-offset-2 [text-shadow:0_0_3px_var(--background)]"
        >
          {labels.attribution.link}
        </Link>
      </div>
    </section>
  );
}
