import type {
  ExpressionSpecification,
  FilterSpecification,
  LayerSpecification,
  StyleSpecification,
} from "maplibre-gl";

// MapLibre のスタイルとレイヤー定義。色はテーマごとの配色から作る

export type MapTheme = "dark" | "light";

export type MapPalette = {
  background: string;
  rasterBrightnessMax: number;
  rasterSaturation: number;
  lineOpacity: number;
  reach: string;
  transfer: string;
  route: string;
  routeCasing: string;
  blocked: string;
  blockedCasing: string;
  stationFill: string;
  emphasisStroke: string;
  origin: string;
  destination: string;
  placeStroke: string;
  text: string;
  textHalo: string;
};

export const mapPalettes: Record<MapTheme, MapPalette> = {
  dark: {
    background: "#0d1218",
    // 淡色地図を暗く沈め、路線と重ねる情報を浮かせる
    rasterBrightnessMax: 0.3,
    rasterSaturation: -0.8,
    lineOpacity: 0.9,
    reach: "#8ccbff",
    transfer: "#ffbe5c",
    route: "#2ee6a6",
    routeCasing: "#04130d",
    blocked: "#ff5a4f",
    blockedCasing: "#1a0605",
    stationFill: "#0d1218",
    emphasisStroke: "#ffffff",
    origin: "#ffffff",
    destination: "#ffbe5c",
    placeStroke: "#0d1218",
    text: "#f2f5f8",
    textHalo: "#0d1218",
  },
  light: {
    background: "#f5f7f9",
    rasterBrightnessMax: 1,
    rasterSaturation: -0.4,
    lineOpacity: 0.95,
    reach: "#2b7bc4",
    transfer: "#e5952a",
    route: "#007a4d",
    routeCasing: "#ffffff",
    blocked: "#d4251a",
    blockedCasing: "#ffffff",
    stationFill: "#ffffff",
    emphasisStroke: "#0a1016",
    origin: "#0a1016",
    destination: "#b35c00",
    placeStroke: "#ffffff",
    text: "#0a1016",
    textHalo: "#ffffff",
  },
};

export const sourceIds = {
  gsi: "gsi-pale",
  lines: "lines",
  stations: "stations",
  reach: "walk-reach",
  blocked: "blocked-section",
  route: "recommended-route",
  reachable: "reachable-stations",
  places: "places",
  labels: "station-labels",
} as const;

export const transferHaloLayerId = "transfer-halo";

// 地理院タイル（淡色地図）。ズーム 5〜18 で提供される
const gsiPaleTiles = "https://cyberjapandata.gsi.go.jp/xyz/pale/{z}/{x}/{y}.png";

// glyphs を指定しないので、文字はすべて端末のフォントで描かれる。名前の並びが CSS の font-family になる
// 太字は先頭の名前に含まれる Bold から判定される
const fontRegular = ["Hiragino Sans", "Noto Sans JP", "sans-serif"];
const fontBold = ["Hiragino Sans Bold", "Hiragino Sans", "Noto Sans JP", "sans-serif"];

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
          "raster-brightness-max": palette.rasterBrightnessMax,
          "raster-saturation": palette.rasterSaturation,
          "raster-fade-duration": 0,
        },
      },
    ],
  };
}

export function buildTransferFilter(lineIds: readonly string[]): FilterSpecification {
  return ["in", ["get", "lineId"], ["literal", [...lineIds]]];
}

const byZoom = (low: number, high: number): ExpressionSpecification => [
  "interpolate",
  ["linear"],
  ["zoom"],
  9,
  low,
  14,
  high,
];

// 重ねる順（下から）: 到達範囲 → 振替対象 → 路線 → 推奨経路 → 止まっている区間 → 駅 → 文字
export function buildDataLayers(palette: MapPalette): LayerSpecification[] {
  const labelPaint = {
    "text-color": palette.text,
    "text-halo-color": palette.textHalo,
    "text-halo-width": 1.6,
  };
  const stationLabelLayout = {
    "text-field": ["get", "name"],
    "text-font": ["case", ["get", "emphasis"], ["literal", fontBold], ["literal", fontRegular]],
    "text-size": [
      "case",
      ["get", "emphasis"],
      13,
      ["step", ["get", "passengers"], 11, 200000, 12.5],
    ],
    "symbol-sort-key": ["get", "sortKey"],
    "text-variable-anchor": ["top", "bottom", "right", "left"],
    "text-radial-offset": 0.6,
    "text-padding": 3,
  } as const;

  return [
    {
      id: "walk-reach-fill",
      type: "fill",
      source: sourceIds.reach,
      paint: {
        "fill-color": palette.reach,
        "fill-opacity": ["match", ["get", "minutes"], 10, 0.18, 0.08],
      },
    },
    {
      id: "walk-reach-outline",
      type: "line",
      source: sourceIds.reach,
      paint: {
        "line-color": palette.reach,
        "line-width": 1.5,
        "line-dasharray": [2, 2],
        "line-opacity": 0.9,
      },
    },
    {
      id: transferHaloLayerId,
      type: "line",
      source: sourceIds.lines,
      filter: buildTransferFilter([]),
      layout: { "line-cap": "round", "line-join": "round" },
      paint: { "line-color": palette.transfer, "line-width": 12, "line-opacity": 0.55 },
    },
    {
      id: "rail-lines",
      type: "line",
      source: sourceIds.lines,
      layout: { "line-cap": "round", "line-join": "round" },
      paint: {
        "line-color": ["get", "color"],
        "line-width": byZoom(1.6, 4),
        "line-opacity": palette.lineOpacity,
      },
    },
    {
      id: "route-casing",
      type: "line",
      source: sourceIds.route,
      filter: ["!=", ["get", "mode"], "walk"],
      layout: { "line-cap": "round", "line-join": "round" },
      paint: { "line-color": palette.routeCasing, "line-width": 9 },
    },
    {
      id: "route-ride",
      type: "line",
      source: sourceIds.route,
      filter: ["==", ["get", "mode"], "ride"],
      layout: { "line-cap": "round", "line-join": "round" },
      paint: { "line-color": palette.route, "line-width": 5 },
    },
    {
      id: "route-taxi",
      type: "line",
      source: sourceIds.route,
      filter: ["==", ["get", "mode"], "taxi"],
      paint: { "line-color": palette.route, "line-width": 5, "line-dasharray": [2, 1] },
    },
    {
      id: "route-walk",
      type: "line",
      source: sourceIds.route,
      filter: ["==", ["get", "mode"], "walk"],
      layout: { "line-cap": "round", "line-join": "round" },
      paint: { "line-color": palette.route, "line-width": 5, "line-dasharray": [0, 2] },
    },
    {
      id: "blocked-casing",
      type: "line",
      source: sourceIds.blocked,
      layout: { "line-cap": "round", "line-join": "round" },
      paint: { "line-color": palette.blockedCasing, "line-width": 10 },
    },
    {
      id: "blocked-line",
      type: "line",
      source: sourceIds.blocked,
      layout: { "line-join": "round" },
      paint: { "line-color": palette.blocked, "line-width": 6, "line-dasharray": [1.6, 1] },
    },
    {
      id: "stations",
      type: "circle",
      source: sourceIds.stations,
      minzoom: 10,
      paint: {
        "circle-radius": byZoom(1.5, 4),
        "circle-color": palette.stationFill,
        "circle-stroke-color": ["get", "color"],
        "circle-stroke-width": 1.5,
      },
    },
    {
      id: "reachable-stations",
      type: "circle",
      source: sourceIds.reachable,
      paint: {
        "circle-radius": 6,
        "circle-color": ["get", "color"],
        "circle-stroke-color": palette.emphasisStroke,
        "circle-stroke-width": 2.5,
      },
    },
    {
      id: "places",
      type: "circle",
      source: sourceIds.places,
      paint: {
        "circle-radius": 9,
        "circle-color": ["match", ["get", "role"], "origin", palette.origin, palette.destination],
        "circle-stroke-color": palette.placeStroke,
        "circle-stroke-width": 3,
      },
    },
    // 文字は上のレイヤーほど先に配置される。乗降客数の少ない駅はズームしてから出す
    {
      id: "station-labels-minor",
      type: "symbol",
      source: sourceIds.labels,
      minzoom: 12,
      filter: ["all", ["!", ["get", "emphasis"]], ["<", ["get", "passengers"], 50000]],
      layout: stationLabelLayout,
      paint: labelPaint,
    },
    {
      id: "station-labels-major",
      type: "symbol",
      source: sourceIds.labels,
      filter: ["any", ["get", "emphasis"], [">=", ["get", "passengers"], 50000]],
      layout: stationLabelLayout,
      paint: labelPaint,
    },
    {
      id: "blocked-label",
      type: "symbol",
      source: sourceIds.blocked,
      layout: {
        "symbol-placement": "line-center",
        "text-field": ["get", "label"],
        "text-font": fontBold,
        "text-size": 13,
        "text-offset": [0, -1.1],
        "text-keep-upright": true,
      },
      paint: {
        "text-color": palette.blocked,
        "text-halo-color": palette.textHalo,
        "text-halo-width": 2,
      },
    },
    {
      id: "place-labels",
      type: "symbol",
      source: sourceIds.places,
      layout: {
        "text-field": ["get", "label"],
        "text-font": fontBold,
        "text-size": 14,
        "text-anchor": "bottom",
        "text-offset": [0, -1],
        "text-allow-overlap": true,
      },
      paint: { ...labelPaint, "text-halo-width": 2.2 },
    },
  ] as LayerSpecification[];
}

// テーマが変わったときに塗りの値だけを入れ替えるための一覧
export function listPaintValues(
  palette: MapPalette,
): { layerId: string; key: string; value: unknown }[] {
  const layers = [...buildBaseStyle(palette).layers, ...buildDataLayers(palette)];
  return layers.flatMap((layer) =>
    Object.entries(("paint" in layer ? layer.paint : undefined) ?? {}).map(([key, value]) => ({
      layerId: layer.id,
      key,
      value,
    })),
  );
}
