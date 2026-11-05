import type { Action } from "@repo/schema";
import type {
  ExpressionSpecification,
  FilterSpecification,
  LayerSpecification,
  StyleSpecification,
} from "maplibre-gl";

// MapLibre のスタイルとレイヤー定義。色はテーマごとの配色から作る
// 背景と路線は無彩色で沈め、色は止まっている区間と経路にだけ使う

export type MapTheme = "dark" | "light";

export type MapPalette = {
  background: string;
  rasterBrightnessMin: number;
  rasterBrightnessMax: number;
  rasterContrast: number;
  rail: string;
  railOpacity: number;
  reach: string;
  route: Record<Action, string>;
  routeCasing: string;
  alternative: string;
  blocked: string;
  blockedCasing: string;
  stationFill: string;
  stationStroke: string;
  text: string;
  textMuted: string;
  textHalo: string;
};

export const mapPalettes: Record<MapTheme, MapPalette> = {
  light: {
    background: "#f1f1ef",
    // 淡色地図を灰色にし、暗い部分を持ち上げて白っぽく低いコントラストにする
    rasterBrightnessMin: 0.68,
    rasterBrightnessMax: 1,
    rasterContrast: -0.55,
    rail: "#71717a",
    railOpacity: 0.42,
    reach: "#2563eb",
    route: { wait: "#2563eb", switch: "#e8a20c", hold: "#7c3aed" },
    routeCasing: "#ffffff",
    alternative: "#71717a",
    blocked: "#dc2626",
    blockedCasing: "#ffffff",
    stationFill: "#ffffff",
    stationStroke: "#27272a",
    text: "#27272a",
    textMuted: "#71717a",
    textHalo: "#ffffff",
  },
  dark: {
    background: "#161618",
    // 明るさの上限と下限を逆にして、淡色地図を濃い灰色に反転させる
    rasterBrightnessMin: 0.24,
    rasterBrightnessMax: 0.09,
    rasterContrast: -0.3,
    rail: "#a1a1aa",
    railOpacity: 0.3,
    reach: "#60a5fa",
    route: { wait: "#3b82f6", switch: "#fbbf24", hold: "#8b5cf6" },
    routeCasing: "#f4f4f5",
    alternative: "#a1a1aa",
    blocked: "#ef4444",
    blockedCasing: "#161618",
    stationFill: "#18181b",
    stationStroke: "#f4f4f5",
    text: "#f4f4f5",
    textMuted: "#a1a1aa",
    textHalo: "#161618",
  },
};

export const sourceIds = {
  gsi: "gsi-pale",
  lines: "lines",
  reach: "walk-reach",
  blocked: "blocked-section",
  route: "recommended-route",
  routeLabel: "recommended-route-label",
  alternatives: "alternative-routes",
  keyStations: "key-stations",
  labels: "station-labels",
  guideWalk: "guide-walk",
  guideWalkLabels: "guide-walk-labels",
  guideStations: "guide-stations",
  reachLabels: "walk-reach-labels",
} as const;

// 地図の見せ方。focus は現在地のまわり、overview は行き先までの全体
export type MapView = "focus" | "overview";

export type MapMode = {
  view: MapView;
  // 現在地のまわりで路線色に塗る路線
  relevantLineIds: readonly string[];
  blockedLineIds: readonly string[];
};

const overviewMode: MapMode = { view: "overview", relevantLineIds: [], blockedLineIds: [] };

// 片方の見せ方でだけ出す層
// 選んだ経路は両方の見せ方で描く。徒歩は直線の点線を引かず、乗る駅の札が分数を示す
const focusOnlyLayerIds = new Set([
  "walk-reach-outline-20",
  "guide-station-dots",
  "walk-reach-labels",
]);
const overviewOnlyLayerIds = new Set([
  "alternative-routes",
  "route-label",
  "key-station-dots",
  "key-station-labels",
  // 現在地のまわりでは駅名を吹き出しが示すので、路線データの駅名は出さない
  "station-labels-major",
]);

function selectVisibility(layerId: string, view: MapView): "visible" | "none" {
  if (focusOnlyLayerIds.has(layerId)) return view === "focus" ? "visible" : "none";
  if (overviewOnlyLayerIds.has(layerId)) return view === "overview" ? "visible" : "none";
  return "visible";
}

// 経路の色を変える層。判断が変わったら塗りだけを差し替える
export const routeColorLayerIds = ["route-ride", "route-taxi"] as const;

// 地理院タイル（淡色地図）。低いコントラストで敷き、目印になる地名がうっすら見える程度にする
const gsiPaleTiles = "https://cyberjapandata.gsi.go.jp/xyz/pale/{z}/{x}/{y}.png";

// glyphs を指定しないので、文字はすべて端末のフォントで描かれる。名前の並びが CSS の font-family になる
// 太字は先頭の名前に含まれる Bold から判定される
const fontRegular = ["Hiragino Sans", "Noto Sans JP", "sans-serif"];
const fontBold = ["Hiragino Sans Bold", "Hiragino Sans", "Noto Sans JP", "sans-serif"];

// 経路の色の切り替えにかける時間
const colorTransition = { duration: 260, delay: 0 };

export function buildBaseStyle(palette: MapPalette): StyleSpecification {
  return {
    version: 8,
    sources: {
      [sourceIds.gsi]: {
        type: "raster",
        tiles: [gsiPaleTiles],
        tileSize: 256,
        minzoom: 5,
        maxzoom: 18,
      },
    },
    layers: [
      { id: "background", type: "background", paint: { "background-color": palette.background } },
      {
        id: "gsi-pale",
        type: "raster",
        source: sourceIds.gsi,
        paint: {
          "raster-saturation": -1,
          "raster-brightness-min": palette.rasterBrightnessMin,
          "raster-brightness-max": palette.rasterBrightnessMax,
          "raster-contrast": palette.rasterContrast,
          "raster-fade-duration": 0,
        },
      },
    ],
  };
}

// 線の太さは拡大率に合わせて指数で太らせる。引くと細く、寄ると太い
const byZoom = (low: number, high: number): ExpressionSpecification => [
  "interpolate",
  ["exponential", 1.5],
  ["zoom"],
  10,
  low,
  16,
  high,
];

const notWalk: FilterSpecification = ["!=", ["get", "mode"], "walk"];

// 並走する区間をずらす幅（px）。向きは経路の offset（1 は右、-1 は左）
const routeOffset: ExpressionSpecification = [
  "interpolate",
  ["linear"],
  ["zoom"],
  9,
  ["*", ["get", "offset"], 6],
  14,
  ["*", ["get", "offset"], 9],
];

// 重ねる順（下から）: 到達範囲 → 路線 → 代替経路 → 推奨経路 → 止まっている区間 → 駅 → 文字
export function buildDataLayers(
  palette: MapPalette,
  tone: Action = "wait",
  mode: MapMode = overviewMode,
): LayerSpecification[] {
  const accent = palette.route[tone];
  const halo = { "text-halo-color": palette.textHalo, "text-halo-width": 1.6 };
  const focus = mode.view === "focus";
  const relevant: ExpressionSpecification = [
    "in",
    ["get", "lineId"],
    ["literal", [...mode.relevantLineIds]],
  ];
  const blocked: ExpressionSpecification = [
    "in",
    ["get", "lineId"],
    ["literal", [...mode.blockedLineIds]],
  ];
  // 現在地のまわりでは、止まっている路線を赤、案内に出す路線を各社の色で細めに、ほかを細く淡い灰色にする
  // 強く描くのは止まっている区間と選んだ経路だけにする
  const railColor: ExpressionSpecification | string = focus
    ? ["case", blocked, palette.blocked, relevant, ["get", "color"], palette.rail]
    : palette.rail;
  // 全体を見る表示では、止まっている路線と乗る路線を残し、関係のない路線を細く淡くする
  // 関係する路線が分からないうちは、すべて同じ太さで描く
  const dimOthers = !focus && mode.relevantLineIds.length > 0;
  const kept: ExpressionSpecification = ["any", blocked, relevant];
  const railWidth: ExpressionSpecification = focus
    ? [
        "interpolate",
        ["exponential", 1.5],
        ["zoom"],
        10,
        ["case", blocked, 1.2, relevant, 1.2, 0.4],
        16,
        ["case", blocked, 4, relevant, 3.5, 1.2],
      ]
    : dimOthers
      ? [
          "interpolate",
          ["exponential", 1.5],
          ["zoom"],
          10,
          ["case", kept, 0.9, 0.4],
          16,
          ["case", kept, 2.5, 1.2],
        ]
      : byZoom(0.6, 2);
  const railOpacity: ExpressionSpecification | number = focus
    ? ["case", blocked, 0.3, relevant, 0.7, palette.railOpacity * 0.45]
    : dimOthers
      ? ["case", kept, palette.railOpacity, palette.railOpacity * 0.35]
      : palette.railOpacity;
  // 案内に出す路線にだけ白い縁を付け、背景の地図から浮かせる
  const railCasingOpacity: ExpressionSpecification | number = focus
    ? ["case", relevant, 0.85, 0]
    : 0;

  return [
    // 20 分の範囲だけを淡く塗り、10 分は細い輪郭だけにする
    {
      id: "walk-reach-fill",
      type: "fill",
      source: sourceIds.reach,
      filter: ["==", ["get", "minutes"], 20],
      paint: { "fill-color": palette.reach, "fill-opacity": 0.08 },
    },
    {
      id: "walk-reach-outline",
      type: "line",
      source: sourceIds.reach,
      filter: ["==", ["get", "minutes"], 10],
      paint: {
        "line-color": palette.reach,
        "line-width": 1,
        "line-dasharray": [2, 2],
        "line-opacity": 0.45,
      },
    },
    {
      id: "walk-reach-outline-20",
      type: "line",
      source: sourceIds.reach,
      filter: ["==", ["get", "minutes"], 20],
      paint: { "line-color": palette.reach, "line-width": 1, "line-opacity": 0.3 },
    },
    {
      id: "rail-lines-casing",
      type: "line",
      source: sourceIds.lines,
      layout: { "line-cap": "round", "line-join": "round" },
      paint: {
        "line-color": palette.routeCasing,
        "line-width": byZoom(3, 6.5),
        "line-opacity": railCasingOpacity,
      },
    },
    {
      id: "rail-lines",
      type: "line",
      source: sourceIds.lines,
      layout: { "line-cap": "round", "line-join": "round" },
      paint: {
        "line-color": railColor,
        "line-width": railWidth,
        "line-opacity": railOpacity,
      },
    },
    {
      id: "alternative-routes",
      type: "line",
      source: sourceIds.alternatives,
      layout: { "line-cap": "round", "line-join": "round" },
      paint: {
        "line-color": palette.alternative,
        "line-width": byZoom(1.5, 3),
        "line-opacity": 0.3,
      },
    },
    // 止まっている区間は細めの赤の破線にし、推奨経路の下に置く
    {
      id: "blocked-casing",
      type: "line",
      source: sourceIds.blocked,
      layout: { "line-cap": "round", "line-join": "round" },
      paint: { "line-color": palette.blockedCasing, "line-width": byZoom(5, 10) },
    },
    {
      id: "blocked-line",
      type: "line",
      source: sourceIds.blocked,
      layout: { "line-join": "round" },
      paint: {
        "line-color": palette.blocked,
        "line-width": byZoom(2.5, 5.5),
        "line-dasharray": [2, 1.4],
      },
    },
    // 推奨経路は止まっている区間と並走するところで横へずらし、重ならないようにする
    {
      id: "route-casing",
      type: "line",
      source: sourceIds.route,
      filter: notWalk,
      layout: { "line-cap": "round", "line-join": "round" },
      paint: {
        "line-color": palette.routeCasing,
        "line-width": byZoom(7, 13),
        "line-offset": routeOffset,
      },
    },
    {
      id: "route-ride",
      type: "line",
      source: sourceIds.route,
      filter: ["==", ["get", "mode"], "ride"],
      layout: { "line-cap": "round", "line-join": "round" },
      paint: {
        "line-color": accent,
        "line-color-transition": colorTransition,
        "line-width": byZoom(4, 8),
        "line-offset": routeOffset,
      },
    },
    {
      id: "route-taxi",
      type: "line",
      source: sourceIds.route,
      filter: ["==", ["get", "mode"], "taxi"],
      paint: {
        "line-color": accent,
        "line-color-transition": colorTransition,
        "line-width": byZoom(4, 8),
        "line-dasharray": [2, 1],
        "line-offset": routeOffset,
      },
    },
    {
      id: "guide-station-dots",
      type: "circle",
      source: sourceIds.guideStations,
      paint: {
        "circle-radius": ["case", ["get", "recommended"], 7, 5],
        "circle-color": palette.stationFill,
        "circle-stroke-color": ["get", "color"],
        "circle-stroke-width": ["case", ["get", "recommended"], 4, 3],
      },
    },
    // 乗換駅と止まっている区間の端は小さな丸。出発と行き先は画面側のピンで示す
    {
      id: "key-station-dots",
      type: "circle",
      source: sourceIds.keyStations,
      filter: ["match", ["get", "role"], ["transfer", "blocked-end"], true, false],
      paint: {
        "circle-radius": 4,
        "circle-color": palette.stationFill,
        "circle-stroke-color": [
          "match",
          ["get", "role"],
          "blocked-end",
          palette.blocked,
          palette.stationStroke,
        ],
        "circle-stroke-width": 2,
      },
    },
    // 主要駅の名前はズームしたときだけ出す
    {
      id: "station-labels-major",
      type: "symbol",
      source: sourceIds.labels,
      minzoom: 12.5,
      filter: [">=", ["get", "passengers"], 100000],
      layout: {
        "text-field": ["get", "name"],
        "text-font": fontRegular,
        "text-size": 11,
        "symbol-sort-key": ["get", "sortKey"],
        "text-variable-anchor": ["top", "bottom", "right", "left"],
        "text-radial-offset": 0.5,
        "text-padding": 4,
      },
      paint: { "text-color": palette.textMuted, ...halo },
    },
    {
      id: "route-label",
      type: "symbol",
      source: sourceIds.routeLabel,
      layout: {
        "text-field": ["get", "label"],
        "text-font": fontBold,
        "text-size": 12,
        "text-max-width": 20,
        "text-variable-anchor": ["bottom-left", "top-right", "bottom-right", "top-left"],
        "text-radial-offset": 1.1,
      },
      paint: {
        "text-color": accent,
        "text-color-transition": colorTransition,
        "text-halo-color": palette.textHalo,
        "text-halo-width": 2,
      },
    },
    {
      id: "key-station-labels",
      type: "symbol",
      source: sourceIds.keyStations,
      layout: {
        "text-field": ["get", "name"],
        "text-font": [
          "match",
          ["get", "role"],
          ["origin", "destination"],
          ["literal", fontBold],
          ["literal", fontRegular],
        ],
        "text-size": ["match", ["get", "role"], ["origin", "destination"], 14, 12],
        "symbol-sort-key": [
          "match",
          ["get", "role"],
          "origin",
          0,
          "destination",
          1,
          "transfer",
          2,
          3,
        ],
        "text-variable-anchor": ["left", "right", "top", "bottom"],
        "text-radial-offset": ["match", ["get", "role"], ["origin", "destination"], 1.2, 0.8],
        "text-padding": 2,
      },
      paint: {
        "text-color": ["match", ["get", "role"], "blocked-end", palette.blocked, palette.text],
        ...halo,
        "text-halo-width": 2,
      },
    },
    {
      id: "walk-reach-labels",
      type: "symbol",
      source: sourceIds.reachLabels,
      layout: {
        "text-field": ["get", "label"],
        "text-font": fontRegular,
        "text-size": 11,
        "text-allow-overlap": false,
      },
      paint: { "text-color": palette.reach, ...halo, "text-halo-width": 2 },
    },
  ].map((layer) =>
    focusOnlyLayerIds.has(layer.id) || overviewOnlyLayerIds.has(layer.id)
      ? {
          ...layer,
          layout: { ...(layer.layout ?? {}), visibility: selectVisibility(layer.id, mode.view) },
        }
      : layer,
  ) as LayerSpecification[];
}

// テーマ・判断・見せ方が変わったときに、塗りと表示の値だけを入れ替えるための一覧
export function listPaintValues(
  palette: MapPalette,
  tone: Action,
  mode: MapMode = overviewMode,
): { layerId: string; key: string; value: unknown; kind: "paint" | "layout" }[] {
  const layers = [...buildBaseStyle(palette).layers, ...buildDataLayers(palette, tone, mode)];
  return layers.flatMap((layer) => [
    ...Object.entries(("paint" in layer ? layer.paint : undefined) ?? {})
      .filter(([key]) => !key.endsWith("-transition"))
      .map(([key, value]) => ({ layerId: layer.id, key, value, kind: "paint" as const })),
    ...("layout" in layer && layer.layout && "visibility" in layer.layout
      ? [
          {
            layerId: layer.id,
            key: "visibility",
            value: layer.layout.visibility,
            kind: "layout" as const,
          },
        ]
      : []),
  ]);
}
