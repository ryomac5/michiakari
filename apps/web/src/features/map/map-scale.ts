import type { Map as MapLibreMap } from "maplibre-gl";

// スマホの地図の縮尺。線の太さと、円・印の大きさを 1 か所で決める
type PaintKey = Parameters<MapLibreMap["setPaintProperty"]>[1];

export const MOBILE_MAX_WIDTH = 640;
export const MAP_SCALE = {
  mobile: { line: 0.75, mark: 0.8 },
  desktop: { line: 1, mark: 1 },
} as const;

export type MapScale = { line: number; mark: number };

// 画面の幅が 640px 未満をスマホとみなす
export function pickMapScale(viewportWidth: number): MapScale {
  return viewportWidth < MOBILE_MAX_WIDTH ? MAP_SCALE.mobile : MAP_SCALE.desktop;
}

// 数値、zoom の補間、式のどれでも、出力の値だけを k 倍する
export function scalePaintValue(value: unknown, k: number): unknown {
  if (k === 1) return value;
  if (typeof value === "number") return value * k;
  if (Array.isArray(value) && value[0] === "interpolate") {
    return value.map((item, i) => (i >= 4 && i % 2 === 0 ? scalePaintValue(item, k) : item));
  }
  if (Array.isArray(value) && value[0] === "case") {
    const last = value.length - 1;
    return value.map((item, i) =>
      (i > 0 && i % 2 === 0) || i === last ? scalePaintValue(item, k) : item,
    );
  }
  return ["*", k, value];
}

const scaledProps: Record<string, string[]> = {
  line: ["line-width"],
  circle: ["circle-radius", "circle-stroke-width"],
};

function applyMapScale(map: MapLibreMap, bases: Map<string, unknown>, scale: MapScale): void {
  for (const [key, base] of bases) {
    const [layerId, prop] = key.split("|") as [string, string];
    if (!map.getLayer(layerId)) continue;
    map.setPaintProperty(
      layerId,
      prop as PaintKey,
      scalePaintValue(base, scaleFor(prop, scale)) as never,
    );
  }
  document.documentElement.style.setProperty("--map-mark-scale", String(scale.mark));
}

function scaleFor(prop: string, scale: MapScale): number {
  return prop === "line-width" ? scale.line : scale.mark;
}

// 地図の線と円の元の値を覚え、画面の幅に合わせて掛け直す。層を足した後に 1 回呼ぶ
export function installMapScale(map: MapLibreMap): void {
  const bases = new Map<string, unknown>();
  for (const layer of map.getStyle().layers) {
    for (const prop of scaledProps[layer.type] ?? []) {
      const value = map.getPaintProperty(layer.id, prop as PaintKey);
      if (value !== undefined) bases.set(`${layer.id}|${prop}`, value);
    }
  }
  const update = () => applyMapScale(map, bases, pickMapScale(window.innerWidth));
  update();
  map.on("resize", update);
}
