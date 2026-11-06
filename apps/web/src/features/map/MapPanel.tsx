"use client";

import "maplibre-gl/dist/maplibre-gl.css";
import { formatStationName } from "@repo/geo";
import type { Action, Place, RouteOption, Section, TrainPosition } from "@repo/schema";
import { LocateFixed, Route } from "lucide-react";
import type { GeoJSONSource, Map as MapLibreMap, Marker } from "maplibre-gl";
import { useLocale, useTranslations } from "next-intl";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { selectOptionTone } from "@/features/judgment/action-style";
import { testIds } from "@/features/judgment/testids";
import { prefersReducedMotion, useDocumentTheme } from "@/lib/use-document-theme";
import { useMediaQuery } from "@/lib/use-media-query";
import { buildAutoFocusArea } from "./auto-focus";
import {
  type BoxSize,
  chooseStationLabelLayout,
  constrainFitPadding,
  type LabelLayout,
  type LayoutInput,
  overlapArea,
  projectToWorld,
  type Rect,
} from "./bubble-layout";
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
import { MapAttribution } from "./MapAttribution";
import { fetchReachAreas, type ReachArea } from "./reach";
import {
  buildReachLabelRect,
  chooseReachLabelCandidate,
  estimateReachLabelSize,
  fitsInView,
} from "./reach-label";
import { waitForOwnLayersDrawn } from "./ready";
import { AlightMarker, BlockedTag, HereMarker, StationBubble } from "./StationBubble";
import {
  type BlockedDirection,
  buildMapScene,
  buildStationLabels,
  type MapScene,
  type Position,
  type ReachSource,
  resolvePlacePosition,
  resolveStationByName,
} from "./scene";
import {
  buildStationGuide,
  findFocusArea,
  findPointAtDistance,
  findRingLabelPoint,
  listBoardingStationIds,
  listDockedStationRows,
  listRequiredLabelKeys,
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
  // 選択肢の一覧で押した選択肢。地図はこの経路と乗る駅を描く。省略時は推奨
  selectedOptionId?: string | null;
  // 止まっている区間。観測から分かったもの
  blockedSection: Section | null;
  // 止まっている路線の名前（観測の line）。無ければ「待つ」経路の路線から推し量る
  blockedLine?: string | null;
  // 入口で選んだ路線と方面。観測に区間が無いとき、その方面を止まっている区間として描く
  blockedDirection?: BlockedDirection | null;
  // 車内の位置。駅と駅の間なら、現在地の印を駅間の線路の上に置き、次の駅を降りる駅として目立たせる
  trainPosition?: TrainPosition | null;
  // その列車だけが止まる事象。止まった区間の線と「運転見合わせ」の札を描かない
  trainOnly?: boolean;
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
// 現在地のまわりに寄せる上限。自動で選んだ駅は近い駅だけのこともあるので、まわりの街が見える程度に抑える
const focusMaxZoom = { configured: 16.2, auto: 15.5 };
// 最初に出発の駅へ寄せておく拡大率。入口が判断へ移る直前に寄せる値とそろえる
const initialOriginZoom = 15.8;
// おすすめの吹き出しの高さのおよそ（px）
const recommendedBubbleHeight = 130;
const labelMeasurementPadding = 2;
// 現在地と降りる駅の札を、辺の方向へずらせる量の候補（px）。四方に置いても駅の印や札に重なるとき、ずらして避ける
const labelSlides = [
  -64, -56, -48, -40, -32, -24, -16, -8, 0, 8, 16, 24, 32, 40, 48, 56, 64,
] as const;
// 「全体を見る」のボタンの置き場所とおおよその大きさ（px）。札がボタンの下に入らないよう、置き場所の計算で避ける
const viewToggleBox = { right: 12, bottom: 40, w: 140, h: 44, margin: 6 } as const;
// 「表示中」の札の高さと上下の余白。駅の吹き出しで選んだ経路を示せないときだけ地図の上端に出す
const selectedRouteTagSpace = 44;

// 「全体を見る」のボタンが動き終えたあとの矩形。地図の左上が原点
// 下の余白が変わるとボタンは 200ms かけて動く。動いている途中の矩形は測らず、余白から求める
function computeSettledToggleRect(
  canvas: { clientWidth: number; clientHeight: number },
  insets: { right: number; bottom: number },
  button: { offsetWidth: number; offsetHeight: number },
): Rect | null {
  if (button.offsetWidth === 0 || button.offsetHeight === 0) return null;
  const right = canvas.clientWidth - insets.right - viewToggleBox.right;
  const bottom = canvas.clientHeight - insets.bottom - viewToggleBox.bottom;
  return { left: right - button.offsetWidth, right, top: bottom - button.offsetHeight, bottom };
}

// 止まっている路線の札は、現在地からこの距離の線上に置く
// 近い順に試し、見える範囲に入り、現在地と吹き出しから離れた最初の点に置く
const blockedTagMeters = [900, 750, 650, 500, 380, 260, 180];
// 現在地や吹き出しの基準点から、これより近い候補は使わない（px）
const blockedTagClearance = 70;
// 札の中心が、吹き出しやボタンの矩形からこれだけ離れるようにする（px）。札の幅と高さの半分に余白を足した値
const blockedTagMargin = { x: 48, y: 22 } as const;
// 到達範囲の札を置く向きの候補。先頭が既定で、PC 幅は北西、狭い画面は出典や吹き出しと重なりにくい東
// 既定の向きで吹き出しや線に重なれば、寄せたあとの画面で次の向きを試す
const reachLabelBearings = {
  wide: [315, 285, 345, 225, 45, 255, 135, 195, 165, 105, 75, 15],
  narrow: [75, 105, 45, 135, 15, 165, 255, 285, 225, 315, 195, 345],
};

// 到達範囲の札の点の列から、地図に渡す形を組み立てる
function buildReachLabelCollection(items: readonly { label: string; point: Position }[]) {
  return {
    type: "FeatureCollection" as const,
    features: items.map((item) => ({
      type: "Feature" as const,
      geometry: { type: "Point" as const, coordinates: item.point },
      properties: { label: item.label },
    })),
  };
}

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

// 現在地のまわりに寄せるときの余白。おすすめの吹き出しを駅の上に出すなら、その高さのぶん上を空ける
function buildGuidePadding(
  map: MapLibreMap,
  insets: MapInsets,
  narrow: boolean,
  guide: StationGuide,
) {
  const margins = guide.areaId.startsWith("auto:") ? autoFocusMargin : focusMargin;
  const margin = narrow ? margins.narrow : margins.wide;
  const tallTop = guide.stations.some(
    (s) => s.recommended && s.placement[narrow ? "narrow" : "wide"] === "top",
  );
  const canvas = map.getCanvas();
  return constrainFitPadding({ w: canvas.clientWidth, h: canvas.clientHeight }, insets, {
    ...margin,
    top: margin.top + (tallTop ? recommendedBubbleHeight : 0),
  });
}

// 文字列のおおよその幅（px）。全角は 1em、半角は 0.58em で数える
function estimateTextWidth(text: string, fontPx: number): number {
  return [...text].reduce(
    (sum, ch) => sum + ((ch.codePointAt(0) ?? 0) > 0x7f ? fontPx : fontPx * 0.58),
    0,
  );
}

// 吹き出しと現在地の札のおおよその大きさ（px）。重なりを避ける配置に使う
// compactRecommended なら、おすすめも小さな札で見積もる
function estimateBubbleSize(
  station: StationGuide["stations"][number],
  narrow: boolean,
  compactRecommended = false,
): { w: number; h: number } {
  if (station.recommended && !compactRecommended) return { w: narrow ? 196 : 220, h: 150 };
  if (!narrow) return { w: 200, h: 64 };
  // 路線色の印と分数のぶんを足す。おすすめの小さな札は、星の分だけ広い
  return {
    w: estimateTextWidth(station.shortName, 12) + 100 + (station.starred ? 16 : 0),
    // 上下の配置では 44px のタップ領域を基準にアンカーが付く。
    h: 44,
  };
}

// 現在地の札は、いまの文字と駅間の名前を 1 行に並べ、最大幅を超えると折り返して高くなる
// 最大幅は HereMarker の max-w と同じにする
const hereLabelMaxWidth = { narrow: 176, wide: 220 } as const;
function estimateHereSize(guide: StationGuide, narrow: boolean): { w: number; h: number } {
  const maxWidth = narrow ? hereLabelMaxWidth.narrow : hereLabelMaxWidth.wide;
  // 狭い画面では路線を色の印だけにして、名前の横に並べる
  const badges = narrow ? Math.min(3, guide.here.lines.length) * 26 : 0;
  const inner = 32 + estimateTextWidth(guide.here.name, 13) + badges;
  const lines = Math.max(1, Math.ceil(inner / (maxWidth - 20)));
  const w = Math.min(maxWidth, inner + 20);
  if (narrow) return { w: w + 2, h: 18 + 16 * lines };
  return { w: Math.max(w, 170), h: 16 + 16 * lines + 28 * Math.min(3, guide.here.lines.length) };
}

// 降りる駅の札は「降りる駅」と駅名を 1 行に並べる。印から 8px 離す
function estimateAlightSize(
  alight: NonNullable<StationGuide["alight"]>,
  english: boolean,
): { w: number; h: number } {
  const word = english ? estimateTextWidth("Get off at", 12) : 4 * 12;
  return { w: word + 4 + estimateTextWidth(alight.name, 12) + 16, h: 22 };
}

// 吹き出しと、現在地と降りる駅の札を、寄せたあとの画面の上で重ならない向きに置く
// 寄せる範囲の中心が、余白を除いた画面の中心に来るとみなして画面の位置を求める
// おすすめの大きな札では駅の印や札が重なってしまうときは、おすすめも小さな札にして置き直す
type AutoLayout = LabelLayout & { compactRecommended: boolean };

function layoutAutoPlacements(
  map: MapLibreMap,
  guide: StationGuide,
  insets: MapInsets,
  narrow: boolean,
  herePreferred: BubblePlacement,
  // 札で隠したくない点。到達範囲の札の位置
  avoid: readonly Position[],
  english: boolean,
  measuredSizes: Readonly<Record<string, BoxSize>>,
): AutoLayout | null {
  if (!guide.bounds) return null;
  const canvas = map.getCanvas();
  const padding = buildGuidePadding(map, insets, narrow, guide);
  const camera = map.cameraForBounds(guide.bounds, {
    padding,
    maxZoom: guide.areaId.startsWith("auto:") ? focusMaxZoom.auto : focusMaxZoom.configured,
  });
  const zoom = camera?.zoom;
  if (zoom === undefined) return null;
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
  const side = narrow ? "narrow" : "wide";
  const stationPlacements = Object.fromEntries(
    guide.stations.map((s) => [s.key, s.placement[side]]),
  );
  const toggle = {
    left: width - insets.right - viewToggleBox.right - viewToggleBox.w - viewToggleBox.margin,
    right: width - insets.right - viewToggleBox.right + viewToggleBox.margin,
    top: height - insets.bottom - viewToggleBox.bottom - viewToggleBox.h - viewToggleBox.margin,
    bottom: height - insets.bottom - viewToggleBox.bottom + viewToggleBox.margin,
  };
  const measureSize = (key: string, estimate: BoxSize): BoxSize => ({
    w: Math.max(estimate.w, measuredSizes[key]?.w ?? 0),
    h: Math.max(estimate.h, measuredSizes[key]?.h ?? 0),
  });
  const buildInput = (compactRecommended: boolean): LayoutInput => ({
    items: [
      {
        key: "here",
        point: here,
        size: measureSize(`here:${narrow}`, estimateHereSize(guide, narrow)),
        gap: 20,
        slides: labelSlides,
      },
      ...(guide.alight
        ? [
            {
              key: "alight",
              point: toScreen(guide.alight.position),
              size: measureSize("alight", estimateAlightSize(guide.alight, english)),
              gap: 16,
              slides: labelSlides,
              // 印の外の輪（6px）まで札が重ならないようにする
              dotRadius: 15,
            },
          ]
        : []),
      ...guide.stations.map((s) => ({
        key: s.key,
        point: toScreen(s.position),
        size: measureSize(
          `${s.key}:${s.recommended && !compactRecommended ? "full" : narrow ? "compact" : "medium"}`,
          estimateBubbleSize(s, narrow, compactRecommended),
        ),
        gap: 12,
      })),
    ],
    here,
    view: {
      left: insets.left + 8,
      top: insets.top + 8,
      right: width - insets.right - 8,
      bottom: height - insets.bottom - 8,
    },
    preferred: { here: herePreferred, alight: "bottom", ...stationPlacements },
    obstacles: avoid.map((p) => {
      const { x, y } = toScreen(p);
      return { left: x - 40, right: x + 40, top: y - 11, bottom: y + 11 };
    }),
    blockers: [toggle],
  });
  return chooseStationLabelLayout(
    buildInput(false),
    buildInput(true),
    listRequiredLabelKeys(guide.stations),
  );
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
      markersRef.current.get(entry.key)?.setOffset(entry.offset).setLngLat(entry.position);
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
    trainPosition,
    trainOnly = false,
  } = props;
  // 駅間の車内の人は降りられないので、乗り換え候補の駅と徒歩の範囲を出さない
  const inCar = trainPosition?.kind === "between_stations";
  // 地図に描く選択肢。一覧で押したものがあればそれ、無ければ推奨
  const focusOptionId = props.selectedOptionId ?? recommendedOptionId;
  const tone = selectRouteTone(options, focusOptionId);

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
        // 下地のタイルを待たず、スタイルが読めたら自前のレイヤーを足す
        loaded.once("style.load", () => {
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
              selectedOptionId: focusOptionId,
              blockedSection,
              blockedLine,
              blockedDirection,
              reachAreas,
              trainOnly,
              hideReach: inCar,
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
      focusOptionId,
      blockedSection,
      blockedLine,
      blockedDirection,
      trainOnly,
      inCar,
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
  // 駅間の車内なら、現在地の印を来た側の駅と次の駅のあいだに置き、「大阪〜塚本の間」と呼ぶ
  const between = useMemo(() => {
    if (trainPosition?.kind !== "between_stations" || !geo) return null;
    const { previousStation, nextStation } = trainPosition;
    if (!previousStation || !nextStation) return null;
    const nameOf = (name: string) => {
      if (locale !== "en") return name;
      const node = resolveStationByName(geo.index, name);
      return node ? formatStationName(node, "en") : name;
    };
    return {
      previousStation,
      nextStation,
      label: t("between", { from: nameOf(previousStation), to: nameOf(nextStation) }),
    };
  }, [trainPosition, geo, locale, t]);
  const guide = useMemo(
    () =>
      geo && scene && area
        ? buildStationGuide(geo, area, {
            origin,
            options,
            recommendedOptionId: focusOptionId,
            starOptionId: recommendedOptionId,
            blockedLineIds: scene.blockedLineIds,
            trackLineIds: scene.trackLineIds,
            hideStations: inCar,
            blockedLineName: blockedLine ?? null,
            language: locale === "en" ? "en" : "ja",
            formatWalk: labels.walkLabel,
            between,
            blockedPath: scene.trackPath,
          })
        : null,
    [
      geo,
      scene,
      area,
      origin,
      options,
      focusOptionId,
      recommendedOptionId,
      blockedLine,
      locale,
      labels,
      between,
      inCar,
    ],
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

  // 描く選択肢が乗り換えに変わったら、その乗り換え駅が見えるよう現在地のまわりへ戻す
  const focusKind = options.find((o) => o.id === focusOptionId)?.kind ?? null;
  const focusKey = focusKind === null || focusKind === "wait" ? null : focusOptionId;
  useEffect(() => {
    if (focusKey !== null) setViewChoice("focus");
  }, [focusKey]);

  const mode: MapMode = useMemo(
    () => ({
      view,
      // 全体を見る表示では、乗り換えで乗る路線も残し、ほかを細く淡くする
      relevantLineIds:
        view === "overview"
          ? [...new Set([...(guide?.relevantLineIds ?? []), ...(scene?.transferLineIds ?? [])])]
          : (guide?.relevantLineIds ?? []),
      blockedLineIds: scene?.blockedLineIds ?? [],
    }),
    [view, guide, scene],
  );

  // 一覧で選んだ経路。乗る駅の吹き出しがあれば吹き出しに「表示中」を添える
  // 吹き出しが無ければ地図の上端に札を出し、その分だけ地図の余白を広げる
  const chosenOption = props.selectedOptionId
    ? options.find((o) => o.id === props.selectedOptionId)
    : undefined;
  const shownStationKey =
    chosenOption && view === "focus"
      ? (guide?.stations.find((s) => s.recommended)?.key ?? null)
      : null;
  const floatingTag = chosenOption !== undefined && shownStationKey === null;
  const { right, bottom, left } = props.insets;
  const top = props.insets.top + (floatingTag ? selectedRouteTagSpace : 0);
  const [measuredSizes, setMeasuredSizes] = useState<Record<string, BoxSize>>({});
  // 「全体を見る」のボタン。止まっている路線の札と到達範囲の札は、このボタンを避けて置く
  const viewToggleRef = useRef<HTMLButtonElement>(null);
  const fitView = useCallback(
    (instant: boolean) => {
      if (!map) return;
      const duration = instant || prefersReducedMotion() ? 0 : fitDurationMs;
      const insets = { top, right, bottom, left };
      if (view === "focus" && guide?.bounds) {
        map.fitBounds(guide.bounds, {
          padding: buildGuidePadding(map, insets, narrow, guide),
          maxZoom: guide.areaId.startsWith("auto:") ? focusMaxZoom.auto : focusMaxZoom.configured,
          duration,
        });
      } else if (scene?.bounds) {
        map.fitBounds(scene.bounds, { padding: buildPadding(insets), maxZoom: 14, duration });
      }
    },
    [map, view, guide, scene, top, right, bottom, left, narrow],
  );

  // 判断の状態が変わるたびにレイヤーを差し替え、見せ方に合わせて寄せる
  // 到達範囲の札の候補の点。向きの候補の順に並べ、先頭を既定の置き場所にする
  const reachLabelCandidates = useMemo(() => {
    if (!scene?.origin) return [];
    const center = scene.origin;
    const bearings = narrow ? reachLabelBearings.narrow : reachLabelBearings.wide;
    return scene.reach.features.flatMap((f) => {
      const ring =
        f.geometry.type === "Polygon" ? f.geometry.coordinates[0] : f.geometry.coordinates[0]?.[0];
      if (!ring) return [];
      const points = bearings.flatMap((bearing) => {
        const point = findRingLabelPoint(ring as Position[], center, bearing);
        return point ? [point] : [];
      });
      return points.length > 0 ? [{ label: labels.walkLabel(f.properties.minutes), points }] : [];
    });
  }, [scene, labels, narrow]);
  // 既定の置き場所の札。吹き出しの配置の計算と、置き直すまでの表示に使う
  const reachLabels = useMemo(
    () =>
      buildReachLabelCollection(
        reachLabelCandidates.map((c) => ({ label: c.label, point: c.points[0] as Position })),
      ),
    [reachLabelCandidates],
  );

  useEffect(() => {
    if (!map || !scene) return;
    applyMapScene(map, scene);
    applyGuide(map, guide, reachLabels, narrow);
    const bounds = view === "focus" ? guide?.bounds : scene.bounds;
    // おすすめの駅が変わると吹き出しの大きさが変わるので、寄せ直す
    const recommendedKey = guide?.stations.find((s) => s.recommended)?.key ?? "";
    const fitKey = JSON.stringify([view, bounds, recommendedKey, top, right, bottom, left, narrow]);
    let moving = false;
    if (bounds && fitKey !== fittedRef.current) {
      fitView(fittedRef.current === null);
      fittedRef.current = fitKey;
      moving = map.isMoving();
    }
    setStatus((s) => (s === "ready" ? "updating" : s));
    // 寄せる動きの最中は準備中のままにし、止まってから描き終わりを待つ。札やボタンが動く間に準備ができたと見せないため
    let stopWaiting = () => {};
    const startWaiting = () => {
      stopWaiting = waitForOwnLayersDrawn(map, () => setStatus("ready"));
      map.triggerRepaint();
    };
    if (moving) map.once("moveend", startWaiting);
    else startWaiting();
    return () => {
      map.off("moveend", startWaiting);
      stopWaiting();
    };
  }, [map, scene, guide, reachLabels, view, fitView, top, right, bottom, left, narrow]);

  // 到達範囲の札を、寄せたあとの画面で吹き出しや線と重ならない向きに置き直す。地図が止まるたびに選び直す
  useEffect(() => {
    if (!map || !scene || reachLabelCandidates.length === 0) return;
    let lastLabels = "";
    const place = () => {
      const canvas = map.getCanvas();
      const origin = canvas.getBoundingClientRect();
      const toggle = viewToggleRef.current;
      const settledToggle = toggle
        ? computeSettledToggleRect(canvas, { right, bottom }, toggle)
        : null;
      const boxes: Rect[] = [
        ...map
          .getContainer()
          .querySelectorAll<HTMLElement>(
            `[data-testid^="judgment-map-station-"], [data-testid="${mapTestIds.here}"] > div, [data-testid="${mapTestIds.alight}"] > p, [data-testid="${mapTestIds.blockedTag}"], [data-testid="${mapTestIds.selectedRoute}"]`,
          ),
      ].flatMap((el) => {
        const r = el.getBoundingClientRect();
        if (r.width === 0 || r.height === 0) return [];
        return [
          {
            left: r.left - origin.left,
            right: r.right - origin.left,
            top: r.top - origin.top,
            bottom: r.bottom - origin.top,
          },
        ];
      });
      if (settledToggle) boxes.push(settledToggle);
      const toScreen = (p: Position) => {
        const { x, y } = map.project(p);
        return { x, y };
      };
      // 避ける線は、経路と徒歩の道と、路線色で太く描く路線
      const drawnLineIds = new Set([...mode.relevantLineIds, ...mode.blockedLineIds]);
      const railLines = (geo?.lines.features ?? [])
        .filter((f) => drawnLineIds.has(f.properties.lineId))
        .flatMap((f) =>
          f.geometry.type === "LineString" ? [f.geometry.coordinates] : f.geometry.coordinates,
        );
      const polylines = [
        ...[
          ...scene.route.features,
          ...scene.alternatives.features,
          ...scene.blocked.features,
          ...(guide?.walkPaths.features ?? []),
        ].map((f) => f.geometry.coordinates),
        ...railLines,
      ].map((coordinates) => coordinates.map(toScreen));
      const viewRect = {
        left: left + 8,
        top: top + 8,
        right: canvas.clientWidth - right - 8,
        bottom: canvas.clientHeight - bottom - 8,
      };
      const chosen: { label: string; point: Position }[] = [];
      for (const candidate of reachLabelCandidates) {
        const size = estimateReachLabelSize(candidate.label);
        const pick = chooseReachLabelCandidate(
          candidate.points
            .map((p) => ({ key: p, point: toScreen(p) }))
            .filter((candidate) =>
              boxes.every(
                (box) => overlapArea(buildReachLabelRect(candidate.point, size), box) === 0,
              ),
            ),
          { size, view: viewRect, boxes, polylines },
        );
        // 見える範囲に収まる向きが無ければ、欠けた札を出すより出さない。範囲の意味は凡例が示す
        if (!pick || !fitsInView(pick.point, size, viewRect)) continue;
        chosen.push({ label: candidate.label, point: pick.key });
        // 20 分の札は 10 分の札とも重ねない
        boxes.push(buildReachLabelRect(pick.point, size));
      }
      const signature = JSON.stringify(chosen);
      if (signature === lastLabels) return;
      lastLabels = signature;
      setSourceData(map, sourceIds.reachLabels, buildReachLabelCollection(chosen));
    };
    place();
    map.on("moveend", place);
    // 実寸の再計測で札が動いたあとも、最後の描画位置で避け直す。
    map.on("render", place);
    return () => {
      map.off("render", place);
      map.off("moveend", place);
    };
  }, [map, geo, scene, guide, mode, reachLabelCandidates, top, right, bottom, left]);

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
    // 地図が止まるたびに、見える範囲に入る点を選び直す。動いている間は札を出さず、吹き出しやボタンに重なって見える瞬間を作らない
    const hide = () => setBlockedTagPosition(null);
    const place = () => {
      if (map.isMoving()) {
        hide();
        return;
      }
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
      // 吹き出しと現在地の札と「全体を見る」のボタンの矩形。札の幅と高さの半分に余白を足して広げ、重なる点を外す
      // 地図に重なる部品（リプレイの発表など）は data-map-obstacle で印を付ける。隠れている部品は大きさが 0 になるので外す
      const origin = canvas.getBoundingClientRect();
      const toggle = viewToggleRef.current;
      const settledToggle = toggle
        ? computeSettledToggleRect(canvas, { right, bottom }, toggle)
        : null;
      const boxes = [
        ...map
          .getContainer()
          .querySelectorAll<HTMLElement>(
            `[data-testid^="judgment-map-station-"], [data-testid="${mapTestIds.here}"] > div, [data-testid="${mapTestIds.alight}"] > p`,
          ),
        ...document.querySelectorAll<HTMLElement>("[data-map-obstacle]"),
      ].flatMap((el) => {
        const r = el.getBoundingClientRect();
        if (r.width === 0 || r.height === 0) return [];
        return [
          {
            left: r.left - origin.left - blockedTagMargin.x,
            right: r.right - origin.left + blockedTagMargin.x,
            top: r.top - origin.top - blockedTagMargin.y,
            bottom: r.bottom - origin.top + blockedTagMargin.y,
          },
        ];
      });
      if (settledToggle) {
        boxes.push({
          left: settledToggle.left - blockedTagMargin.x,
          right: settledToggle.right + blockedTagMargin.x,
          top: settledToggle.top - blockedTagMargin.y,
          bottom: settledToggle.bottom + blockedTagMargin.y,
        });
      }
      const chosen = points.find((p) => {
        const { x, y } = map.project(p);
        return (
          visible(x, y) &&
          anchors.every((a) => Math.hypot(a.x - x, a.y - y) > blockedTagClearance) &&
          boxes.every((b) => x < b.left || x > b.right || y < b.top || y > b.bottom)
        );
      });
      // 置ける点が無ければ札は出さない。止まっていることは現在地の札と上部の帯が示す
      setBlockedTagPosition((previous) => {
        const next = chosen ?? null;
        return previous?.[0] === next?.[0] && previous?.[1] === next?.[1] ? previous : next;
      });
    };
    place();
    map.on("movestart", hide);
    map.on("moveend", place);
    map.on("render", place);
    return () => {
      map.off("render", place);
      map.off("movestart", hide);
      map.off("moveend", place);
    };
  }, [map, blockedPath, view, guide, top, right, bottom, left]);

  // 手で整えた向きは好みとして保ち、重なる場合は画面サイズによらず置き直す
  // 駅間の車内の人の現在地と降りる駅の札は、手で整えた範囲でも、駅の印やボタンに重ならない置き場所を選ぶ
  const autoPlacements = useMemo(
    () =>
      map && guide && area
        ? layoutAutoPlacements(
            map,
            guide,
            { top, right, bottom, left },
            narrow,
            area.herePlacement[narrow ? "narrow" : "wide"],
            reachLabels.features.map((f) => f.geometry.coordinates),
            locale === "en",
            measuredSizes,
          )
        : null,
    [map, guide, area, narrow, top, right, bottom, left, reachLabels, locale, measuredSizes],
  );
  const placeStation = useCallback(
    (s: StationGuide["stations"][number]): BubblePlacement =>
      autoPlacements?.placements[s.key] ?? s.placement[narrow ? "narrow" : "wide"],
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
      ...(guide.alight
        ? [
            {
              key: "alight",
              position: guide.alight.position,
              anchor: "center" as const,
              offset: [0, 0] as [number, number],
            },
          ]
        : []),
      ...guide.stations
        .filter(
          (s) =>
            !autoPlacements?.hidden?.includes(s.key) && !autoPlacements?.docked?.includes(s.key),
        )
        .map((s) => {
          const placement = placeStation(s);
          const slide = autoPlacements?.slides[s.key] ?? 0;
          const [x, y] = markerOffset[placement];
          const horizontal = placement === "top" || placement === "bottom";
          return {
            key: `station:${s.key}`,
            position: s.position,
            anchor: markerAnchor[placement],
            offset: [x + (horizontal ? slide : 0), y + (horizontal ? 0 : slide)] as [
              number,
              number,
            ],
          };
        }),
    ];
  }, [view, guide, placeStation, autoPlacements]);
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
  // フォントや内容で見積もりを超えた札は、描画後の寸法でもう一度配置する。
  useEffect(() => {
    if (!guide) return;
    const labels = [...hosts.entries()].flatMap(([key, host]) => {
      if (key === "blocked") return [];
      const element = host.querySelector<HTMLElement>(
        key === "here" || key === "alight" ? "[data-placement]" : "[data-variant]",
      );
      if (!element) return [];
      return [{ element, key }];
    });
    const measure = () => {
      setMeasuredSizes((previous) => {
        const next = { ...previous };
        let changed = false;
        for (const { element, key } of labels) {
          const sizeKey =
            key === "here"
              ? `here:${narrow}`
              : key === "alight"
                ? key
                : `${key.slice("station:".length)}:${element.dataset.variant}`;
          const rect = element.getBoundingClientRect();
          // Marker の座標の丸めでも札の面が触れない余白を含める。
          const size = {
            w: Math.ceil(rect.width) + labelMeasurementPadding,
            h: Math.ceil(rect.height) + labelMeasurementPadding,
          };
          // 描画前の札は寸法が 0 になるので、見積もりを上書きしない
          if (rect.width === 0 || rect.height === 0) continue;
          if (previous[sizeKey]?.w === size.w && previous[sizeKey]?.h === size.h) continue;
          next[sizeKey] = size;
          changed = true;
        }
        return changed ? next : previous;
      });
    };
    const observer = new ResizeObserver(measure);
    for (const { element } of labels) observer.observe(element);
    measure();
    return () => observer.disconnect();
  }, [hosts, narrow, guide]);
  // 地図に収まらない札は、上端の一覧へ移す
  const dockedRows = autoPlacements?.docked
    ? listDockedStationRows(guide?.stations ?? [], autoPlacements.docked, {
        recommended: t("recommended"),
        shown: shownStationKey ? labels.selectedRoute : null,
        walk: labels.walkLabel,
      })
    : null;
  const herePlacement =
    autoPlacements?.placements.here ??
    (area ? area.herePlacement[narrow ? "narrow" : "wide"] : "left");

  const toggleLabel = view === "focus" ? t("viewOverview") : t("viewFocus");

  return (
    <section
      data-testid={testIds.judgment.map}
      data-state={status}
      data-view={view}
      data-focus-area={guide?.areaId ?? ""}
      data-recommended-option={recommendedOptionId ?? ""}
      data-selected-option={focusOptionId ?? ""}
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
            <HereMarker
              here={guide.here}
              hideLabel={autoPlacements?.docked?.includes("here")}
              placement={herePlacement}
              slide={autoPlacements?.slides.here ?? 0}
              compact={narrow}
            />,
            element,
            key,
          );
        }
        if (key === "alight" && guide?.alight) {
          return createPortal(
            <AlightMarker
              alight={guide.alight}
              hideLabel={autoPlacements?.docked?.includes("alight")}
              placement={autoPlacements?.placements.alight ?? "bottom"}
              slide={autoPlacements?.slides.alight ?? 0}
            />,
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
            slide={autoPlacements?.slides[station.key] ?? 0}
            variant={
              station.recommended && !autoPlacements?.compactRecommended
                ? "full"
                : narrow
                  ? "compact"
                  : "medium"
            }
            onSelect={optionId && onSelectOption ? () => onSelectOption(optionId) : null}
            shownLabel={station.key === shownStationKey ? labels.selectedRoute : null}
          />,
          element,
          key,
        );
      })}

      {floatingTag && chosenOption && (
        <p
          data-testid={mapTestIds.selectedRoute}
          className="glass absolute z-10 flex h-9 items-center gap-2 rounded-full px-3 text-[13px] font-semibold text-foreground"
          style={{
            top: props.insets.top + 8,
            left: left + 12,
            maxWidth: `calc(100% - ${left + right + 24}px)`,
          }}
        >
          <span className="shrink-0 rounded-full bg-foreground px-2 py-0.5 text-[11px] font-bold text-background">
            {labels.selectedRoute}
          </span>
          <span className="truncate">{chosenOption.label}</span>
        </p>
      )}
      {view === "focus" && guide && dockedRows && (
        <div
          data-testid={mapTestIds.labelList}
          className="absolute z-10 overflow-y-auto rounded-xl bg-surface p-2 break-words shadow-[0_2px_10px_rgb(0_0_0/0.16)]"
          style={{
            top: top + 8,
            left: left + 8,
            right: right + 8,
            maxHeight: `calc(100% - ${top + bottom + viewToggleBox.bottom + viewToggleBox.h + 16}px)`,
          }}
        >
          <p className="text-[13px] font-semibold">
            <span className="text-focus">{t("here")}</span> {guide.here.name} ·{" "}
            {guide.here.lines.map((line) => line.name).join(" · ")}
          </p>
          {guide.alight && (
            <p className="mt-1 text-[13px] font-semibold">
              <span className="text-focus">{t("alight")}</span> {guide.alight.name}
            </p>
          )}
          {dockedRows.map((row) => (
            <button
              key={row.key}
              type="button"
              data-testid={mapTestIds.labelListRow(row.key)}
              className="block min-h-11 w-full text-left text-[13px]"
              disabled={!row.optionId || !onSelectOption}
              onClick={() => {
                if (row.optionId) onSelectOption?.(row.optionId);
              }}
            >
              {row.text}
            </button>
          ))}
        </div>
      )}
      {guide ? (
        <button
          ref={viewToggleRef}
          type="button"
          data-testid={mapTestIds.viewToggle}
          data-view={view}
          aria-pressed={view === "overview"}
          onClick={() => {
            fittedRef.current = null;
            setViewChoice(view === "focus" ? "overview" : "focus");
          }}
          style={{ bottom: bottom + viewToggleBox.bottom, right: right + viewToggleBox.right }}
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
          style={{ bottom: bottom + viewToggleBox.bottom, right: right + viewToggleBox.right }}
          className="glass absolute z-10 flex size-11 items-center justify-center rounded-full text-foreground transition-[bottom] duration-200 disabled:opacity-0"
        >
          <LocateFixed className="size-5" strokeWidth={1.75} aria-hidden />
        </button>
      )}
      <MapAttribution
        labels={labels.attribution}
        insets={{ bottom, left, right }}
        testIds={{ root: mapTestIds.attribution, line: mapTestIds.attributionLine }}
      />
    </section>
  );
}
