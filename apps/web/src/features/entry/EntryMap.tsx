"use client";

import "maplibre-gl/dist/maplibre-gl.css";
import { computeDistanceMeters } from "@repo/geo";
import { ArrowUp } from "lucide-react";
import type { GeoJSONSource, Map as MapLibreMap, Marker } from "maplibre-gl";
import { useLocale, useTranslations } from "next-intl";
import { type RefObject, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { testIds } from "@/features/judgment/testids";
import type { MapGeoData } from "@/features/map/geo-data";
import { selectMapLabels } from "@/features/map/labels";
import { buildBaseStyle, type MapPalette, mapPalettes } from "@/features/map/layers";
import { MapAttribution, mapAttributionHeight } from "@/features/map/MapAttribution";
import { loadMapLibre, type MapInsets, useMarkerHosts } from "@/features/map/MapPanel";
import { prefersReducedMotion, useDocumentTheme } from "@/lib/use-document-theme";
import type { LabelSide } from "./areas";
import { DestinationMarker, HubMarker, PlaceMarker, StopMarker } from "./EntryMarkers";
import type { EntryArea, EntryHub, EntryPlace, Position } from "./entry-places";
import { pickLocalized, pickPlaceName } from "./entry-places";
import type { EntryStage } from "./flow";

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
};

type EntryMapProps = {
  geo: MapGeoData | null;
  stage: EntryStage;
  hubs: EntryHub[];
  area: EntryArea | null;
  place: EntryPlace | null;
  // 選んだ路線。地図ではその路線だけを路線色で太く描く
  lineId: string | null;
  destination: { position: Position; label: string } | null;
  stops: MapStop[];
  // 札は出さずに視点だけに含める点。いまどこの段で前後の駅まで収める
  focus: Position[];
  onSelectStop: (key: string) => void;
  insets: MapInsets;
  narrow: boolean;
  apiRef: RefObject<EntryMapApi | null>;
  onSelectHub: (areaId: string) => void;
  onSelectPlace: (place: EntryPlace) => void;
  // 印のない所を触ったとき
  onTap: (point: Position) => void;
};

const kansaiCenter: Position = [135.5, 34.75];
// 様子を聞く段。行き先を選び終えているので、出発と行き先を弧で結び、視点は動かさない
const situationStages = new Set<EntryStage>(["cause", "elapsed", "resume", "input"]);
const sourceIds = { lines: "entry-lines", trip: "entry-trip" } as const;
// 名前の札のぶん、印のまわりに空ける余白（px）
const labelMargin = { x: 96, y: 44 };
const durationMs = 650;
// 駅の段で一緒に収める、まわりの駅までの距離（m）
const nearbyMeters = 600;

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

function applyPaint(map: MapLibreMap, palette: MapPalette, lineId: string | null): void {
  type PaintArgs = Parameters<MapLibreMap["setPaintProperty"]>;
  const set = (layer: string, key: string, value: unknown) => {
    if (map.getLayer(layer))
      map.setPaintProperty(layer, key as PaintArgs[1], value as PaintArgs[2]);
  };
  set("background", "background-color", palette.background);
  set("gsi-pale", "raster-brightness-min", palette.rasterBrightnessMin);
  set("gsi-pale", "raster-brightness-max", palette.rasterBrightnessMax);
  set("gsi-pale", "raster-contrast", palette.rasterContrast);
  set("entry-rail", "line-color", buildRailColor(palette));
  set("entry-rail", "line-opacity", [
    "interpolate",
    ["linear"],
    ["zoom"],
    9,
    palette.railOpacity,
    13,
    lineId ? 0.2 : 0.45,
  ]);
  set("entry-line-casing", "line-color", palette.routeCasing);
  set("entry-trip", "line-color", palette.text);
  const filter = ["==", ["get", "lineId"], lineId ?? ""];
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
  map.addLayer({
    id: "entry-trip",
    type: "line",
    source: sourceIds.trip,
    layout: { "line-cap": "round", "line-join": "round" },
    paint: { "line-color": palette.text, "line-width": 2.5, "line-dasharray": [1.2, 1.8] },
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

type EdgeHub = { hub: EntryHub; x: number; y: number; angle: number };

// 画面の外の丸を、画面の中心からその丸へ向かう線と、縁の矩形との交点に置く
function placeEdgeHubs(
  hubs: EntryHub[],
  project: (p: Position) => { x: number; y: number },
  size: { width: number; height: number },
  insets: { top: number; bottom: number; left: number },
): EdgeHub[] {
  const box = {
    left: insets.left + 16,
    right: size.width - 16,
    top: insets.top + 16,
    bottom: size.height - insets.bottom - 16,
  };
  const cx = (box.left + box.right) / 2;
  const cy = (box.top + box.bottom) / 2;
  return hubs.flatMap((hub) => {
    const p = project(hub.position);
    if (p.x >= box.left && p.x <= box.right && p.y >= box.top && p.y <= box.bottom) return [];
    const dx = p.x - cx;
    const dy = p.y - cy;
    // 札の幅と高さの半分だけ内側に寄せる
    const sx = dx === 0 ? Infinity : ((dx > 0 ? box.right - 64 : box.left + 64) - cx) / dx;
    const sy = dy === 0 ? Infinity : ((dy > 0 ? box.bottom - 24 : box.top + 24) - cy) / dy;
    const scale = Math.min(sx, sy);
    return [
      { hub, x: cx + dx * scale, y: cy + dy * scale, angle: (Math.atan2(dy, dx) * 180) / Math.PI },
    ];
  });
}

export function EntryMap(props: EntryMapProps) {
  const t = useTranslations("entry");
  const locale = useLocale();
  const labels = selectMapLabels(locale);
  const theme = useDocumentTheme();
  const palette = mapPalettes[theme];
  const { geo, stage, hubs, area, place, lineId, destination, stops, focus, insets, narrow } =
    props;
  const containerRef = useRef<HTMLDivElement>(null);
  const paletteRef = useRef(palette);
  paletteRef.current = palette;
  const callbacksRef = useRef(props);
  callbacksRef.current = props;
  const [map, setMap] = useState<MapLibreMap | null>(null);
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
        // 印の上の操作は印が受け持つ。何もない所を触ったときだけ知らせる
        loaded.on("click", (e) => {
          const target = e.originalEvent.target as HTMLElement | null;
          if (target?.closest(".maplibregl-marker")) return;
          callbacksRef.current.onTap([e.lngLat.lng, e.lngLat.lat]);
        });
      })
      .catch(() => {});
    return () => {
      disposed = true;
      instance?.remove();
      setMap(null);
    };
  }, [geo]);

  useEffect(() => {
    if (map) applyPaint(map, palette, lineId);
  }, [map, palette, lineId]);

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
  const cameraKey = JSON.stringify([
    situationStages.has(stage) ? "situation" : stage,
    area?.id,
    area?.center,
    place?.key,
    origin,
    stopKey,
    showTrip ? destinationPosition : null,
    top,
    right,
    bottom,
    left,
  ]);
  const firstFitRef = useRef(true);
  // biome-ignore lint/correctness/useExhaustiveDependencies: 視点は cameraKey が変わったときだけ動かす
  useEffect(() => {
    if (!map) return;
    const duration = firstFitRef.current || prefersReducedMotion() ? 0 : durationMs;
    firstFitRef.current = false;
    const current = { top, right, bottom, left };
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
          padding: buildPadding(map, current, { x: labelMargin.x + 24, y: labelMargin.y + 12 }),
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
      const bounds = computeBounds([area.center, ...area.places.map((p) => p.position)]);
      if (bounds) {
        map.fitBounds(bounds, {
          padding: buildPadding(map, current, { x: labelMargin.x + 16, y: labelMargin.y + 8 }),
          maxZoom: 15.8,
          duration,
        });
      }
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
  const [edgeHubs, setEdgeHubs] = useState<EdgeHub[]>([]);
  useEffect(() => {
    if (!map || stage !== "kansai") {
      setEdgeHubs([]);
      return;
    }
    const update = () => {
      const canvas = map.getCanvas();
      setEdgeHubs(
        placeEdgeHubs(
          hubs,
          (p) => map.project(p),
          { width: canvas.clientWidth, height: canvas.clientHeight },
          { top, bottom, left },
        ),
      );
    };
    update();
    map.on("move", update);
    return () => {
      map.off("move", update);
    };
  }, [map, stage, hubs, top, bottom, left]);

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

  const edgeKey = edgeHubs.map((e) => e.hub.areaId).join(",");
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
    // 縁の札で示す丸は、地図の上には出さない
    if (stage === "kansai") {
      const onEdge = new Set(edgeKey.split(","));
      return hubs
        .filter((h) => !onEdge.has(h.areaId))
        .map((h) => at(`hub:${h.areaId}`, h.position));
    }
    // 駅を選んだあとは、選んだ駅と札だけを出す
    const places =
      stage !== "area" && stage !== "station" && place ? [place] : (area?.places ?? []);
    const list = places.map((p) => at(`place:${p.key}`, p.position));
    if (!showTrip) {
      for (const s of stops) list.push(at(`stop:${s.key}`, s.position));
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
  }, [stage, hubs, area, place, showTrip, destinationPosition, edgeKey, stops]);
  const hosts = useMarkerHosts(map, markerClass, entries);
  const side = narrow ? "narrow" : "wide";

  return (
    <section
      data-testid={testIds.start.map}
      data-stage={stage}
      data-ready={map !== null}
      aria-label={t("mapLabel")}
      className="fixed inset-0 z-0 bg-background"
    >
      <div ref={containerRef} className="h-full w-full" />
      {edgeHubs.map(({ hub, x, y, angle }) => (
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
          const hub = hubs.find((h) => `hub:${h.areaId}` === key);
          if (!hub) return null;
          return createPortal(
            <HubMarker
              areaId={hub.areaId}
              label={pickLocalized(hub.label, locale)}
              side={hub.side[side]}
              onSelect={() => props.onSelectHub(hub.areaId)}
            />,
            element,
            key,
          );
        }
        if (key.startsWith("stop:")) {
          const target = stops.find((s) => `stop:${s.key}` === key);
          if (!target) return null;
          return createPortal(
            <StopMarker
              stopKey={target.key}
              label={target.label}
              side={target.side}
              color={target.color}
              angle={target.angle}
              onSelect={() => props.onSelectStop(target.key)}
            />,
            element,
            key,
          );
        }
        const target =
          (place && `place:${place.key}` === key ? place : null) ??
          area?.places.find((p) => `place:${p.key}` === key);
        if (!target) return null;
        const selected = place?.key === target.key;
        return createPortal(
          <PlaceMarker
            placeKey={target.key}
            label={pickPlaceName(target, locale)}
            side={target.side[side]}
            colors={[...new Set(target.lines.map((l) => l.color))]}
            selected={selected}
            dim={place !== null && !selected}
            hereLabel={t("here")}
            onSelect={() => props.onSelectPlace(target)}
          />,
          element,
          key,
        );
      })}
      <MapAttribution labels={labels.attribution} insets={{ bottom, left, right }} />
    </section>
  );
}
