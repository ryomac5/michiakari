"use client";

import "maplibre-gl/dist/maplibre-gl.css";
import { computeDistanceMeters, formatStationName } from "@repo/geo";
import type {
  Action,
  AfterAlightStep,
  Place,
  RouteOption,
  Section,
  TrainPosition,
} from "@repo/schema";
import { ArrowRight, LocateFixed, RotateCcw, Route } from "lucide-react";
import type { GeoJSONSource, Map as MapLibreMap, Marker } from "maplibre-gl";
import { useLocale, useTranslations } from "next-intl";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { selectOptionTone } from "@/features/judgment/action-style";
import type { InCarPlan } from "@/features/judgment/in-car-plan";
import { testIds } from "@/features/judgment/testids";
import { prefersReducedMotion, useDocumentTheme } from "@/lib/use-document-theme";
import { useMediaQuery } from "@/lib/use-media-query";
import { cn } from "@/lib/utils";
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
import { type EdgeMarker, placeEdgeMarker } from "./edge-marker";
import type { BubblePlacement } from "./focus-areas";
import { loadMapGeoData, type MapGeoData } from "./geo-data";
import { selectMapLabels } from "./labels";
import {
  arrowLayerIds,
  buildBaseStyle,
  buildDataLayers,
  drawRouteArrow,
  flowLayerIds,
  listPaintValues,
  type MapMode,
  type MapPalette,
  type MapView,
  mapPalettes,
  ROUTE_ARROW_IMAGE,
  sourceIds,
} from "./layers";
import { MapAttribution, mapAttributionHeight } from "./MapAttribution";
import { installMapScale } from "./map-scale";
import {
  buildInCarMotion,
  FLOW_DASH_FRAMES,
  FLOW_DURATION_MS,
  findPointAtFraction,
  type InCarMotion,
  type MotionPhase,
  selectMotionPhase,
  slicePathToFraction,
} from "./motion";
import { fetchReachAreas, type ReachArea } from "./reach";
import {
  buildReachLabelRect,
  chooseReachLabelCandidate,
  estimateReachLabelSize,
  fitsInView,
} from "./reach-label";
import { waitForOwnLayersDrawn } from "./ready";
import {
  checkRouteWalks,
  chooseFocusBounds,
  type RouteGuide,
  selectRouteGuide,
} from "./route-focus";
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
  thinKeyStationsOnScreen,
} from "./scene";
import { listPickStations, type MapSectionPick, selectPickBounds } from "./section-pick";
import {
  buildStationGuide,
  checkFeaturedStation,
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
  // 待つ判断で、動かなかったときに乗る選択肢。乗る駅に「動かなければ」の吹き出しを出す
  fallbackOptionId?: string | null;
  // 止まっている区間。発表の観測から分かったものだけを渡す
  blockedSection: Section | null;
  // 止まっている路線の名前（観測の line）。無ければ「待つ」経路の路線から推し量る
  blockedLine?: string | null;
  // 入口で選んだ路線と方面。発表に区間が無いとき、利用者のいる路線として薄く示す。区間としては描かない
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
  // 駅間の車内の人が次の駅に着いた後の一手。降りた後に光らせる経路を引くのに使う
  afterAlight?: AfterAlightStep | null;
  // 判断が出た印。変わるたびに、車内の人の動きを 1 回再生する。判断が出る前は null
  motionKey?: string | null;
  // 駅間の車内の人に勧める動き。次の駅で降りるときだけ「降りる駅」の印を出す
  inCarPlan?: InCarPlan | null;
  // 止まっている区間の線のそばに「見合わせ」の札を出せたか。出せないときは、画面が運行の状態を別の場所に出す
  onBlockedTagChange?: (shown: boolean) => void;
  // 止まっている区間の両端を選んでいる間だけ渡す。路線の駅を押せる印にし、ほかの札は隠す
  sectionPick?: MapSectionPick | null;
};

// updating は描画済みの地図にレイヤーの差し替えを反映している間
type MapStatus = "loading" | "updating" | "ready" | "error";

const defaultCenter: [number, number] = [135.5, 34.7];
// 重なる部品からさらに空ける余白
const fitMargin = { x: 64, y: 36 };
// 現在地のまわりでは、吹き出しと現在地の札のぶんを空ける。狭い画面では札を上に出す
// 吹き出しは勧める経路の駅の 1 つだけなので、余白は今いる位置と駅の札が収まる幅にする
const focusMargin = {
  wide: { top: 110, right: 200, bottom: 60, left: 200 },
  narrow: { top: 56, right: 56, bottom: 30, left: 56 },
};
// 自動で選んだ駅は吹き出しが四方に出るので、左右を同じだけ空ける
const autoFocusMargin = {
  wide: { top: 120, right: 200, bottom: 80, left: 200 },
  narrow: { top: 70, right: 56, bottom: 60, left: 56 },
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
// 現在地と降りる駅の印の半径に余白を足したもの（px）
const markRadius = 20;
// 「表示中」の札の高さと上下の余白。駅の吹き出しで選んだ経路を示せないときだけ地図の上端に出す
const selectedRouteTagSpace = 44;
// 画面の外の行き先の札のおおよその大きさ。単位は px
const destinationEdgeSize = { w: 136, h: 44 } as const;
// 動きをもう一度見るボタンの置き場所。単位は px。地図の左下で、出典の行より上に置く
const replayButtonBox = { left: 12, bottom: 40, size: 44, margin: 6 } as const;
// 流れる模様の破線を次へ進める間隔。単位は ms
const flowStepMs = 70;

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
// 並びの順に試し、見える範囲に入り、現在地と吹き出しから離れた最初の点に置く。近くに置けなければ遠い点も試す
const blockedTagMeters = [900, 750, 650, 500, 380, 260, 180, 1200, 1600, 2200];
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
// 路線データと並べて読み始められるよう、何度呼んでも読み込みは 1 度だけにする
let mapLibreLoading: Promise<typeof import("maplibre-gl")> | null = null;

export function loadMapLibre(): Promise<typeof import("maplibre-gl")> {
  mapLibreLoading ??= import("maplibre-gl").then((maplibre) => {
    maplibre.setWorkerUrl(new URL("maplibre-gl/dist/maplibre-gl-worker.mjs", import.meta.url).href);
    return maplibre;
  });
  mapLibreLoading.catch(() => {
    mapLibreLoading = null;
  });
  return mapLibreLoading;
}

// 路線データを待たずに地図の部品を読み始める。失敗は地図を作るときに扱う
export function preloadMapLibre(): void {
  loadMapLibre().catch(() => {});
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
    sourceIds.motionRide,
    sourceIds.motionAfter,
  ]) {
    map.addSource(id, { type: "geojson", data: emptyCollection });
  }
  if (!map.hasImage(ROUTE_ARROW_IMAGE))
    map.addImage(ROUTE_ARROW_IMAGE, drawRouteArrow(), { pixelRatio: 2 });
  for (const layer of buildDataLayers(palette, tone)) map.addLayer(layer);
  setArrowsVisible(map, false);
  installMapScale(map);
}

function setSourceData(map: MapLibreMap, id: string, data: unknown): void {
  map.getSource<GeoJSONSource>(id)?.setData(data as Parameters<GeoJSONSource["setData"]>[0]);
}

function buildLineCollection(paths: readonly Position[][]) {
  return {
    type: "FeatureCollection" as const,
    features: paths
      .filter((path) => path.length >= 2)
      .map((coordinates) => ({
        type: "Feature" as const,
        geometry: { type: "LineString" as const, coordinates },
        properties: {},
      })),
  };
}

// 向きの矢印を出すか。流れる模様を止めたあとと、動きを減らす設定のときに出す
function setArrowsVisible(map: MapLibreMap, visible: boolean): void {
  for (const id of arrowLayerIds) {
    if (map.getLayer(id)) map.setLayoutProperty(id, "visibility", visible ? "visible" : "none");
  }
  for (const id of flowLayerIds) {
    if (map.getLayer(id)) map.setLayoutProperty(id, "visibility", visible ? "none" : "visible");
  }
}

// 列車の印。乗っている列車を丸い札で示し、尾で線路の上の点を指す
function createTrainElement(label: string): HTMLElement {
  const el = document.createElement("div");
  el.setAttribute("data-testid", mapTestIds.motionTrain);
  el.setAttribute("role", "img");
  el.setAttribute("aria-label", label);
  el.className = "pointer-events-none flex flex-col items-center";
  el.innerHTML =
    '<span class="flex size-8 items-center justify-center rounded-full border-2 border-white bg-focus text-white shadow-[0_2px_8px_rgb(0_0_0/0.35)]"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M8 3.1V7a4 4 0 0 0 8 0V3.1"/><path d="m9 15-1-1"/><path d="m15 15 1-1"/><path d="M9 19c-2.8 0-5-2.2-5-5v-4a8 8 0 0 1 16 0v4c0 2.8-2.2 5-5 5Z"/><path d="m8 19-2 3"/><path d="m16 19 2 3"/></svg></span><span class="-mt-0.5 size-0 border-x-[5px] border-t-[6px] border-x-transparent border-t-white"></span>';
  return el;
}

function applyMapScene(map: MapLibreMap, scene: MapScene): void {
  setSourceData(map, sourceIds.reach, scene.reach);
  setSourceData(map, sourceIds.blocked, scene.blocked);
  setSourceData(map, sourceIds.route, scene.route);
  setSourceData(map, sourceIds.routeLabel, scene.routeLabel);
  setSourceData(map, sourceIds.alternatives, scene.alternatives);
  // 名前を出す駅は、画面の上で間引いてから別に渡す
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
    (s) => checkFeaturedStation(s) && s.placement[narrow ? "narrow" : "wide"] === "top",
  );
  const canvas = map.getCanvas();
  // 駅間の車内の人には吹き出しが無い。現在地と降りる駅の印が「全体を見る」のボタンの下に入らないよう、印の半径も足して下を空ける
  // 下端の出典の行にも印が掛からないよう、その高さを足す
  const bottom = guide.alight
    ? Math.max(margin.bottom, viewToggleBox.bottom + viewToggleBox.h + markRadius)
    : margin.bottom + mapAttributionHeight;
  return constrainFitPadding({ w: canvas.clientWidth, h: canvas.clientHeight }, insets, {
    ...margin,
    top: margin.top + (tallTop ? recommendedBubbleHeight : 0),
    bottom,
  });
}

// 現在地のまわりに寄せる範囲と余白と上限。今いる位置と行き先がぎりぎり入る範囲を先に試す
// 駅の印が読めないほど引くなら、今いる位置と経路の駅だけを収め、行き先は縁の札で示す
function selectFocusFit(map: MapLibreMap, insets: MapInsets, narrow: boolean, guide: RouteGuide) {
  const padding = buildGuidePadding(map, insets, narrow, guide);
  const maxZoom = guide.areaId.startsWith("auto:") ? focusMaxZoom.auto : focusMaxZoom.configured;
  const { bounds, includesDestination } = chooseFocusBounds(
    guide,
    (b) => map.cameraForBounds(b, { padding, maxZoom })?.zoom,
  );
  return { bounds, padding, maxZoom, includesDestination };
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
  if (checkFeaturedStation(station) && !compactRecommended)
    return { w: narrow ? 196 : 220, h: 150 };
  if (!narrow) return { w: 200, h: station.fallback ? 80 : 64 };
  // 路線色の印と分数のぶんを足す。おすすめの小さな札は、星の分だけ広い
  return {
    w: estimateTextWidth(station.shortName, 12) + 100 + (station.starred ? 16 : 0),
    // 上下の配置では 44px のタップ領域を基準にアンカーが付く。「動かなければ」の札は 1 段ぶん高い
    h: station.fallback ? 60 : 44,
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
  guide: RouteGuide,
  insets: MapInsets,
  narrow: boolean,
  herePreferred: BubblePlacement,
  // 札で隠したくない点。到達範囲の札の位置
  avoid: readonly Position[],
  english: boolean,
  measuredSizes: Readonly<Record<string, BoxSize>>,
): AutoLayout | null {
  const { bounds, padding, maxZoom } = selectFocusFit(map, insets, narrow, guide);
  if (!bounds) return null;
  const canvas = map.getCanvas();
  const camera = map.cameraForBounds(bounds, { padding, maxZoom });
  const zoom = camera?.zoom;
  if (zoom === undefined) return null;
  const width = canvas.clientWidth;
  const height = canvas.clientHeight;
  const [[west, south], [east, north]] = bounds;
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
          `${s.key}:${checkFeaturedStation(s) && !compactRecommended ? "full" : narrow ? "compact" : "medium"}`,
          estimateBubbleSize(s, narrow, compactRecommended),
        ),
        gap: 12,
      })),
    ],
    here,
    // 下端は地図の隅の出典の行を除く。札が出典に掛からないようにする
    view: {
      left: insets.left + 8,
      top: insets.top + 8,
      right: width - insets.right - 8,
      bottom: height - insets.bottom - mapAttributionHeight - 4,
    },
    preferred: { here: herePreferred, alight: "bottom", ...stationPlacements },
    obstacles: avoid.map((p) => {
      const { x, y } = toScreen(p);
      return { left: x - 40, right: x + 40, top: y - 11, bottom: y + 11 };
    }),
    // 駅間の車内では、左下に動きをもう一度見るボタンがある
    blockers: guide.alight
      ? [
          toggle,
          {
            left: insets.left + replayButtonBox.left - replayButtonBox.margin,
            right:
              insets.left + replayButtonBox.left + replayButtonBox.size + replayButtonBox.margin,
            top:
              height -
              insets.bottom -
              replayButtonBox.bottom -
              replayButtonBox.size -
              replayButtonBox.margin,
            bottom: height - insets.bottom - replayButtonBox.bottom + replayButtonBox.margin,
          },
        ]
      : [toggle],
  });
  return chooseStationLabelLayout(
    buildInput(false),
    buildInput(true),
    listRequiredLabelKeys(guide.stations),
  );
}

// 出発は丸、行き先はピンと駅名の札。色はテーマの文字色に合わせる
function createPlaceElement(role: "origin" | "destination", label: string): HTMLElement {
  const el = document.createElement("div");
  if (role === "origin") {
    el.setAttribute("aria-hidden", "true");
    el.className =
      "map-mark size-[18px] rounded-full border-[3px] border-white bg-foreground shadow-[0_1px_6px_rgb(0_0_0/0.35)]";
  } else {
    el.setAttribute("data-testid", mapTestIds.destination);
    el.className = "relative text-foreground";
    const pin = document.createElement("div");
    pin.setAttribute("aria-hidden", "true");
    pin.className = "map-mark origin-bottom drop-shadow-[0_2px_4px_rgb(0_0_0/0.3)]";
    pin.innerHTML =
      '<svg width="28" height="36" viewBox="0 0 28 36"><path d="M14 35c-6-8-12-13-12-20a12 12 0 0 1 24 0c0 7-6 12-12 20Z" fill="currentColor" stroke="white" stroke-width="2"/><circle cx="14" cy="14" r="4.5" fill="white"/></svg>';
    const tag = document.createElement("p");
    tag.className =
      "absolute top-1 left-[30px] flex w-max items-center gap-1 rounded-full bg-foreground px-2 py-0.5 text-[12px] font-bold text-background shadow-[0_1px_6px_rgb(0_0_0/0.3)]";
    tag.textContent = label;
    el.append(pin, tag);
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

// 車内の人の判断の動きを再生する。列車の印が次の駅まで動き、降りる印が出て、その先の経路が伸びる
// 動きを減らす設定では、動かさずに最後の状態を出す。返す段は地図の枠の data-motion に出す
function useInCarMotion(
  map: MapLibreMap | null,
  markerClass: typeof Marker | null,
  motion: InCarMotion | null,
  playKey: string | null,
  trainLabel: string,
): MotionPhase {
  const [phase, setPhase] = useState<MotionPhase>("idle");

  useEffect(() => {
    if (!map) return;
    if (!markerClass || !motion || playKey === null) {
      setSourceData(map, sourceIds.motionRide, emptyCollection);
      setSourceData(map, sourceIds.motionAfter, emptyCollection);
      setPhase("idle");
      return;
    }
    const start = motion.ride[0] as Position;
    const marker = new markerClass({
      element: createTrainElement(trainLabel),
      anchor: "bottom",
      offset: [0, -4],
    })
      .setLngLat(start)
      .addTo(map);
    // 列車の印は次の駅に着くまで出し、降りる印が出たら消す
    const trainElement = marker.getElement();
    trainElement.classList.add("transition-opacity", "duration-300");
    const draw = (ride: Position[], after: Position[][], at: Position | null, arrived: boolean) => {
      setSourceData(map, sourceIds.motionRide, buildLineCollection([ride]));
      setSourceData(map, sourceIds.motionAfter, buildLineCollection(after));
      if (at) marker.setLngLat(at);
      trainElement.style.opacity = arrived ? "0" : "1";
      trainElement.dataset.arrived = String(arrived);
    };
    if (prefersReducedMotion()) {
      draw(motion.ride, motion.after, motion.ride.at(-1) ?? null, true);
      setPhase("done");
      return () => {
        marker.remove();
      };
    }
    let frame = 0;
    const startedAt = performance.now();
    const tick = (now: number) => {
      const { phase: next, progress } = selectMotionPhase(now - startedAt);
      const rideProgress = next === "ride" ? progress : 1;
      const afterProgress = next === "route" ? progress : next === "done" ? 1 : 0;
      draw(
        slicePathToFraction(motion.ride, rideProgress),
        afterProgress > 0 ? motion.after.map((p) => slicePathToFraction(p, afterProgress)) : [],
        findPointAtFraction(motion.ride, rideProgress),
        next !== "ride",
      );
      setPhase(next);
      if (next !== "done") frame = window.requestAnimationFrame(tick);
    };
    frame = window.requestAnimationFrame(tick);
    return () => {
      window.cancelAnimationFrame(frame);
      marker.remove();
    };
  }, [map, markerClass, motion, playKey, trainLabel]);

  return phase;
}

// 勧める動きの線に、進む向きへ流れる模様を付ける。しばらく流したら止め、向きは矢印で示す
// 動きを減らす設定では流さず、はじめから矢印を出す
function useRouteFlow(map: MapLibreMap | null, active: boolean, playKey: string): boolean {
  const [flowing, setFlowing] = useState(false);
  // biome-ignore lint/correctness/useExhaustiveDependencies: playKey が変わるたびに流し直す
  useEffect(() => {
    if (!map) return;
    if (!active || prefersReducedMotion()) {
      setArrowsVisible(map, active);
      setFlowing(false);
      return;
    }
    setArrowsVisible(map, false);
    setFlowing(true);
    let step = 0;
    const timer = window.setInterval(() => {
      step = (step + 1) % FLOW_DASH_FRAMES.length;
      for (const id of flowLayerIds) {
        if (map.getLayer(id))
          map.setPaintProperty(id, "line-dasharray", [...(FLOW_DASH_FRAMES[step] as number[])]);
      }
    }, flowStepMs);
    const stop = window.setTimeout(() => {
      window.clearInterval(timer);
      setArrowsVisible(map, true);
      setFlowing(false);
    }, FLOW_DURATION_MS);
    return () => {
      window.clearInterval(timer);
      window.clearTimeout(stop);
    };
  }, [map, active, playKey]);
  return flowing;
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
    fallbackOptionId = null,
    sectionPick = null,
  } = props;
  const picking = sectionPick !== null;
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
    preloadMapLibre();
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
  // 徒歩の範囲の円は、地図に描く経路が歩きを含むときだけ出す
  const routeWalks = checkRouteWalks(options.find((o) => o.id === focusOptionId));
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
              hideReach: inCar || !routeWalks,
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
      routeWalks,
      labels,
      locale,
    ],
  );

  const destinationName =
    scene?.keyStations.features.find((f) => f.properties.role === "destination")?.properties.name ??
    labels.destination;
  const destinationLabel =
    destination.kind === "station" ? `${t("destination")} ${destinationName}` : t("destination");

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
  // 現在地のまわりの案内。シートの選択肢の行の印にはこちらを使う
  const fullGuide = useMemo(
    () =>
      geo && scene && area
        ? buildStationGuide(geo, area, {
            origin,
            options,
            recommendedOptionId: focusOptionId,
            starOptionId: recommendedOptionId,
            fallbackOptionId,
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
      fallbackOptionId,
      blockedLine,
      locale,
      labels,
      between,
      inCar,
    ],
  );

  // 駅間の車内の人の動き。いまの位置から次の駅まで動き、降りた後の経路を光らせる
  const { afterAlight = null, motionKey = null, inCarPlan = null } = props;
  const builtMotion = useMemo(
    () =>
      geo &&
      scene &&
      fullGuide?.alight &&
      inCar &&
      origin.kind === "station" &&
      (inCarPlan === "alight" || inCarPlan === "stay")
        ? buildInCarMotion(geo, {
            here: fullGuide.here.position,
            alight: fullGuide.alight.position,
            lineId: scene.trackLineIds[0] ?? null,
            alightStation: origin.name,
            destination,
            afterAlight,
            stay: inCarPlan === "stay",
          })
        : null,
    [geo, scene, fullGuide, inCar, origin, destination, afterAlight, inCarPlan],
  );
  // 地図の組み立てが繰り返されても、道筋が同じなら動きを再生し直さない
  const motionSignature = builtMotion ? JSON.stringify(builtMotion) : "";
  // biome-ignore lint/correctness/useExhaustiveDependencies: 道筋の中身が変わったときだけ作り直す
  const motion = useMemo(() => builtMotion, [motionSignature]);
  // 地図に出す案内。勧める経路の駅と今いる位置だけにしぼり、路線色も経路と乗っている路線だけに塗る
  const guide = useMemo(
    () =>
      fullGuide && scene
        ? selectRouteGuide(
            // 降りる駅の印は、次の駅で降りるときだけ出す。乗り続けるときは次の駅を示さない
            inCarPlan === "alight" ? fullGuide : { ...fullGuide, alight: null },
            [...scene.trackLineIds, ...scene.routeLineIds, ...(motion?.lineIds ?? [])],
            scene.destination,
            // 乗り続けるときも、進む先が見えるよう次の駅までは収める
            inCarPlan === "stay" && fullGuide.alight ? [fullGuide.alight.position] : [],
          )
        : null,
    [fullGuide, scene, motion, inCarPlan],
  );
  const view: MapView = guide ? viewChoice : "overview";
  // 列車の動きが終わる点から行き先までの距離。乗り続けるときは行き先まで進むことを確かめるのに使う
  const motionEnd = motion?.ride.at(-1) ?? null;
  const motionEndMeters =
    motionEnd && scene?.destination
      ? Math.round(computeDistanceMeters(motionEnd, scene.destination))
      : null;
  const [replayCount, setReplayCount] = useState(0);
  const playKey = motionKey === null ? null : `${motionKey}#${replayCount}`;
  const motionPhase = useInCarMotion(map, markerClass, motion, playKey, t("train"));
  const routeGlow =
    (scene?.route.features.some((f) => f.properties.mode === "ride") ?? false) ||
    (motion !== null && (motion.after.length > 0 || inCarPlan === "stay"));
  const flowActive = routeGlow || motion !== null;
  const flowing = useRouteFlow(
    map,
    flowActive && (motion === null || motionPhase !== "idle"),
    `${playKey ?? ""}|${scene?.route.features.length ?? 0}|${focusOptionId ?? ""}`,
  );

  const { onReachSourceChange, onGuideChange, onSelectOption } = props;
  const reachSource = scene?.reachSource ?? null;
  useEffect(() => {
    onReachSourceChange?.(reachSource);
  }, [reachSource, onReachSourceChange]);
  useEffect(() => {
    onGuideChange?.(fullGuide);
  }, [fullGuide, onGuideChange]);

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
  // 寄せた範囲。destination は今いる位置と行き先、near は今いる位置と経路の駅、overview は全体
  const [fitScope, setFitScope] = useState<"destination" | "near" | "overview">("overview");
  const fitView = useCallback(
    (instant: boolean) => {
      if (!map) return;
      const duration = instant || prefersReducedMotion() ? 0 : fitDurationMs;
      const insets = { top, right, bottom, left };
      const focusFit =
        view === "focus" && guide ? selectFocusFit(map, insets, narrow, guide) : null;
      setFitScope(focusFit ? (focusFit.includesDestination ? "destination" : "near") : "overview");
      if (focusFit?.bounds) {
        map.fitBounds(focusFit.bounds, {
          padding: focusFit.padding,
          maxZoom: focusFit.maxZoom,
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
    const bounds = view === "focus" ? [guide?.bounds, guide?.wideBounds] : scene.bounds;
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

  // 名前を出す駅を、地図が止まるたびにいまの拡大率で間引く。引いた地図で駅名どうしや印と重ねないため
  useEffect(() => {
    if (!map || !scene) return;
    let last = "";
    const place = () => {
      const thinned = thinKeyStationsOnScreen(scene.keyStations, (p) => map.project(p));
      const signature = JSON.stringify(thinned.features.map((f) => f.properties.name));
      if (signature === last) return;
      last = signature;
      setSourceData(map, sourceIds.keyStations, thinned);
    };
    place();
    map.on("moveend", place);
    return () => {
      map.off("moveend", place);
    };
  }, [map, scene]);

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

  // 全体を見るときの出発のピンと、いつも出す行き先のピンと駅名
  useEffect(() => {
    if (!map || !scene || !markerClass) return;
    const entries: ["origin" | "destination", Position | null, string][] = [
      ["origin", view === "overview" ? scene.origin : null, ""],
      ["destination", scene.destination, destinationLabel],
    ];
    for (const [role, position, label] of entries) {
      const current = markersRef.current[role];
      const stale = current && current.getElement().dataset.label !== label;
      if (position === null || stale) {
        current?.remove();
        markersRef.current[role] = null;
      }
      if (position === null) continue;
      const kept = markersRef.current[role];
      if (kept) {
        kept.setLngLat(position);
        continue;
      }
      const element = createPlaceElement(role, label);
      element.dataset.label = label;
      markersRef.current[role] = new markerClass({
        element,
        anchor: role === "origin" ? "center" : "bottom",
      })
        .setLngLat(position)
        .addTo(map);
    }
  }, [map, scene, markerClass, view, destinationLabel]);

  useEffect(() => {
    if (map) applyMapStyle(map, palette, tone, mode);
  }, [map, palette, tone, mode]);

  // 止まっている路線の札。現在地のまわりでは現在地の近くの線上、全体では区間の中ほど
  const blockedPath = scene?.blocked.features[0]?.geometry.coordinates ?? null;
  const blockedLabel = scene?.blocked.features[0]?.properties.label ?? "";
  const [blockedTagPosition, setBlockedTagPosition] = useState<Position | null>(null);
  // 札を置けたか。地図が動いている間は札を隠すが、ここは止まったときの結果だけで決める
  const [blockedTagPlaced, setBlockedTagPlaced] = useState(false);
  const { onBlockedTagChange } = props;
  useEffect(() => {
    onBlockedTagChange?.(blockedTagPlaced);
  }, [blockedTagPlaced, onBlockedTagChange]);
  useEffect(() => {
    if (!map || !blockedPath || blockedPath.length < 2) {
      setBlockedTagPosition(null);
      setBlockedTagPlaced(false);
      return;
    }
    if (view !== "focus" || !guide) {
      setBlockedTagPosition(blockedPath[Math.floor(blockedPath.length / 2)] ?? null);
      setBlockedTagPlaced(true);
      return;
    }
    const here = guide.here.position;
    // 札の幅の半分に余白を足した幅。長い区間の名前でも、ほかの札に重ならないよう札の文字から見積もる
    const margin = {
      x: Math.max(blockedTagMargin.x, estimateTextWidth(blockedLabel, 11) / 2 + 28),
      y: blockedTagMargin.y,
    };
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
        x > left + 40 &&
        x < width - right - 40 &&
        y > top + 24 &&
        y < height - bottom - mapAttributionHeight - 24;
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
            left: r.left - origin.left - margin.x,
            right: r.right - origin.left + margin.x,
            top: r.top - origin.top - margin.y,
            bottom: r.bottom - origin.top + margin.y,
          },
        ];
      });
      if (settledToggle) {
        boxes.push({
          left: settledToggle.left - margin.x,
          right: settledToggle.right + margin.x,
          top: settledToggle.top - margin.y,
          bottom: settledToggle.bottom + margin.y,
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
      setBlockedTagPlaced(chosen !== undefined);
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
  }, [map, blockedPath, blockedLabel, view, guide, top, right, bottom, left]);

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
  // 行き先が画面の外にあれば、見える範囲の縁に向きと駅名の札を出す
  const [destinationEdge, setDestinationEdge] = useState<EdgeMarker | null>(null);
  useEffect(() => {
    const target = scene?.destination ?? null;
    if (!map || !target) {
      setDestinationEdge(null);
      return;
    }
    const place = () => {
      const canvas = map.getCanvas();
      const point = map.project(target);
      const view = {
        left: left + 8,
        top: top + 8,
        right: canvas.clientWidth - right - 8,
        bottom: canvas.clientHeight - bottom - mapAttributionHeight - 8,
      };
      // 今いる位置と降りる駅と吹き出しの札に重ねない
      const origin = canvas.getBoundingClientRect();
      const avoid = [
        ...map
          .getContainer()
          .querySelectorAll<HTMLElement>(
            `[data-testid^="judgment-map-station-"], [data-testid="${mapTestIds.here}"], [data-testid="${mapTestIds.here}"] > div, [data-testid="${mapTestIds.alight}"], [data-testid="${mapTestIds.alight}"] > p, [data-testid="${mapTestIds.blockedTag}"]`,
          ),
      ].flatMap((el) => {
        const r = el.getBoundingClientRect();
        if (r.width === 0 || r.height === 0) return [];
        return [
          {
            left: r.left - origin.left - 6,
            right: r.right - origin.left + 6,
            top: r.top - origin.top - 6,
            bottom: r.bottom - origin.top + 6,
          },
        ];
      });
      const next = placeEdgeMarker(point, view, destinationEdgeSize, avoid);
      setDestinationEdge((previous) => {
        if (next === null || previous === null) return next;
        const same =
          Math.abs(previous.x - next.x) < 1 &&
          Math.abs(previous.y - next.y) < 1 &&
          Math.abs(previous.angle - next.angle) < 1;
        return same ? previous : next;
      });
    };
    place();
    // 札が描き直された後の位置でも避け直す
    const frame = window.requestAnimationFrame(place);
    map.on("move", place);
    map.on("moveend", place);
    map.on("resize", place);
    // 止まっている路線の札は描くたびに置き直されるので、描くたびに避け直す
    map.on("render", place);
    return () => {
      window.cancelAnimationFrame(frame);
      map.off("move", place);
      map.off("moveend", place);
      map.off("resize", place);
      map.off("render", place);
    };
  }, [map, scene, top, right, bottom, left]);

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
  // 区間を選んでいる間は、路線の駅の印だけを出す
  const pickLineId = sectionPick?.lineId ?? null;
  const pickStations = useMemo(
    () => (geo && pickLineId ? listPickStations(geo.nodes, pickLineId) : []),
    [geo, pickLineId],
  );
  const pickEntries = useMemo(
    () =>
      pickStations.map((s) => ({
        key: `pick:${s.name}`,
        position: s.position,
        anchor: "center" as const,
        offset: [0, 0] as [number, number],
      })),
    [pickStations],
  );
  const entries = useMemo(
    () => (pickLineId ? pickEntries : [...tagEntries, ...focusEntries]),
    [pickLineId, pickEntries, tagEntries, focusEntries],
  );
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
  // 選び始めたら現在地のまわりの路線の駅が収まるよう引き、やめたら元の見せ方へ戻す
  const fitViewRef = useRef(fitView);
  fitViewRef.current = fitView;
  // 寄せるのは選び始めたときだけにする。余白の変化では寄せ直さない
  // biome-ignore lint/correctness/useExhaustiveDependencies: 上の理由で余白を依存に入れない
  useEffect(() => {
    if (!map || !geo || pickStations.length === 0) return;
    const bounds = selectPickBounds(
      pickStations,
      resolvePlacePosition(geo.index, originRef.current),
    );
    if (bounds) {
      map.fitBounds(bounds, {
        padding: buildPadding({ top, right, bottom, left }),
        maxZoom: 14,
        duration: prefersReducedMotion() ? 0 : fitDurationMs,
      });
    }
    return () => {
      fittedRef.current = null;
      fitViewRef.current(false);
    };
  }, [map, geo, pickStations]);

  // 地図に収まらない札は、上端の一覧へ移す
  const dockedRows = autoPlacements?.docked
    ? listDockedStationRows(guide?.stations ?? [], autoPlacements.docked, {
        recommended: t("recommended"),
        fallback: t("fallback"),
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
      data-blocked-points={blockedPath?.length ?? 0}
      data-reach-source={scene?.reachSource ?? ""}
      data-motion={motionPhase}
      data-in-car-plan={inCarPlan ?? ""}
      data-motion-end-meters={motionEndMeters ?? ""}
      data-fit-scope={fitScope}
      data-station-marks={view === "focus" ? (guide?.stations.length ?? 0) : 0}
      data-colored-lines={mode.relevantLineIds.length}
      data-walk-reach={scene ? scene.reach.features.length > 0 : false}
      data-route-glow={routeGlow}
      data-flow={flowing ? "flowing" : flowActive ? "arrows" : "none"}
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
        if (key.startsWith("pick:") && sectionPick) {
          const name = key.slice("pick:".length);
          return createPortal(
            <PickStationMarker
              name={name}
              picked={sectionPick.first === name}
              onPick={() => sectionPick.onPick(name)}
            />,
            element,
            key,
          );
        }
        if (key === "blocked") {
          return createPortal(<BlockedTag label={blockedLabel} />, element, key);
        }
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
          // 列車が動いている間は隠し、次の駅に着いたところで出す
          return createPortal(
            <div
              className={cn(
                "transition-[opacity,scale] duration-300 ease-out motion-reduce:transition-none",
                motionPhase === "ride" ? "scale-50 opacity-0" : "scale-100 opacity-100",
              )}
            >
              <AlightMarker
                alight={guide.alight}
                hideLabel={autoPlacements?.docked?.includes("alight")}
                placement={autoPlacements?.placements.alight ?? "bottom"}
                slide={autoPlacements?.slides.alight ?? 0}
              />
            </div>,
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
              checkFeaturedStation(station) && !autoPlacements?.compactRecommended
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
      {sectionPick && (
        <div
          data-testid={mapTestIds.sectionPick}
          className="glass absolute z-10 flex items-center gap-1 rounded-full text-[13px] font-semibold text-foreground"
          style={{
            top: props.insets.top + 8,
            left: left + 12,
            maxWidth: `calc(100% - ${left + right + 24}px)`,
          }}
        >
          <p role="status" className="py-2 pl-3.5">
            {sectionPick.first ? t("sectionPick.second") : t("sectionPick.first")}
          </p>
          <button
            type="button"
            data-testid={mapTestIds.sectionPickCancel}
            onClick={sectionPick.onCancel}
            className="flex min-h-11 shrink-0 items-center rounded-full px-3 text-focus"
          >
            {t("sectionPick.cancel")}
          </button>
        </div>
      )}
      {!picking && view === "focus" && guide && dockedRows && (
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
      {!picking && destinationEdge && view === "focus" && (
        // 行き先が画面の外にあるとき、縁に向きと駅名を出す。押すと行き先まで収めた全体を見る
        <button
          type="button"
          data-testid={mapTestIds.destinationEdge}
          onClick={() => {
            fittedRef.current = null;
            setViewChoice("overview");
          }}
          className="glass absolute z-10 flex h-11 -translate-x-1/2 -translate-y-1/2 items-center gap-1 rounded-full px-3 text-[12px] font-bold whitespace-nowrap text-foreground"
          style={{
            left: destinationEdge.x,
            top: destinationEdge.y,
            maxWidth: destinationEdgeSize.w,
          }}
        >
          <span className="truncate">{destinationLabel}</span>
          <ArrowRight
            className="size-3.5 shrink-0"
            strokeWidth={2.5}
            style={{ rotate: `${destinationEdge.angle}deg` }}
            aria-hidden
          />
        </button>
      )}
      {!picking && motion && view === "focus" && (
        <button
          type="button"
          data-testid={mapTestIds.motionReplay}
          aria-label={t("replay")}
          title={t("replay")}
          disabled={motionKey === null}
          onClick={() => setReplayCount((n) => n + 1)}
          style={{
            bottom: bottom + replayButtonBox.bottom,
            left: left + replayButtonBox.left,
          }}
          className="glass absolute z-10 flex size-11 items-center justify-center rounded-full text-foreground transition-[bottom] duration-200 disabled:opacity-0 motion-reduce:hidden"
        >
          <RotateCcw className="size-5" strokeWidth={1.75} aria-hidden />
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

// 区間の端に選べる駅の印。押した駅は名前を濃く出す
function PickStationMarker({
  name,
  picked,
  onPick,
}: {
  name: string;
  picked: boolean;
  onPick: () => void;
}) {
  return (
    <button
      type="button"
      data-testid={mapTestIds.sectionPickStation(name)}
      aria-pressed={picked}
      aria-label={name}
      onClick={onPick}
      className="relative flex size-7 items-center justify-center"
    >
      <span
        aria-hidden
        className={
          picked
            ? "size-5 rounded-full border-[3px] border-white bg-danger shadow-[0_1px_4px_rgb(0_0_0/0.35)]"
            : "size-4 rounded-full border-[3px] border-danger bg-white shadow-[0_1px_4px_rgb(0_0_0/0.25)]"
        }
      />
      <span
        aria-hidden
        className={`pointer-events-none absolute top-1/2 left-full ml-0.5 -translate-y-1/2 rounded px-1 text-[11px] whitespace-nowrap ${
          picked ? "bg-danger font-bold text-white" : "bg-surface/85 font-semibold text-foreground"
        }`}
      >
        {name}
      </span>
    </button>
  );
}
