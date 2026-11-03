"use client";

import "maplibre-gl/dist/maplibre-gl.css";
import type { Action, Place, RouteOption, Section } from "@repo/schema";
import { LocateFixed, Route } from "lucide-react";
import type { GeoJSONSource, Map as MapLibreMap, Marker } from "maplibre-gl";
import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { selectOptionTone } from "@/features/judgment/action-style";
import { testIds } from "@/features/judgment/testids";
import { prefersReducedMotion, useDocumentTheme } from "@/lib/use-document-theme";
import { useMediaQuery } from "@/lib/use-media-query";
import { buildAutoFocusArea } from "./auto-focus";
import { chooseBubblePlacements, type LayoutItem, projectToWorld } from "./bubble-layout";
import type { BubblePlacement } from "./focus-areas";
import { loadMapGeoData, type MapGeoData } from "./geo-data";
import { selectMapLabels } from "./labels";
import {
  buildBaseStyle,
  buildDataLayers,
  listPaintValues,
  type MapMode,
  type MapPalette,
  type MapView,
  mapPalettes,
  sourceIds,
} from "./layers";
import { fetchReachAreas, type ReachArea } from "./reach";
import { BlockedTag, HereMarker, StationBubble } from "./StationBubble";
import {
  type BlockedDirection,
  buildMapScene,
  buildStationLabels,
  type MapScene,
  type Position,
  type ReachSource,
  resolvePlacePosition,
} from "./scene";
import {
  buildStationGuide,
  findFocusArea,
  findPointAtDistance,
  findRingLabelPoint,
  listBoardingStationIds,
  type StationGuide,
} from "./station-guide";
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
  // 入口で選んだ路線と方面。観測に区間が無いとき、その方面を止まっている区間として描く
  blockedDirection?: BlockedDirection | null;
  insets: MapInsets;
  onReachSourceChange?: (source: ReachSource | null) => void;
  // 現在地のまわりの案内。シートの選択肢の行に同じ印を添えるのに使う
  onGuideChange?: (guide: StationGuide | null) => void;
  // 吹き出しを押したとき。シートのその選択肢へ移る
  onSelectOption?: (optionId: string) => void;
};

// updating は描画済みの地図にレイヤーの差し替えを反映している間
type MapStatus = "loading" | "updating" | "ready" | "error";

const defaultCenter: [number, number] = [135.5, 34.7];
// 重なる部品からさらに空ける余白
const fitMargin = { x: 64, y: 36 };
// 現在地のまわりでは、吹き出しと現在地の札のぶんを空ける。狭い画面では札を上に出す
const focusMargin = {
  wide: { top: 110, right: 230, bottom: 60, left: 230 },
  narrow: { top: 56, right: 215, bottom: 30, left: 80 },
};
// 自動で選んだ駅は吹き出しが四方に出るので、左右を同じだけ空ける
const autoFocusMargin = {
  wide: { top: 120, right: 230, bottom: 80, left: 230 },
  narrow: { top: 70, right: 110, bottom: 60, left: 110 },
};
const fitDurationMs = 700;
// 最初に出発の駅へ寄せておく拡大率。入口が判断へ移る直前に寄せる値とそろえる
const initialOriginZoom = 15.8;
// おすすめの吹き出しの高さのおよそ（px）
const recommendedBubbleHeight = 130;
// 止まっている路線の札は、現在地からこの距離の線上に置く
// 近い順に試し、見える範囲に入り、現在地と吹き出しから離れた最初の点に置く
const blockedTagMeters = [900, 750, 650, 500, 380, 260, 180];
// 現在地や吹き出しの基準点から、これより近い候補は使わない（px）
const blockedTagClearance = 70;
// 到達範囲の札を置く向き。PC 幅は北西、狭い画面は出典や吹き出しと重なりにくい東
const reachLabelBearing = { wide: 315, narrow: 75 };

// 推奨経路の色。推奨の選択肢が待つなら青、それ以外は琥珀
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

const emptyCollection = { type: "FeatureCollection" as const, features: [] };

function addDataLayers(map: MapLibreMap, geo: MapGeoData, palette: MapPalette, tone: Action) {
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
    sourceIds.guideWalk,
    sourceIds.guideWalkLabels,
    sourceIds.guideStations,
    sourceIds.reachLabels,
  ]) {
    map.addSource(id, { type: "geojson", data: emptyCollection });
  }
  for (const layer of buildDataLayers(palette, tone)) map.addLayer(layer);
}

function setSourceData(map: MapLibreMap, id: string, data: unknown): void {
  map.getSource<GeoJSONSource>(id)?.setData(data as Parameters<GeoJSONSource["setData"]>[0]);
}

function applyMapScene(map: MapLibreMap, scene: MapScene): void {
  setSourceData(map, sourceIds.reach, scene.reach);
  setSourceData(map, sourceIds.blocked, scene.blocked);
  setSourceData(map, sourceIds.route, scene.route);
  setSourceData(map, sourceIds.routeLabel, scene.routeLabel);
  setSourceData(map, sourceIds.alternatives, scene.alternatives);
  setSourceData(map, sourceIds.keyStations, scene.keyStations);
}

// 狭い画面では道が短く札が重なるので、徒歩の札は出さない。分数は吹き出しと札が示す
function applyGuide(
  map: MapLibreMap,
  guide: StationGuide | null,
  reachLabels: unknown,
  narrow: boolean,
): void {
  const labels = guide?.walkLabels ?? emptyCollection;
  setSourceData(map, sourceIds.guideWalk, guide?.walkPaths ?? emptyCollection);
  setSourceData(map, sourceIds.guideWalkLabels, narrow ? emptyCollection : labels);
  setSourceData(map, sourceIds.guideStations, {
    type: "FeatureCollection",
    features: (guide?.stations ?? []).map((s) => ({
      type: "Feature",
      geometry: { type: "Point", coordinates: s.position },
      properties: {
        recommended: s.recommended,
        color: s.lines.find((l) => !l.suspended)?.color ?? s.lines[0]?.color ?? "#888888",
      },
    })),
  });
  setSourceData(map, sourceIds.reachLabels, reachLabels);
}

function applyMapStyle(map: MapLibreMap, palette: MapPalette, tone: Action, mode: MapMode): void {
  type PaintArgs = Parameters<MapLibreMap["setPaintProperty"]>;
  for (const { layerId, key, value, kind } of listPaintValues(palette, tone, mode)) {
    if (!map.getLayer(layerId)) continue;
    type LayoutArgs = Parameters<MapLibreMap["setLayoutProperty"]>;
    if (kind === "layout")
      map.setLayoutProperty(layerId, key as LayoutArgs[1], value as LayoutArgs[2]);
    else map.setPaintProperty(layerId, key as PaintArgs[1], value as PaintArgs[2]);
  }
}

function buildPadding(insets: MapInsets, extra = { top: 0, right: 0, bottom: 0, left: 0 }) {
  return {
    top: insets.top + fitMargin.y + extra.top,
    right: insets.right + fitMargin.x + extra.right,
    bottom: insets.bottom + fitMargin.y + extra.bottom,
    left: insets.left + fitMargin.x + extra.left,
  };
}

// 現在地のまわりの余白。重なる部品の幅に、吹き出しと札のぶんだけを足す
function buildFocusPadding(insets: MapInsets, margin: MapInsets) {
  return {
    top: insets.top + margin.top,
    right: insets.right + margin.right,
    bottom: insets.bottom + margin.bottom,
    left: insets.left + margin.left,
  };
}

// 現在地のまわりに寄せるときの余白。おすすめの吹き出しを駅の上に出すなら、その高さのぶん上を空ける
function buildGuidePadding(insets: MapInsets, narrow: boolean, guide: StationGuide) {
  const margins = guide.areaId.startsWith("auto:") ? autoFocusMargin : focusMargin;
  const margin = narrow ? margins.narrow : margins.wide;
  const tallTop = guide.stations.some(
    (s) => s.recommended && s.placement[narrow ? "narrow" : "wide"] === "top",
  );
  return buildFocusPadding(insets, {
    ...margin,
    top: margin.top + (tallTop ? recommendedBubbleHeight : 0),
  });
}

// 吹き出しと現在地の札のおおよその大きさ（px）。重なりを避ける配置に使う
function estimateBubbleSize(
  station: StationGuide["stations"][number],
  narrow: boolean,
): { w: number; h: number } {
  if (station.recommended) return { w: narrow ? 196 : 220, h: 150 };
  if (!narrow) return { w: 200, h: 64 };
  return { w: 12 * [...station.shortName].length + 70, h: 34 };
}

function estimateHereSize(guide: StationGuide, narrow: boolean): { w: number; h: number } {
  const nameWidth = 14 * [...guide.here.name].length;
  if (narrow) return { w: nameWidth + 70, h: 34 };
  return { w: Math.max(nameWidth + 60, 170), h: 36 + 28 * Math.min(3, guide.here.lines.length) };
}

// 自動で選んだ駅の吹き出しを、寄せたあとの画面の上で重ならない向きに置く
// 寄せる範囲の中心が、余白を除いた画面の中心に来るとみなして画面の位置を求める
function layoutAutoPlacements(
  map: MapLibreMap,
  guide: StationGuide,
  insets: MapInsets,
  narrow: boolean,
  herePreferred: BubblePlacement,
  // 札で隠したくない点。到達範囲の札の位置
  avoid: readonly Position[],
): Record<string, BubblePlacement> | null {
  if (!guide.bounds) return null;
  const padding = buildGuidePadding(insets, narrow, guide);
  const camera = map.cameraForBounds(guide.bounds, { padding, maxZoom: 16.2 });
  const zoom = camera?.zoom;
  if (zoom === undefined) return null;
  const canvas = map.getCanvas();
  const width = canvas.clientWidth;
  const height = canvas.clientHeight;
  const [[west, south], [east, north]] = guide.bounds;
  const nw = projectToWorld([west, north], zoom);
  const se = projectToWorld([east, south], zoom);
  const center = { x: (nw.x + se.x) / 2, y: (nw.y + se.y) / 2 };
  const screenCenter = {
    x: padding.left + (width - padding.left - padding.right) / 2,
    y: padding.top + (height - padding.top - padding.bottom) / 2,
  };
  const toScreen = (p: Position) => {
    const w = projectToWorld(p, zoom);
    return { x: screenCenter.x + w.x - center.x, y: screenCenter.y + w.y - center.y };
  };
  const here = toScreen(guide.here.position);
  const items: LayoutItem[] = [
    { key: "here", point: here, size: estimateHereSize(guide, narrow), gap: 20 },
    ...guide.stations.map((s) => ({
      key: s.key,
      point: toScreen(s.position),
      size: estimateBubbleSize(s, narrow),
      gap: 12,
    })),
  ];
  const side = narrow ? "narrow" : "wide";
  return chooseBubblePlacements({
    items,
    here,
    view: {
      left: insets.left + 8,
      top: insets.top + 8,
      right: width - insets.right - 8,
      bottom: height - insets.bottom - 8,
    },
    preferred: Object.fromEntries([
      ["here", herePreferred],
      ...guide.stations.map((s) => [s.key, s.placement[side]]),
    ]),
    obstacles: avoid.map((p) => {
      const { x, y } = toScreen(p);
      return { left: x - 40, right: x + 40, top: y - 11, bottom: y + 11 };
    }),
  });
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

// 吹き出しの尾が駅を指すよう、置く側の反対を MapLibre の基準点にする
const markerAnchor: Record<BubblePlacement, "bottom" | "top" | "left" | "right"> = {
  top: "bottom",
  bottom: "top",
  left: "right",
  right: "left",
};
const markerOffset: Record<BubblePlacement, [number, number]> = {
  top: [0, -12],
  bottom: [0, 12],
  left: [-12, 0],
  right: [12, 0],
};

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

type HostKey = string;

// DOM で描く印（吹き出し・現在地・止まっている路線の札）。MapLibre の Marker に React の部品を差し込む
export function useMarkerHosts(
  map: MapLibreMap | null,
  markerClass: typeof Marker | null,
  entries: readonly {
    key: HostKey;
    position: Position;
    anchor: "bottom" | "top" | "left" | "right" | "center";
    offset: [number, number];
  }[],
): Map<HostKey, HTMLElement> {
  const markersRef = useRef(new Map<HostKey, Marker>());
  const [hosts, setHosts] = useState(new Map<HostKey, HTMLElement>());
  const signature = entries.map((e) => `${e.key}:${e.anchor}`).join("|");

  // 印の組み合わせが変わったときだけ作り直す
  // biome-ignore lint/correctness/useExhaustiveDependencies: 位置の更新は下の効果で行い、ここは組み合わせの変化だけを見る
  useEffect(() => {
    const markers = markersRef.current;
    if (!map || !markerClass) return;
    const next = new Map<HostKey, HTMLElement>();
    for (const entry of entries) {
      const element = document.createElement("div");
      const marker = new markerClass({ element, anchor: entry.anchor, offset: entry.offset })
        .setLngLat(entry.position)
        .addTo(map);
      markers.set(entry.key, marker);
      next.set(entry.key, element);
    }
    setHosts(next);
    return () => {
      for (const marker of markers.values()) marker.remove();
      markers.clear();
    };
  }, [map, markerClass, signature]);

  useEffect(() => {
    for (const entry of entries) {
      markersRef.current.get(entry.key)?.setLngLat(entry.position);
    }
  }, [entries]);

  return hosts;
}

// 地図を画面全体に敷く。大阪駅などでは現在地のまわりに寄せ、乗り換え候補の駅を吹き出しで出す
// 「全体を見る」で、止まっている区間・推奨経路・出発・行き先の全体に切り替える
export function MapPanel(props: MapPanelProps) {
  const t = useTranslations("map");
  const locale = useLocale();
  const labels = selectMapLabels(locale);
  const theme = useDocumentTheme();
  const palette = mapPalettes[theme];
  const narrow = useMediaQuery("(max-width: 639px)");
  const {
    origin,
    destination,
    options,
    recommendedOptionId,
    blockedSection,
    blockedLine,
    blockedDirection,
  } = props;
  const tone = selectRouteTone(options, recommendedOptionId);

  const containerRef = useRef<HTMLDivElement>(null);
  const paletteRef = useRef(palette);
  paletteRef.current = palette;
  const toneRef = useRef(tone);
  toneRef.current = tone;
  const originRef = useRef(origin);
  originRef.current = origin;
  const fittedRef = useRef<string | null>(null);
  const markersRef = useRef<{ origin: Marker | null; destination: Marker | null }>({
    origin: null,
    destination: null,
  });
  const [markerClass, setMarkerClass] = useState<typeof Marker | null>(null);

  const [geo, setGeo] = useState<MapGeoData | null>(null);
  const [map, setMap] = useState<MapLibreMap | null>(null);
  const [status, setStatus] = useState<MapStatus>("loading");
  const [viewChoice, setViewChoice] = useState<MapView>("focus");

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
        setMarkerClass(() => MarkerClass);
        // 入口から移ってきたときに地図が引いて見えないよう、出発の駅に寄せた視点で作る
        const start = resolvePlacePosition(geo.index, originRef.current);
        instance = new MapClass({
          container,
          style: buildBaseStyle(paletteRef.current),
          center: start ?? defaultCenter,
          zoom: start ? initialOriginZoom : 10,
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
              blockedDirection,
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
      blockedDirection,
      labels,
      locale,
    ],
  );

  // 手で整えた範囲が無い駅では、駅データと路線データから乗り換え候補を選ぶ
  const configuredArea = useMemo(() => findFocusArea(origin), [origin]);
  const sceneDestination = scene?.destination ?? null;
  const sceneBlockedKey = scene?.blockedLineIds.join("|") ?? null;
  const boardingKey = [...listBoardingStationIds(options)].sort().join("|");
  // 止まっている路線と乗る駅は key で比べ、判断のたびに作り直さない
  const area = useMemo(() => {
    if (configuredArea) return configuredArea;
    if (!geo || sceneBlockedKey === null) return null;
    return buildAutoFocusArea(geo, {
      origin,
      blockedLineIds: sceneBlockedKey ? sceneBlockedKey.split("|") : [],
      destination: sceneDestination,
      boardingIds: new Set(boardingKey ? boardingKey.split("|") : []),
    });
  }, [
    configuredArea,
    geo,
    origin,
    sceneBlockedKey,
    sceneDestination?.[0],
    sceneDestination?.[1],
    boardingKey,
  ]);
  const guide = useMemo(
    () =>
      geo && scene && area
        ? buildStationGuide(geo, area, {
            origin,
            options,
            recommendedOptionId,
            blockedLineIds: scene.blockedLineIds,
            blockedLineName: blockedLine ?? null,
            language: locale === "en" ? "en" : "ja",
            formatWalk: labels.walkLabel,
          })
        : null,
    [geo, scene, area, origin, options, recommendedOptionId, blockedLine, locale, labels],
  );
  const view: MapView = guide ? viewChoice : "overview";

  const { onReachSourceChange, onGuideChange, onSelectOption } = props;
  const reachSource = scene?.reachSource ?? null;
  useEffect(() => {
    onReachSourceChange?.(reachSource);
  }, [reachSource, onReachSourceChange]);
  useEffect(() => {
    onGuideChange?.(guide);
  }, [guide, onGuideChange]);

  // 推奨が乗り換えに変わったら、推奨の乗り換え駅が見えるよう現在地のまわりへ戻す
  const recommendedKind = options.find((o) => o.id === recommendedOptionId)?.kind ?? null;
  useEffect(() => {
    if (recommendedKind !== null && recommendedKind !== "wait") setViewChoice("focus");
  }, [recommendedKind]);

  const mode: MapMode = useMemo(
    () => ({
      view,
      relevantLineIds: guide?.relevantLineIds ?? [],
      blockedLineIds: scene?.blockedLineIds ?? [],
    }),
    [view, guide, scene],
  );

  const { top, right, bottom, left } = props.insets;
  const fitView = useCallback(
    (instant: boolean) => {
      if (!map) return;
      const duration = instant || prefersReducedMotion() ? 0 : fitDurationMs;
      const insets = { top, right, bottom, left };
      if (view === "focus" && guide?.bounds) {
        map.fitBounds(guide.bounds, {
          padding: buildGuidePadding(insets, narrow, guide),
          maxZoom: 16.2,
          duration,
        });
      } else if (scene?.bounds) {
        map.fitBounds(scene.bounds, { padding: buildPadding(insets), maxZoom: 14, duration });
      }
    },
    [map, view, guide, scene, top, right, bottom, left, narrow],
  );

  // 判断の状態が変わるたびにレイヤーを差し替え、見せ方に合わせて寄せる
  const reachLabels = useMemo(() => {
    if (!scene?.origin) return emptyCollection;
    const center = scene.origin;
    return {
      type: "FeatureCollection" as const,
      features: scene.reach.features.flatMap((f) => {
        const ring =
          f.geometry.type === "Polygon"
            ? f.geometry.coordinates[0]
            : f.geometry.coordinates[0]?.[0];
        const point = ring
          ? findRingLabelPoint(
              ring as Position[],
              center,
              narrow ? reachLabelBearing.narrow : reachLabelBearing.wide,
            )
          : null;
        return point
          ? [
              {
                type: "Feature" as const,
                geometry: { type: "Point" as const, coordinates: point },
                properties: { label: labels.walkLabel(f.properties.minutes) },
              },
            ]
          : [];
      }),
    };
  }, [scene, labels, narrow]);

  useEffect(() => {
    if (!map || !scene) return;
    applyMapScene(map, scene);
    applyGuide(map, guide, reachLabels, narrow);
    const bounds = view === "focus" ? guide?.bounds : scene.bounds;
    // おすすめの駅が変わると吹き出しの大きさが変わるので、寄せ直す
    const recommendedKey = guide?.stations.find((s) => s.recommended)?.key ?? "";
    const fitKey = JSON.stringify([view, bounds, recommendedKey, top, right, bottom, left, narrow]);
    if (bounds && fitKey !== fittedRef.current) {
      fitView(fittedRef.current === null);
      fittedRef.current = fitKey;
    }
    setStatus((s) => (s === "ready" ? "updating" : s));
    map.once("idle", () => setStatus("ready"));
    map.triggerRepaint();
  }, [map, scene, guide, reachLabels, view, fitView, top, right, bottom, left, narrow]);

  // 全体を見るときの出発と行き先のピン
  useEffect(() => {
    if (!map || !scene || !markerClass) return;
    const entries: ["origin" | "destination", Position | null][] = [
      ["origin", view === "overview" ? scene.origin : null],
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
        markersRef.current[role] = new markerClass({
          element: createPlaceElement(role),
          anchor: role === "origin" ? "center" : "bottom",
        })
          .setLngLat(position)
          .addTo(map);
      }
    }
  }, [map, scene, markerClass, view]);

  useEffect(() => {
    if (map) applyMapStyle(map, palette, tone, mode);
  }, [map, palette, tone, mode]);

  // 止まっている路線の札。現在地のまわりでは現在地の近くの線上、全体では区間の中ほど
  const blockedPath = scene?.blocked.features[0]?.geometry.coordinates ?? null;
  const [blockedTagPosition, setBlockedTagPosition] = useState<Position | null>(null);
  useEffect(() => {
    if (!map || !blockedPath || blockedPath.length < 2) {
      setBlockedTagPosition(null);
      return;
    }
    if (view !== "focus" || !guide) {
      setBlockedTagPosition(blockedPath[Math.floor(blockedPath.length / 2)] ?? null);
      return;
    }
    const here = guide.here.position;
    // 地図が止まるたびに、見える範囲に入る点を選び直す
    const place = () => {
      const anchors = [here, ...guide.stations.map((s) => s.position)].map((p) => map.project(p));
      const canvas = map.getCanvas();
      const width = canvas.clientWidth;
      const height = canvas.clientHeight;
      const visible = (x: number, y: number) =>
        x > left + 40 && x < width - right - 40 && y > top + 24 && y < height - bottom - 24;
      const points = blockedTagMeters.flatMap((m) => {
        const p = findPointAtDistance(blockedPath, here, m);
        return p ? [p] : [];
      });
      // 吹き出しと現在地の札の矩形。札の幅と高さの半分だけ広げて、重なる点を外す
      const origin = canvas.getBoundingClientRect();
      const boxes = [
        ...map
          .getContainer()
          .querySelectorAll<HTMLElement>(
            `[data-testid^="judgment-map-station-"], [data-testid="${mapTestIds.here}"] > div`,
          ),
      ].map((el) => {
        const r = el.getBoundingClientRect();
        return {
          left: r.left - origin.left - 44,
          right: r.right - origin.left + 44,
          top: r.top - origin.top - 14,
          bottom: r.bottom - origin.top + 14,
        };
      });
      const chosen = points.find((p) => {
        const { x, y } = map.project(p);
        return (
          visible(x, y) &&
          anchors.every((a) => Math.hypot(a.x - x, a.y - y) > blockedTagClearance) &&
          boxes.every((b) => x < b.left || x > b.right || y < b.top || y > b.bottom)
        );
      });
      // 置ける点が無ければ札は出さない。止まっていることは現在地の札と上部の帯が示す
      setBlockedTagPosition(chosen ?? null);
    };
    place();
    map.on("moveend", place);
    return () => {
      map.off("moveend", place);
    };
  }, [map, blockedPath, view, guide, top, right, bottom, left]);

  // 自動で選んだ駅は、寄せたあとの画面で重ならない向きに吹き出しを置く。手で整えた駅は設定に従う
  const autoPlacements = useMemo(
    () =>
      map && guide && area?.auto
        ? layoutAutoPlacements(
            map,
            guide,
            { top, right, bottom, left },
            narrow,
            area.herePlacement[narrow ? "narrow" : "wide"],
            reachLabels.features.map((f) => f.geometry.coordinates),
          )
        : null,
    [map, guide, area, narrow, top, right, bottom, left, reachLabels],
  );
  const placeStation = useCallback(
    (s: StationGuide["stations"][number]): BubblePlacement =>
      autoPlacements?.[s.key] ?? s.placement[narrow ? "narrow" : "wide"],
    [autoPlacements, narrow],
  );

  const focusEntries = useMemo(() => {
    if (view !== "focus" || !guide) return [];
    return [
      {
        key: "here",
        position: guide.here.position,
        anchor: "center" as const,
        offset: [0, 0] as [number, number],
      },
      ...guide.stations.map((s) => ({
        key: `station:${s.key}`,
        position: s.position,
        anchor: markerAnchor[placeStation(s)],
        offset: markerOffset[placeStation(s)],
      })),
    ];
  }, [view, guide, placeStation]);
  const tagEntries = useMemo(
    () =>
      blockedTagPosition
        ? [
            {
              key: "blocked",
              position: blockedTagPosition,
              anchor: "center" as const,
              offset: [0, 0] as [number, number],
            },
          ]
        : [],
    [blockedTagPosition],
  );
  const entries = useMemo(() => [...tagEntries, ...focusEntries], [tagEntries, focusEntries]);
  const hosts = useMarkerHosts(map, markerClass, entries);
  const herePlacement =
    autoPlacements?.here ?? (area ? area.herePlacement[narrow ? "narrow" : "wide"] : "left");

  const toggleLabel = view === "focus" ? t("viewOverview") : t("viewFocus");

  return (
    <section
      data-testid={testIds.judgment.map}
      data-state={status}
      data-view={view}
      data-focus-area={guide?.areaId ?? ""}
      data-recommended-option={recommendedOptionId ?? ""}
      data-route-tone={tone}
      data-blocked={scene ? scene.blocked.features.length > 0 : false}
      data-reach-source={scene?.reachSource ?? ""}
      aria-label={t("title")}
      className="fixed inset-0 z-0 bg-background"
    >
      <div ref={containerRef} data-testid={mapTestIds.canvas} className="h-full w-full" />
      {/* 読み込み中は文字を出さず、入口から引き継いだ駅のまわりの地図を見せたままにする */}
      {status === "loading" && (
        <p role="status" className="sr-only">
          {labels.loading}
        </p>
      )}
      {status === "error" && (
        <p
          role="status"
          className="pointer-events-none absolute inset-0 flex items-center justify-center text-[13px] text-muted"
        >
          {labels.error}
        </p>
      )}

      {[...hosts.entries()].map(([key, element]) => {
        if (key === "blocked") return createPortal(<BlockedTag />, element, key);
        if (key === "here" && guide) {
          return createPortal(
            <HereMarker here={guide.here} placement={herePlacement} compact={narrow} />,
            element,
            key,
          );
        }
        const station = guide?.stations.find((s) => `station:${s.key}` === key);
        if (!station) return null;
        const optionId = station.optionId;
        return createPortal(
          <StationBubble
            station={station}
            placement={placeStation(station)}
            variant={station.recommended ? "full" : narrow ? "compact" : "medium"}
            onSelect={optionId && onSelectOption ? () => onSelectOption(optionId) : null}
          />,
          element,
          key,
        );
      })}

      {guide ? (
        <button
          type="button"
          data-testid={mapTestIds.viewToggle}
          data-view={view}
          aria-pressed={view === "overview"}
          onClick={() => {
            fittedRef.current = null;
            setViewChoice(view === "focus" ? "overview" : "focus");
          }}
          style={{ bottom: bottom + 40, right: right + 12 }}
          className="glass absolute z-10 flex h-11 items-center gap-1.5 rounded-full px-4 text-[13px] font-semibold text-foreground transition-[bottom] duration-200"
        >
          {view === "focus" ? (
            <Route className="size-4" strokeWidth={1.75} aria-hidden />
          ) : (
            <LocateFixed className="size-4" strokeWidth={1.75} aria-hidden />
          )}
          {toggleLabel}
        </button>
      ) : (
        <button
          type="button"
          onClick={() => fitView(false)}
          aria-label={labels.recenter}
          title={labels.recenter}
          disabled={!scene?.bounds}
          style={{ bottom: bottom + 40, right: right + 12 }}
          className="glass absolute z-10 flex size-11 items-center justify-center rounded-full text-foreground transition-[bottom] duration-200 disabled:opacity-0"
        >
          <LocateFixed className="size-5" strokeWidth={1.75} aria-hidden />
        </button>
      )}
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
