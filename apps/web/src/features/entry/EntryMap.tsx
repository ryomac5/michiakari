"use client";

import "maplibre-gl/dist/maplibre-gl.css";
import { computeDistanceMeters } from "@repo/geo";
import { ArrowUp } from "lucide-react";
import type { GeoJSONSource, Map as MapLibreMap, Marker } from "maplibre-gl";
import { useLocale, useTranslations } from "next-intl";
import { type RefObject, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { testIds } from "@/features/judgment/testids";
import type { Rect } from "@/features/map/bubble-layout";
import type { MapGeoData } from "@/features/map/geo-data";
import { selectMapLabels } from "@/features/map/labels";
import { buildBaseStyle, type MapPalette, mapPalettes } from "@/features/map/layers";
import { MapAttribution, mapAttributionHeight } from "@/features/map/MapAttribution";
import { loadMapLibre, type MapInsets, useMarkerHosts } from "@/features/map/MapPanel";
import { prefersReducedMotion, useDocumentTheme } from "@/lib/use-document-theme";
import type { LabelSide } from "./areas";
import {
  DestinationMarker,
  HubMarker,
  PlaceMarker,
  type PlaceTap,
  SegmentMarker,
  StopMarker,
} from "./EntryMarkers";
import type { EntryArea, EntryHub, EntryPlace, Position } from "./entry-places";
import { pickLocalized, pickPlaceName } from "./entry-places";
import type { EntryStage } from "./flow";
import {
  BETWEEN_PICK_MIN_ZOOM,
  computeSegmentApproachRadii,
  computeSegmentApproachZoom,
  computeSegmentHitRadii,
  findNearestLineId,
  RAIL_TAP_PX,
  SECTION_FOCUS_STRENGTH,
  type SectionGlow,
  selectMapTapTarget,
} from "./map-pick";
import {
  buildEdgeHubRect,
  type EdgeHub,
  type HubLabel,
  placeEdgeHubs,
  selectVisibleHubs,
} from "./visible-hubs";
import {
  type MapStation,
  type MapTarget,
  STATION_LABEL_MIN_ZOOM,
  selectVisibleStations,
  type VisibleStation,
} from "./visible-stations";
import {
  buildStopLabelRect,
  computeStopHitRadii,
  keepStopsIfSame,
  selectVisibleStops,
} from "./visible-stops";

// 入口の地図。関西 → エリア → 駅の順に寄り、行き先を選んだら出発と行き先を結ぶ
// 段ごとに出す印を絞り、地図そのものは淡く沈める

export type EntryMapApi = {
  // 判断へ移る直前に、出発の駅へ寄せる。判断の画面の最初の視点に近づける
  zoomToOrigin: (zoom: number) => Promise<void>;
};

// 方面・行き先・近い駅の札。シートの答えと同じものを地図にも置く
export type MapStop = {
  key: string;
  position: Position;
  label: string;
  color: string;
  // 方面の札だけが持つ矢印の向き（度）
  angle: number | null;
  side: LabelSide;
  // 路線の札。路線色の太い印を添える
  kind?: "line";
  // 名前が収まらなくても印を残す駅
  keep?: boolean;
  labelHidden?: boolean;
};

// 車内の駅の間。中ほどの丸を押すと、その駅の間を選ぶ
// path は線路の形に沿った駅の間の線、position はその中ほどの点
export type MapSegment = {
  key: string;
  label: string;
  position: Position;
  path: Position[];
  color: string;
  selected: boolean;
};

// 地図に描く路線の強さ
// focus は lineIds を強く描いてほかを薄くし、only は lineIds だけを残す。all は全部の路線を路線色で描く
export type LineFocus = { lineIds: string[]; mode: "focus" | "only" | "all" };

type EntryMapProps = {
  geo: MapGeoData | null;
  stations: MapStation[];
  stage: EntryStage;
  // 駅の間の段で寄せる点。null なら大阪駅のあたりに寄せる
  betweenFocus?: Position | null;
  hubs: EntryHub[];
  area: EntryArea | null;
  place: EntryPlace | null;
  // 強く描く路線。null なら全部を淡く描く
  lineFocus: LineFocus | null;
  // 線を押して路線を選べるか。押せるのは強く描いた線か、all なら全部の線
  linePickable: boolean;
  // reachMeters は線を押したとみなす幅、tapReachMeters は押せる大きさ 44px を地図の距離にしたもの
  onSelectLine: (
    lineId: string,
    point: Position,
    reachMeters: number,
    tapReachMeters: number,
  ) => void;
  // 最初の段と駅の間の段で、指の下に描いた路線を知らせる。倍率にかかわらず知らせ、近い順に並べる
  // reachMeters は押せる大きさ 44px を地図の距離にしたもの。label は札を押したときの駅で、駅の間が無ければその駅を選ぶ
  onSelectRails?: (
    lineIds: string[],
    point: Position,
    reachMeters: number,
    label: EntryPlace | null,
  ) => void;
  // 地図に出した駅を、答えとして受け付ける段か。受け付けない段では、駅の印や札の上も線として押させる
  placePickable?: boolean;
  segments: MapSegment[];
  // 線を押して出した駅の間の候補か、確定した駅の間。光らせて描き、ほかの線を薄くする
  sections: SectionGlow;
  // 線を押した点。新しい点が来るたびに、波紋の印を一瞬だけ出す
  tapPoint: Position | null;
  onSelectSegment: (key: string) => void;
  // 選んだ駅の名前の札の向き。地図に出す札を避ける向きにする。null なら設定の向き
  placeSide: LabelSide | null;
  destination: { position: Position; label: string } | null;
  stops: MapStop[];
  // 札は出さずに視点だけに含める点。いまどこの段で前後の駅まで収める
  focus: Position[];
  // 札を収めるときの余白（px）。名前を隠せる駅を多く出す段は狭くして大きく寄せる
  stopMargin?: { x: number; y: number };
  onSelectStop: (key: string) => void;
  insets: MapInsets;
  narrow: boolean;
  apiRef: RefObject<EntryMapApi | null>;
  onSelectHub: (areaId: string) => void;
  onSelectPlace: (place: EntryPlace) => void;
  // 印のない所を触ったとき。reachMeters は指の幅を地図の距離にしたもの
  onTap: (point: Position, reachMeters: number) => void;
};

const kansaiCenter: Position = [135.5, 34.75];
// 駅の間の段で、寄せる点が無いときの中心。大阪駅のあたり
const betweenCenter: Position = [135.4959, 34.7024];
// 駅の間の段の倍率。駅の印が出て、駅と駅の間の線を押せる倍率にする
const betweenZoom = 13.5;
// 引いた地図で線を押して候補を出したとき、候補の区間を収める余白（px）と、寄せる倍率の上限
const sectionMargin = { x: 40, y: 32 };
const sectionMaxZoom = 14;
// 何もない所を触ったとき、そのあたりの駅とみなす指の幅（px）。押せる部品の大きさにそろえる
const tapReachPx = 44;
// 様子を聞く段。行き先を選び終えているので、出発と行き先を弧で結び、視点は動かさない
const situationStages = new Set<EntryStage>([
  "cause",
  "causeKind",
  "protection",
  "elapsed",
  "resume",
  "input",
]);
const sourceIds = {
  lines: "entry-lines",
  trip: "entry-trip",
  segment: "entry-segment",
  section: "entry-section",
} as const;
// 光らせる駅の間の層。外側のぼかし、縁、路線色の線の順に重ねる
const sectionLayers = {
  glow: "entry-section-glow",
  casing: "entry-section-casing",
  line: "entry-section-line",
} as const;
// 押した点の波紋を出しておく時間（ms）
const tapRippleMs = 650;
// 線を押したとみなす、押した点からの幅（px）
const linePickPx = RAIL_TAP_PX;
// 駅の間の丸がよける、駅の印と札の丸の半径（px）
const markerHitRadius = 24;
// 名前の札のぶん、印のまわりに空ける余白（px）
const labelMargin = { x: 96, y: 44 };
const durationMs = 650;
// 駅の段で一緒に収める、まわりの駅までの距離（m）
const nearbyMeters = 600;
// エリアに寄せる倍率の幅。駅の印が出る倍率を保ち、狭い画面でも隣の駅まで収める
const minimumAreaZoom = STATION_LABEL_MIN_ZOOM + 0.05;
const maximumAreaZoom = 14;
// エリアの中心から収める範囲（m）。大阪なら東の天満と北の中津まで入る
const areaReach = { eastWest: 1500, northSouth: 1000 };
const areaMargin = { x: 16, y: 24 };
// 関西の段の丸の印と押せる丸の半径（px）。HubMarker の大きさに合わせる
const hubTarget = { dotRadius: 13, hitRadius: 24 };

function buildRailColor(palette: MapPalette) {
  // 遠くでは無彩色、寄るほど路線色にする
  return [
    "interpolate",
    ["linear"],
    ["zoom"],
    10.5,
    palette.rail,
    13,
    ["get", "color"],
  ] as unknown as string;
}

// dimmed は駅の間を光らせているか。光らせている間は、ほかの線を薄くして浮き上がらせる
function applyPaint(
  map: MapLibreMap,
  palette: MapPalette,
  focus: LineFocus | null,
  dimmed: boolean,
): void {
  type PaintArgs = Parameters<MapLibreMap["setPaintProperty"]>;
  const set = (layer: string, key: string, value: unknown) => {
    if (map.getLayer(layer))
      map.setPaintProperty(layer, key as PaintArgs[1], value as PaintArgs[2]);
  };
  set("background", "background-color", palette.background);
  set("gsi-pale", "raster-brightness-min", palette.rasterBrightnessMin);
  set("gsi-pale", "raster-brightness-max", palette.rasterBrightnessMax);
  set("gsi-pale", "raster-contrast", palette.rasterContrast);
  const all = focus?.mode === "all";
  set("entry-rail", "line-color", all ? ["get", "color"] : buildRailColor(palette));
  const dim = dimmed ? 0.45 : 1;
  const near = (!focus || all ? 0.45 : focus.mode === "only" ? 0.06 : 0.2) * dim;
  const far =
    (focus?.mode === "only" ? Math.min(0.06, palette.railOpacity) : palette.railOpacity) * dim;
  set(
    "entry-rail",
    "line-opacity",
    all ? 0.85 * dim : ["interpolate", ["linear"], ["zoom"], 9, far, 13, near],
  );
  set("entry-line-casing", "line-opacity", 0.9 * dim);
  set("entry-line-focus", "line-opacity", dim);
  set("entry-line-casing", "line-color", palette.routeCasing);
  set(sectionLayers.casing, "line-color", palette.routeCasing);
  set("entry-trip", "line-color", palette.text);
  set("entry-segment", "line-color", palette.text);
  const ids = focus && !all ? focus.lineIds : [];
  const filter = ["in", ["get", "lineId"], ["literal", ids]];
  for (const layer of ["entry-line-casing", "entry-line-focus"]) {
    if (map.getLayer(layer))
      map.setFilter(layer, filter as Parameters<MapLibreMap["setFilter"]>[1]);
  }
}

function addLayers(map: MapLibreMap, geo: MapGeoData, palette: MapPalette): void {
  map.addSource(sourceIds.lines, { type: "geojson", data: geo.lines });
  map.addSource(sourceIds.trip, {
    type: "geojson",
    data: { type: "FeatureCollection", features: [] },
  });
  const width = ["interpolate", ["linear"], ["zoom"], 9, 1, 12, 2, 15, 3.5];
  map.addLayer({
    id: "entry-rail",
    type: "line",
    source: sourceIds.lines,
    layout: { "line-cap": "round", "line-join": "round" },
    paint: { "line-color": palette.rail, "line-width": width as unknown as number },
  });
  map.addLayer({
    id: "entry-line-casing",
    type: "line",
    source: sourceIds.lines,
    layout: { "line-cap": "round", "line-join": "round" },
    paint: { "line-color": palette.routeCasing, "line-width": 9, "line-opacity": 0.9 },
  });
  map.addLayer({
    id: "entry-line-focus",
    type: "line",
    source: sourceIds.lines,
    layout: { "line-cap": "round", "line-join": "round" },
    paint: { "line-color": ["get", "color"], "line-width": 5.5 },
  });
  addSectionLayers(map, palette);
  map.addSource(sourceIds.segment, {
    type: "geojson",
    data: { type: "FeatureCollection", features: [] },
  });
  map.addLayer({
    id: "entry-segment",
    type: "line",
    source: sourceIds.segment,
    layout: { "line-cap": "round", "line-join": "round" },
    paint: { "line-color": palette.text, "line-width": 4, "line-dasharray": [1, 1.4] },
  });
  map.addLayer({
    id: "entry-trip",
    type: "line",
    source: sourceIds.trip,
    layout: { "line-cap": "round", "line-join": "round" },
    paint: { "line-color": palette.text, "line-width": 2.5, "line-dasharray": [1.2, 1.8] },
  });
}

// 駅の間を光らせる層。strength が 1 の候補ほど太く濃く描く
function addSectionLayers(map: MapLibreMap, palette: MapPalette): void {
  map.addSource(sourceIds.section, {
    type: "geojson",
    data: { type: "FeatureCollection", features: [] },
  });
  const strength = ["get", "strength"];
  const scale = (base: number, gain: number) =>
    ["+", base, ["*", gain, strength]] as unknown as number;
  const layout = { "line-cap": "round", "line-join": "round" } as const;
  map.addLayer({
    id: sectionLayers.glow,
    type: "line",
    source: sourceIds.section,
    layout,
    paint: {
      "line-color": ["get", "color"] as unknown as string,
      "line-width": scale(10, 20),
      "line-blur": scale(4, 10),
      "line-opacity": scale(0.1, 0.8),
    },
  });
  map.addLayer({
    id: sectionLayers.casing,
    type: "line",
    source: sourceIds.section,
    layout,
    paint: {
      "line-color": palette.routeCasing,
      "line-width": scale(3, 7),
      "line-opacity": scale(0.2, 0.75),
    },
  });
  map.addLayer({
    id: sectionLayers.line,
    type: "line",
    source: sourceIds.section,
    layout,
    paint: {
      "line-color": ["get", "color"] as unknown as string,
      "line-width": scale(2, 5),
      "line-opacity": scale(0.4, 0.6),
    },
  });
}

// 出発と行き先をゆるい弧で結ぶ。経路ではなく、どこからどこへ行くかだけを示す
export function buildTripArc(from: Position, to: Position, steps = 32): Position[] {
  const [dx, dy] = [to[0] - from[0], to[1] - from[1]];
  const control: Position = [from[0] + dx / 2 - dy * 0.18, from[1] + dy / 2 + dx * 0.18];
  return Array.from({ length: steps + 1 }, (_, i) => {
    const t = i / steps;
    const u = 1 - t;
    return [
      u * u * from[0] + 2 * u * t * control[0] + t * t * to[0],
      u * u * from[1] + 2 * u * t * control[1] + t * t * to[1],
    ];
  });
}

function computeBounds(points: Position[]): [Position, Position] | null {
  if (points.length === 0) return null;
  const lons = points.map((p) => p[0]);
  const lats = points.map((p) => p[1]);
  return [
    [Math.min(...lons), Math.min(...lats)],
    [Math.max(...lons), Math.max(...lats)],
  ];
}

// エリアの中心から東西と南北に areaReach だけ離れた 4 点
function buildAreaReach(center: Position): Position[] {
  const lat = areaReach.northSouth / 111_320;
  const lon = areaReach.eastWest / (111_320 * Math.cos((center[1] * Math.PI) / 180));
  return [
    [center[0] - lon, center[1] - lat],
    [center[0] + lon, center[1] + lat],
  ];
}

// 押した点のまわり 44px の四角に描かれた線を、路線ごとの折れ線にする
function queryTappedLines(
  map: MapLibreMap,
  x: number,
  y: number,
  layer: string,
): { lineId: string; paths: Position[][] }[] {
  if (!map.getLayer(layer)) return [];
  const features = map.queryRenderedFeatures(
    [
      [x - linePickPx, y - linePickPx],
      [x + linePickPx, y + linePickPx],
    ],
    { layers: [layer] },
  );
  return features.flatMap((f) => {
    const lineId = f.properties?.lineId;
    if (typeof lineId !== "string") return [];
    const geometry = f.geometry;
    const paths =
      geometry.type === "LineString"
        ? [geometry.coordinates as Position[]]
        : geometry.type === "MultiLineString"
          ? (geometry.coordinates as Position[][])
          : [];
    return [{ lineId, paths }];
  });
}

// 押した点のまわりの線から、いちばん近い路線を探す。押せる線が無ければ null
function findTappedLine(map: MapLibreMap, x: number, y: number, focus: LineFocus): string | null {
  const layer = focus.mode === "all" ? "entry-rail" : "entry-line-focus";
  const point = map.unproject([x, y]);
  return findNearestLineId(queryTappedLines(map, x, y, layer), [point.lng, point.lat]);
}

// 重なる部品を除いた範囲の中心に寄せるための、画面の中心からのずれ（px）
function buildOffset(insets: MapInsets): [number, number] {
  return [(insets.left - insets.right) / 2, (insets.top - insets.bottom) / 2];
}

// 寄せるときの余白。シートが高いときも地図に描ける範囲が残るよう、画面の大きさで抑える
function buildPadding(
  map: MapLibreMap,
  insets: MapInsets,
  margin: { x: number; y: number },
): { top: number; right: number; bottom: number; left: number } {
  const canvas = map.getCanvas();
  const minVisible = 96;
  // 余白を詰めても最低限残す描ける範囲（px）
  const minFit = 24;
  const padding = {
    top: insets.top + margin.y,
    right: insets.right + margin.x,
    bottom: insets.bottom + margin.y,
    left: insets.left + margin.x,
  };
  const overY = padding.top + padding.bottom - (canvas.clientHeight - minVisible);
  if (overY > 0) {
    // 下はシートの上の出典の帯まで詰め、上はピンと駅名の札の分を残す
    // ピンや弧が出典の文字に掛からず、札が上部の帯に隠れないようにする
    padding.bottom -= Math.max(
      0,
      Math.min(overY, padding.bottom - insets.bottom - mapAttributionHeight),
    );
    // それでも描ける範囲が無ければ、上部の帯の下まで上を詰め、最後は出典の帯にも掛けて下を詰める
    const overflow = padding.top + padding.bottom - (canvas.clientHeight - minFit);
    if (overflow > 0) padding.top = Math.max(insets.top + 8, padding.top - overflow);
    const rest = padding.top + padding.bottom - (canvas.clientHeight - minFit);
    if (rest > 0) padding.bottom = Math.max(8, padding.bottom - rest);
  }
  const overX = padding.left + padding.right - (canvas.clientWidth - minVisible);
  if (overX > 0) {
    padding.left = Math.max(8, padding.left - overX / 2);
    padding.right = Math.max(8, padding.right - overX / 2);
  }
  return padding;
}

// エリアに寄せる。エリアの丸や何も無い所を押したときと、引いた地図で線を押したときに使う
function flyToArea(map: MapLibreMap, area: EntryArea, insets: MapInsets, duration: number): void {
  const bounds = computeBounds([
    ...buildAreaReach(area.center),
    ...area.places.map((p) => p.position),
  ]);
  if (!bounds) return;
  const camera = map.cameraForBounds(bounds, {
    padding: buildPadding(map, insets, areaMargin),
    maxZoom: maximumAreaZoom,
  });
  // 倍率を幅に収めると範囲がはみ出すので、中心は範囲の中央に置き、帯とシートの分だけずらす
  const [[west, south], [east, north]] = bounds;
  if (camera)
    map.flyTo({
      center: [(west + east) / 2, (south + north) / 2],
      zoom: Math.max(minimumAreaZoom, camera.zoom ?? minimumAreaZoom),
      offset: buildOffset(insets),
      duration,
    });
}

// 点が上部の帯やシートに隠れていれば、倍率を変えずに見える所の中ほどへ動かす。隠れていなければ動かさない
function keepPointVisible(
  map: MapLibreMap,
  position: Position,
  insets: MapInsets,
  duration: number,
): void {
  const padding = buildPadding(map, insets, { x: 24, y: 24 });
  const canvas = map.getCanvas();
  const point = map.project(position);
  const right = canvas.clientWidth - padding.right;
  const bottom = canvas.clientHeight - padding.bottom;
  const goal = {
    x: point.x < padding.left || point.x > right ? (padding.left + right) / 2 : point.x,
    y: point.y < padding.top || point.y > bottom ? (padding.top + bottom) / 2 : point.y,
  };
  if (goal.x === point.x && goal.y === point.y) return;
  map.panBy([point.x - goal.x, point.y - goal.y], { duration });
}

// 引いた地図で線を押して候補が出たら、候補の区間を収め、駅の印が出る倍率まで寄せる
// 収めると駅の印の倍率に届かないときは、押した点を中心にして駅の印の倍率にする
function approachSections(
  map: MapLibreMap,
  tapPoint: Position,
  sectionPoints: Position[],
  insets: MapInsets,
  duration: number,
): void {
  const bounds = computeBounds([tapPoint, ...sectionPoints]);
  if (!bounds) return;
  const camera = map.cameraForBounds(bounds, {
    padding: buildPadding(map, insets, sectionMargin),
    maxZoom: sectionMaxZoom,
  });
  const fitZoom = camera?.zoom ?? BETWEEN_PICK_MIN_ZOOM;
  const zoom = Math.max(fitZoom, BETWEEN_PICK_MIN_ZOOM);
  const center: Position =
    fitZoom >= BETWEEN_PICK_MIN_ZOOM
      ? [(bounds[0][0] + bounds[1][0]) / 2, (bounds[0][1] + bounds[1][1]) / 2]
      : tapPoint;
  map.easeTo({ center, zoom, offset: buildOffset(insets), duration });
}

// 地図を押した点の答えを決めて知らせる。札を押したときは label にその駅を渡す
// 駅の印の中心の近くは駅、描いた線の上は駅の間、どちらでもなければ何もない所を押したとみなす
function handleTapAt(
  map: MapLibreMap,
  x: number,
  y: number,
  label: EntryPlace | null,
  props: EntryMapProps,
  places: readonly VisibleStation[],
): void {
  const lngLat = map.unproject([x, y]);
  const point: Position = [lngLat.lng, lngLat.lat];
  const edge = map.unproject([x + tapReachPx, y]);
  const reach = computeDistanceMeters(point, [edge.lng, edge.lat]);
  const { onSelectRails } = props;
  // 札の上は、駅の印が出る倍率のときだけ札の下の線を見る。引いた地図の札は駅を選ぶ
  const railPickable =
    onSelectRails !== undefined && (label === null || map.getZoom() >= BETWEEN_PICK_MIN_ZOOM);
  const tapped = railPickable ? queryTappedLines(map, x, y, "entry-rail") : [];
  const placePickable = props.placePickable ?? true;
  const target = selectMapTapTarget({
    point: { x, y },
    stations: places.map((v) => ({
      key: v.place.key,
      point: map.project(v.place.position),
      markRadius: v.markRadius,
      hitRadius: v.hitRadius,
    })),
    rails: tapped.map((t) => ({
      lineId: t.lineId,
      paths: t.paths.map((path) => path.map((p) => map.project(p))),
    })),
    labelKey: label?.key ?? null,
    placePickable,
  });
  if (target.kind === "station") {
    const place =
      places.find((v) => v.place.key === target.key)?.place ??
      (label?.key === target.key ? label : undefined);
    if (place) props.onSelectPlace(place);
    return;
  }
  // 線を押して路線や駅の間を選べる段では、線の上を押したらそれを選ぶ
  const lineId =
    label === null && props.linePickable && props.lineFocus
      ? findTappedLine(map, x, y, props.lineFocus)
      : null;
  if (lineId) {
    const lineEdge = map.unproject([x + linePickPx, y]);
    props.onSelectLine(
      lineId,
      point,
      computeDistanceMeters(point, [lineEdge.lng, lineEdge.lat]),
      reach,
    );
    return;
  }
  // 線の上を押したら、倍率にかかわらず駅の間を尋ねる。引いた地図でも、押した点から 22px の内の線で決める
  if (target.kind === "rail" && onSelectRails) {
    onSelectRails(target.lineIds, point, reach, placePickable ? label : null);
    return;
  }
  props.onTap(point, reach);
}

export function EntryMap(props: EntryMapProps) {
  const t = useTranslations("entry");
  const locale = useLocale();
  const labels = selectMapLabels(locale);
  const theme = useDocumentTheme();
  const palette = mapPalettes[theme];
  const {
    geo,
    stage,
    betweenFocus = null,
    hubs,
    area,
    place,
    lineFocus,
    destination,
    stops,
    segments,
    sections,
    tapPoint,
    focus,
    insets,
    narrow,
    placeSide,
  } = props;
  const containerRef = useRef<HTMLDivElement>(null);
  const paletteRef = useRef(palette);
  paletteRef.current = palette;
  const callbacksRef = useRef(props);
  callbacksRef.current = props;
  const [map, setMap] = useState<MapLibreMap | null>(null);
  const [visiblePlaces, setVisiblePlaces] = useState<VisibleStation[]>([]);
  // 地図に印を出している駅。押した点が駅の近くかを決めるのに使う
  const placesShown =
    stage === "kansai" || stage === "area" || stage === "station" || stage === "between";
  const shownPlacesRef = useRef<VisibleStation[]>([]);
  shownPlacesRef.current = placesShown ? visiblePlaces : [];
  // 関西の段の丸と縁の札の矩形。引いた地図の駅の名前はこれを避ける
  const hubBlockersRef = useRef<{ rects: Rect[]; targets: MapTarget[] }>({
    rects: [],
    targets: [],
  });
  const [visibleStops, setVisibleStops] = useState<MapStop[]>([]);
  const [stopRadii, setStopRadii] = useState<Record<string, number>>({});
  // 選んだ駅の押せる丸の半径。札の印と押せる範囲がぶつからない大きさにする
  const [placeHitRadius, setPlaceHitRadius] = useState(24);
  // radius は選べる押せる丸の半径。0 なら引いた地図で丸が取れず、approach の半径で押して寄せる
  const [segmentRadii, setSegmentRadii] = useState<
    { key: string; radius: number; approach: number }[]
  >([]);
  const hereLabel = t("here");
  const [zoom, setZoom] = useState(0);
  // 地図の中心。倍率と合わせて、e2e が緯度経度から画面の点を求めるのに使う
  const [center, setCenter] = useState<Position>(kansaiCenter);
  const [markerClass, setMarkerClass] = useState<typeof Marker | null>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!geo || !container) return;
    let disposed = false;
    let instance: MapLibreMap | null = null;
    loadMapLibre()
      .then(({ Map: MapClass, Marker: MarkerClass }) => {
        if (disposed) return;
        setMarkerClass(() => MarkerClass);
        instance = new MapClass({
          container,
          style: buildBaseStyle(paletteRef.current),
          center: kansaiCenter,
          zoom: 9.3,
          minZoom: 7,
          maxZoom: 17,
          attributionControl: false,
          dragRotate: false,
          pitchWithRotate: false,
          touchPitch: false,
        });
        instance.touchZoomRotate.disableRotation();
        const loaded = instance;
        // 下地のタイルを待たず、スタイルが読めたら路線を足して準備できたとする
        loaded.once("style.load", () => {
          addLayers(loaded, geo, paletteRef.current);
          setMap(loaded);
        });
        // 指やキーで地図を動かしたか。動かした後は、シートの高さが変わっただけでは寄せ直さない
        loaded.on("movestart", (e) => {
          if (!e.originalEvent) return;
          userMovedRef.current = true;
          tapMovedRef.current = true;
        });
        // 印の上の操作は印が受け持つ。何もない所を触ったときだけ知らせる
        loaded.on("click", (e) => {
          const target = e.originalEvent.target as HTMLElement | null;
          if (target?.closest(".maplibregl-marker")) return;
          handleTapAt(
            loaded,
            e.point.x,
            e.point.y,
            null,
            callbacksRef.current,
            shownPlacesRef.current,
          );
        });
      })
      .catch(() => {});
    return () => {
      disposed = true;
      instance?.remove();
      setMap(null);
    };
  }, [geo]);

  const dimmed = sections.features.length > 0;
  useEffect(() => {
    if (map) applyPaint(map, palette, lineFocus, dimmed);
  }, [map, palette, lineFocus, dimmed]);

  // 駅の間の候補を光らせる。描けた区間の数と一番強い区間は、e2e が確かめられるよう属性に出す
  const [sectionShown, setSectionShown] = useState({ count: 0, focus: "" });
  useEffect(() => {
    if (!map) return;
    map.getSource<GeoJSONSource>(sourceIds.section)?.setData(sections);
    const read = () => {
      const rendered = map.queryRenderedFeatures({ layers: [sectionLayers.line] });
      const keys = new Set(rendered.map((f) => String(f.properties.key)));
      const focused = rendered.find((f) => f.properties.strength === SECTION_FOCUS_STRENGTH);
      setSectionShown({ count: keys.size, focus: String(focused?.properties.key ?? "") });
    };
    map.on("idle", read);
    map.triggerRepaint();
    return () => {
      map.off("idle", read);
    };
  }, [map, sections]);

  // 線を押した点に、波紋の印を一瞬だけ出す。動きを減らす設定では動かさずに出して消す
  // 印は押した点の緯度経度に結び付け、地図が動くたびに画面の位置を直す
  const [ripple, setRipple] = useState<{ position: Position; id: string } | null>(null);
  const rippleRef = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    if (!map || !tapPoint) return;
    setRipple({ position: tapPoint, id: tapPoint.join(",") });
    const timer = window.setTimeout(() => setRipple(null), tapRippleMs);
    // 消える前に候補を閉じても、印を残さない
    return () => {
      window.clearTimeout(timer);
      setRipple(null);
    };
  }, [map, tapPoint]);
  useEffect(() => {
    if (!map || !ripple) return;
    const place = () => {
      const element = rippleRef.current;
      if (!element) return;
      const { x, y } = map.project(ripple.position);
      element.style.left = `${x - 10}px`;
      element.style.top = `${y - 10}px`;
    };
    place();
    map.on("move", place);
    return () => {
      map.off("move", place);
    };
  }, [map, ripple]);

  // 地図か一覧で選んでいる駅の間を、点線で描く
  const selectedSegment = segments.find((s) => s.selected) ?? null;
  useEffect(() => {
    if (!map) return;
    const features = selectedSegment
      ? [
          {
            type: "Feature" as const,
            geometry: {
              type: "LineString" as const,
              coordinates: selectedSegment.path,
            },
            properties: {},
          },
        ]
      : [];
    map
      .getSource<GeoJSONSource>(sourceIds.segment)
      ?.setData({ type: "FeatureCollection", features });
  }, [map, selectedSegment]);

  // 行き先を選んだら、出発と行き先を弧で結ぶ
  const origin = place?.position ?? null;
  const showTrip = situationStages.has(stage) && destination !== null;
  const destinationPosition = destination?.position ?? null;
  useEffect(() => {
    if (!map) return;
    const features =
      showTrip && origin && destinationPosition
        ? [
            {
              type: "Feature" as const,
              geometry: {
                type: "LineString" as const,
                coordinates: buildTripArc(origin, destinationPosition),
              },
              properties: {},
            },
          ]
        : [];
    map.getSource<GeoJSONSource>(sourceIds.trip)?.setData({ type: "FeatureCollection", features });
  }, [map, showTrip, origin, destinationPosition]);

  // 段が変わるたびに視点を寄せる
  const { top, right, bottom, left } = insets;
  const stopKey = [...stops.map((s) => s.key), ...focus.map((p) => p.join(":"))].join(",");
  // 段と札が同じで、余白だけが変わったかを見分ける
  const sceneKey = JSON.stringify([
    situationStages.has(stage) ? "situation" : stage,
    area?.id,
    area?.center,
    place?.key,
    origin,
    stopKey,
    showTrip ? destinationPosition : null,
    stage === "between" ? betweenFocus : null,
  ]);
  const tapKey = tapPoint?.join(",") ?? "";
  const cameraKey = JSON.stringify([sceneKey, top, right, bottom, left, tapKey]);
  const firstFitRef = useRef(true);
  const userMovedRef = useRef(false);
  const lastSceneRef = useRef<string | null>(null);
  // 線を押して候補を出してから、利用者が地図を動かしたか。押すたびに戻す
  const lastTapRef = useRef("");
  const tapMovedRef = useRef(false);
  // biome-ignore lint/correctness/useExhaustiveDependencies: 視点は cameraKey が変わったときだけ動かす
  useEffect(() => {
    if (!map) return;
    const sameScene = lastSceneRef.current === sceneKey;
    // 線を押して候補を出している間は、段の寄せ方をしない。駅の印が出る倍率なら、倍率を保ったまま押した点を見える所に置く
    // 引いた地図なら、候補の区間が見える倍率まで寄せる
    // 候補を出した後に利用者が地図を動かしていれば、シートの高さが変わっても動かさない
    if (tapPoint && sameScene) {
      if (lastTapRef.current !== tapKey) tapMovedRef.current = false;
      lastTapRef.current = tapKey;
      if (!tapMovedRef.current) {
        const duration = prefersReducedMotion() ? 0 : durationMs;
        const current = { top, right, bottom, left };
        const sectionPoints = sections.features.flatMap((f) => f.geometry.coordinates);
        if (map.getZoom() < BETWEEN_PICK_MIN_ZOOM && sectionPoints.length > 0)
          approachSections(map, tapPoint, sectionPoints, current, duration);
        else keepPointVisible(map, tapPoint, current, duration);
      }
      return;
    }
    lastTapRef.current = tapKey;
    // 利用者が地図を動かした後に余白だけが変わったときは、見ている所を保つ
    if (userMovedRef.current && sameScene) return;
    lastSceneRef.current = sceneKey;
    userMovedRef.current = false;
    const duration = firstFitRef.current || prefersReducedMotion() ? 0 : durationMs;
    firstFitRef.current = false;
    const current = { top, right, bottom, left };
    // 駅の間の段は、前に選んだ所か大阪駅のあたりへ、駅の印が出る倍率で寄せる
    // 線を押して問いが出ただけなら、押した線が動かないよう見ている所を保つ
    if (stage === "between") {
      if (sameScene) return;
      map.flyTo({
        center: betweenFocus ?? betweenCenter,
        zoom: Math.max(map.getZoom(), betweenZoom),
        offset: buildOffset(current),
        duration,
      });
      return;
    }
    if (showTrip && origin && destinationPosition) {
      const bounds = computeBounds(buildTripArc(origin, destinationPosition));
      if (bounds) {
        map.fitBounds(bounds, {
          padding: buildPadding(map, current, narrow ? { x: 56, y: 64 } : { x: 120, y: 80 }),
          maxZoom: 13.5,
          duration,
        });
      }
      return;
    }
    // 方面・行き先・近い駅の段は、選んだ駅と札を収める
    if ((stops.length > 0 || focus.length > 0) && origin) {
      const bounds = computeBounds([origin, ...focus, ...stops.map((s) => s.position)]);
      if (bounds) {
        map.fitBounds(bounds, {
          padding: buildPadding(
            map,
            current,
            props.stopMargin ?? { x: labelMargin.x + 24, y: labelMargin.y + 12 },
          ),
          maxZoom: 15,
          duration,
        });
      }
      return;
    }
    // 駅の段は、選んだ駅とそのまわりの駅を、名前の札が上部の帯やシートに隠れない余白で収める
    if (stage !== "area" && stage !== "kansai" && place) {
      const nearby = (area?.places ?? []).filter(
        (p) => computeDistanceMeters(p.position, place.position) <= nearbyMeters,
      );
      const bounds = computeBounds([place.position, ...nearby.map((p) => p.position)]);
      if (bounds) {
        map.fitBounds(bounds, {
          padding: buildPadding(map, current, { x: labelMargin.x + 16, y: labelMargin.y + 12 }),
          maxZoom: 16,
          duration,
        });
      }
      return;
    }
    if (stage === "area" && area) {
      flyToArea(map, area, current, duration);
      return;
    }
    // 大阪の中心の丸だけを収める。見える範囲の外の京都や三ノ宮は、画面の縁の札で示す
    const bounds = computeBounds(hubs.filter((h) => h.core).map((h) => h.position));
    if (bounds) {
      map.fitBounds(bounds, {
        padding: buildPadding(map, current, narrow ? { x: 90, y: 56 } : { x: 160, y: 80 }),
        maxZoom: 11.6,
        duration,
      });
    }
  }, [map, cameraKey]);

  // 見える範囲の外にある丸は、その向きの画面の縁に札を出す
  // 地図の上の丸は、縁の札と互いの札を避ける向きにし、収まらない丸は出さない
  const [edgeHubs, setEdgeHubs] = useState<EdgeHub[]>([]);
  const [hubLabels, setHubLabels] = useState<HubLabel[]>([]);
  useEffect(() => {
    if (!map || (stage !== "kansai" && stage !== "area")) {
      setEdgeHubs([]);
      setHubLabels([]);
      hubBlockersRef.current = { rects: [], targets: [] };
      return;
    }
    const update = () => {
      const canvas = map.getCanvas();
      const project = (p: Position) => map.project(p);
      const edges =
        stage === "kansai"
          ? placeEdgeHubs(
              hubs,
              project,
              { width: canvas.clientWidth, height: canvas.clientHeight },
              { top, bottom, left },
              locale,
            )
          : [];
      setEdgeHubs(edges);
      const onEdge = new Set(edges.map((e) => e.hub.areaId));
      const labels = selectVisibleHubs({
        hubs: hubs.filter((h) => !onEdge.has(h.areaId)),
        edges: edges.map((e) => buildEdgeHubRect(e, locale)),
        project,
        view: {
          left: left + 8,
          top: top + 8,
          right: canvas.clientWidth - right - 8,
          bottom: canvas.clientHeight - bottom - mapAttributionHeight - 8,
        },
        locale,
        narrow,
      });
      setHubLabels(labels);
      hubBlockersRef.current = {
        rects: [
          ...edges.map((e) => buildEdgeHubRect(e, locale)),
          ...labels.flatMap((l) => [l.box, l.dot]),
        ],
        targets: labels.map((l) => ({ point: project(l.hub.position), ...hubTarget })),
      };
    };
    update();
    map.on("move", update);
    return () => {
      map.off("move", update);
    };
  }, [map, stage, hubs, top, right, bottom, left, locale, narrow]);

  useEffect(() => {
    if (!map) return;
    const update = () => {
      const currentZoom = map.getZoom();
      setZoom(currentZoom);
      const { lng, lat } = map.getCenter();
      setCenter((prev) => (prev[0] === lng && prev[1] === lat ? prev : [lng, lat]));
      const canvas = map.getCanvas();
      setVisiblePlaces(
        selectVisibleStations({
          stations: props.stations,
          zoom: currentZoom,
          view: {
            left: left + 8,
            top: top + 8,
            right: canvas.clientWidth - right - 8,
            bottom: canvas.clientHeight - bottom - mapAttributionHeight - 8,
          },
          project: (position) => map.project(position),
          locale,
          selectedKey: stage === "station" ? place?.key : undefined,
          priorityKeys: stage === "kansai" ? [] : (area?.places.map((p) => p.key) ?? []),
          ...((stage === "kansai" || stage === "area") && currentZoom < STATION_LABEL_MIN_ZOOM
            ? { blockers: hubBlockersRef.current.rects, targets: hubBlockersRef.current.targets }
            : {}),
        }),
      );
      // 選んだ駅の名前の札を避けて、画面の上で重ならない駅の札だけを出す
      const selectedShown = place && stage !== "kansai" && stage !== "area" && stage !== "station";
      const blockers = selectedShown
        ? [
            buildStopLabelRect(
              map.project(place.position),
              `${hereLabel}${pickPlaceName(place, locale)}${"　".repeat(place.lines.length)}`,
              placeSide ?? place.side[narrow ? "narrow" : "wide"],
            ),
          ]
        : [];
      const next = selectVisibleStops({
        stops,
        project: (position) => map.project(position),
        blockers,
        view: {
          left: left + 8,
          top: top + 8,
          right: canvas.clientWidth - right - 8,
          bottom: canvas.clientHeight - bottom - mapAttributionHeight - 8,
        },
      });
      // 出す札が同じなら配列を差し替えず、印を作り直さない
      setVisibleStops((prev) => keepStopsIfSame(prev, next));
      // 札の押せる丸は、隣の札と選んだ駅の印に届かない大きさにする
      const placePoints = selectedShown ? [map.project(place.position)] : [];
      const radii = computeStopHitRadii(
        next.map((s) => map.project(s.position)),
        placePoints,
      );
      const nextRadii = Object.fromEntries(next.map((s, i) => [s.key, radii[i] ?? 24]));
      const [placePoint] = placePoints;
      const placeRadius = placePoint
        ? (computeStopHitRadii(
            [placePoint],
            next.map((s) => map.project(s.position)),
          )[0] ?? markerHitRadius)
        : markerHitRadius;
      setPlaceHitRadius(placeRadius);
      setStopRadii((prev) =>
        JSON.stringify(prev) === JSON.stringify(nextRadii) ? prev : nextRadii,
      );
      // 駅の間の丸は、駅の印と札の押せる丸に届かず、ほかの駅の間の丸とは中点の内側に収める
      const markers = [
        ...(place ? [{ point: map.project(place.position), radius: placeRadius }] : []),
        ...next.map((s, i) => ({ point: map.project(s.position), radius: radii[i] ?? 0 })),
      ];
      const segmentRadiiNext = computeSegmentHitRadii(
        segments.map((segment) => map.project(segment.position)),
        markers,
      );
      // 押せる丸が取れない駅の間は、丸を押すとまずそこへ寄せる。下の駅の押せる丸に押させない
      const approachRadii = computeSegmentApproachRadii(
        segments.map((segment) => map.project(segment.position)),
        markers.map((m) => m.point),
      );
      const targets = segments.map((segment, i) => ({
        key: segment.key,
        radius: segmentRadiiNext[i] ?? 0,
        approach: approachRadii[i] ?? 0,
      }));
      setSegmentRadii((prev) =>
        prev.length === targets.length &&
        prev.every(
          (t, i) =>
            t.key === targets[i]?.key &&
            t.radius === targets[i]?.radius &&
            t.approach === targets[i]?.approach,
        )
          ? prev
          : targets,
      );
    };
    update();
    map.on("moveend", update);
    map.on("resize", update);
    return () => {
      map.off("moveend", update);
      map.off("resize", update);
    };
  }, [
    map,
    props.stations,
    top,
    right,
    bottom,
    left,
    locale,
    stage,
    place,
    area,
    stops,
    segments,
    narrow,
    hereLabel,
    placeSide,
  ]);

  // 視点が動いている間は印を出し、段の切り替え直後の寄せと指の操作がぶつからないようにする
  const [moving, setMoving] = useState(false);
  useEffect(() => {
    if (!map) return;
    const start = () => setMoving(true);
    const end = () => setMoving(false);
    setMoving(map.isMoving());
    map.on("movestart", start);
    map.on("moveend", end);
    return () => {
      map.off("movestart", start);
      map.off("moveend", end);
    };
  }, [map]);

  // 引いた地図で駅の間の丸を押したとき。駅は選ばず、丸が押せる大きさになるまでそこへ寄せる
  // 最初の段で引いた地図の線を押したときと同じく、まず寄せてから選ばせる
  const approachSegment = (segment: MapSegment) => {
    if (!map) return;
    userMovedRef.current = true;
    lastSceneRef.current = sceneKey;
    const point = map.project(segment.position);
    const markerPoints = [
      ...(place ? [map.project(place.position)] : []),
      ...visibleStops.map((s) => map.project(s.position)),
    ];
    const otherPoints = segments
      .filter((s) => s.key !== segment.key)
      .map((s) => map.project(s.position));
    map.flyTo({
      center: segment.position,
      zoom: computeSegmentApproachZoom({
        zoom: map.getZoom(),
        point,
        markerPoints,
        otherPoints,
        maxZoom: map.getMaxZoom(),
      }),
      offset: buildOffset({ top, right, bottom, left }),
      duration: prefersReducedMotion() ? 0 : durationMs,
    });
  };

  // 駅の印の丸は駅を選ぶ。札は、札の下に描いた線があれば線を押したとみなす
  // 駅を受け付けない段では、地図に出した駅の印と札の上も、線を押したかで決める
  const tapPlace = (place: EntryPlace, tap: PlaceTap) => {
    const shown = shownPlacesRef.current.some((v) => v.place.key === place.key);
    const passThrough = shown && props.placePickable === false;
    if (!map || !tap || (!tap.label && !passThrough)) {
      props.onSelectPlace(place);
      return;
    }
    const rect = map.getCanvas().getBoundingClientRect();
    handleTapAt(
      map,
      tap.clientX - rect.left,
      tap.clientY - rect.top,
      passThrough ? null : place,
      props,
      shownPlacesRef.current,
    );
  };

  props.apiRef.current = {
    zoomToOrigin: (zoom) =>
      new Promise((resolve) => {
        if (!map || !origin || prefersReducedMotion()) {
          resolve();
          return;
        }
        // 別の視点の動きに割り込まれて moveend が来ないときも、動きの長さを過ぎたら先へ進む
        const timer = setTimeout(resolve, durationMs + 300);
        map.once("moveend", () => {
          clearTimeout(timer);
          resolve();
        });
        map.flyTo({
          center: origin,
          zoom,
          offset: buildOffset({ top, right, bottom, left }),
          duration: durationMs,
        });
      }),
  };

  // 段ごとの印。関西は大きな丸、エリアと駅は駅の丸、行き先を選んだら出発と行き先だけ
  const entries = useMemo(() => {
    type Entry = {
      key: string;
      position: Position;
      anchor: "center" | "bottom";
      offset: [number, number];
    };
    const at = (key: string, position: Position): Entry => ({
      key,
      position,
      anchor: "center",
      offset: [0, 0],
    });
    // 引いた地図は丸と主要な駅を出す。縁の札で示す丸と、札が収まらない丸は地図の上に出さない
    if ((stage === "kansai" || stage === "area") && zoom < STATION_LABEL_MIN_ZOOM) {
      return [
        ...hubLabels.map(({ hub }) => at(`hub:${hub.areaId}`, hub.position)),
        ...visiblePlaces.map((v) => at(`place:${v.place.key}`, v.place.position)),
      ];
    }
    // 駅を選んだあとは、選んだ駅と札だけを出す
    const places = placesShown ? visiblePlaces.map((v) => v.place) : place ? [place] : [];
    const list = places.map((p) => at(`place:${p.key}`, p.position));
    if (!showTrip) {
      for (const s of visibleStops) list.push(at(`stop:${s.key}`, s.position));
      for (const { key } of segmentRadii) {
        const segment = segments.find((s) => s.key === key);
        if (segment) list.push(at(`segment:${key}`, segment.position));
      }
    }
    if (showTrip && destinationPosition) {
      list.push({
        key: "destination",
        position: destinationPosition,
        anchor: "bottom",
        offset: [0, 4],
      });
    }
    return list;
  }, [
    stage,
    hubLabels,
    visiblePlaces,
    zoom,
    place,
    showTrip,
    destinationPosition,
    visibleStops,
    segmentRadii,
    segments,
    placesShown,
  ]);
  const hosts = useMarkerHosts(map, markerClass, entries);
  // 印は込み合うので、四角い入れ物は触れず、丸いボタンと札だけが押せるようにする
  // 駅の間の丸は駅の印より手前に置き、重なっても丸を押せるようにする
  useEffect(() => {
    for (const [key, element] of hosts) {
      if (key !== "destination") element.style.pointerEvents = "none";
      if (key.startsWith("segment:")) element.style.zIndex = "1";
    }
  }, [hosts]);
  const side = narrow ? "narrow" : "wide";

  return (
    <section
      data-testid={testIds.start.map}
      data-stage={stage}
      data-ready={map !== null}
      data-detail={zoom >= STATION_LABEL_MIN_ZOOM ? "stations" : "areas"}
      data-zoom={zoom.toFixed(2)}
      data-center={center.map((v) => v.toFixed(6)).join(",")}
      data-moving={moving}
      data-section-count={sectionShown.count}
      data-section-focus={sectionShown.focus}
      aria-label={t("mapLabel")}
      className="fixed inset-0 z-0 bg-background"
    >
      <div ref={containerRef} className="h-full w-full" />
      {ripple && (
        <span
          key={ripple.id}
          ref={rippleRef}
          aria-hidden
          data-testid={testIds.start.tapRipple}
          className="pointer-events-none absolute z-[4] size-5 rounded-full border-2 border-foreground/70 bg-foreground/15 motion-safe:animate-tap-ripple"
        />
      )}
      {(zoom < STATION_LABEL_MIN_ZOOM ? edgeHubs : []).map(({ hub, x, y, angle }) => (
        <button
          key={hub.areaId}
          type="button"
          data-testid={testIds.start.hubEdge(hub.areaId)}
          onClick={() => props.onSelectHub(hub.areaId)}
          style={{ left: x, top: y }}
          className="glass-strong absolute z-[5] flex h-11 -translate-x-1/2 -translate-y-1/2 animate-fade-in items-center gap-1.5 rounded-full pr-3.5 pl-2.5 text-[14px] font-bold whitespace-nowrap transition-transform duration-150 active:scale-95"
        >
          <ArrowUp
            className="size-4 text-brand"
            strokeWidth={2.5}
            style={{ transform: `rotate(${angle + 90}deg)` }}
            aria-hidden
          />
          {pickLocalized(hub.label, locale)}
        </button>
      ))}
      {[...hosts.entries()].map(([key, element]) => {
        if (key === "destination" && destination) {
          return createPortal(<DestinationMarker label={destination.label} />, element, key);
        }
        if (key.startsWith("hub:")) {
          const hubLabel = hubLabels.find((l) => `hub:${l.hub.areaId}` === key);
          if (!hubLabel) return null;
          const { hub } = hubLabel;
          return createPortal(
            <HubMarker
              areaId={hub.areaId}
              label={pickLocalized(hub.label, locale)}
              side={hubLabel.side}
              slide={hubLabel.slide}
              onSelect={() => props.onSelectHub(hub.areaId)}
            />,
            element,
            key,
          );
        }
        if (key.startsWith("segment:")) {
          const segment = segments.find((s) => `segment:${s.key}` === key);
          const target = segmentRadii.find((r) => `segment:${r.key}` === key);
          if (!segment || !target) return null;
          const pickable = target.radius > 0;
          return createPortal(
            <SegmentMarker
              segmentKey={segment.key}
              label={segment.label}
              color={segment.color}
              selected={segment.selected}
              hitRadius={target.radius}
              approachRadius={pickable ? 0 : target.approach}
              onSelect={() =>
                pickable ? props.onSelectSegment(segment.key) : approachSegment(segment)
              }
            />,
            element,
            key,
          );
        }
        if (key.startsWith("stop:")) {
          const target = visibleStops.find((s) => `stop:${s.key}` === key);
          if (!target) return null;
          return createPortal(
            <StopMarker
              stopKey={target.key}
              label={target.label}
              side={target.side}
              color={target.color}
              angle={target.angle}
              line={target.kind === "line"}
              hitRadius={stopRadii[target.key]}
              labelHidden={target.labelHidden}
              onSelect={() => props.onSelectStop(target.key)}
            />,
            element,
            key,
          );
        }
        // 駅を選んだあとの選んだ駅は、設定の向きの大きな札で出す
        const visible =
          (placesShown ? visiblePlaces.find((v) => `place:${v.place.key}` === key) : null) ??
          (place && `place:${place.key}` === key
            ? {
                place,
                major: true,
                hitRadius: placeHitRadius,
                markRadius: placeHitRadius,
                label: {
                  side: placeSide ?? place.side[side],
                  size: "large" as const,
                  slide: 0,
                  tappable: true,
                },
              }
            : null);
        if (!visible) return null;
        const target = visible.place;
        const selected = place?.key === target.key;
        return createPortal(
          <PlaceMarker
            placeKey={target.key}
            label={pickPlaceName(target, locale)}
            layout={visible.label}
            major={visible.major}
            hitRadius={visible.markRadius}
            colors={[...new Set(target.lines.map((l) => l.color))]}
            selected={selected}
            dim={place !== null && !selected}
            hereLabel={t("here")}
            onSelect={(tap) => tapPlace(target, tap)}
          />,
          element,
          key,
        );
      })}
      <MapAttribution labels={labels.attribution} insets={{ bottom, left, right }} />
    </section>
  );
}
