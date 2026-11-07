"use client";

import "maplibre-gl/dist/maplibre-gl.css";
import type { Place } from "@repo/schema";
import type { Map as MapLibreMap } from "maplibre-gl";
import { useLocale } from "next-intl";
import { useEffect, useMemo, useRef, useState } from "react";
import { testIds } from "@/features/judgment/testids";
import { prefersReducedMotion, useDocumentTheme } from "@/lib/use-document-theme";
import { loadMapGeoData, type MapGeoData } from "./geo-data";
import { selectMapLabels } from "./labels";
import { buildBaseStyle, listPaintValues, mapPalettes, sourceIds } from "./layers";
import { loadMapLibre, preloadMapLibre } from "./MapPanel";
import { installMapScale } from "./map-scale";
import { waitForOwnLayersDrawn } from "./ready";
import { computeFitBounds, type Position, resolvePlacePosition } from "./scene";

// 開始画面やリプレイの一覧の背景に敷く、関西の路線の淡い地図。操作はできない
// 選んだ駅があれば、そこへゆっくり寄せる

const kansaiCenter: [number, number] = [135.42, 34.74];
const backdropLayerIds = ["rail-lines", "backdrop-places"];

export function BackdropMap({
  places = [],
  bottomInset = 0,
  showAttribution = true,
}: {
  places?: Place[];
  // 下に重なるカードの高さ。駅に寄せるときに空ける
  bottomInset?: number;
  // 出典を地図の下端に出すか。下にカードが重なる画面ではカードの中に出す
  showAttribution?: boolean;
}) {
  const attribution = selectMapLabels(useLocale()).attribution;
  const theme = useDocumentTheme();
  const palette = mapPalettes[theme];
  const containerRef = useRef<HTMLDivElement>(null);
  const paletteRef = useRef(palette);
  paletteRef.current = palette;
  const [geo, setGeo] = useState<MapGeoData | null>(null);
  const [map, setMap] = useState<MapLibreMap | null>(null);
  // 路線を描き終えたか。録画は ready になってから撮り始める
  const [drawn, setDrawn] = useState(false);

  useEffect(() => {
    let cancelled = false;
    preloadMapLibre();
    loadMapGeoData()
      .then((data) => {
        if (!cancelled) setGeo(data);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const container = containerRef.current;
    if (!geo || !container) return;
    let disposed = false;
    let instance: MapLibreMap | null = null;
    loadMapLibre()
      .then(({ Map: MapClass }) => {
        if (disposed) return;
        instance = new MapClass({
          container,
          style: buildBaseStyle(paletteRef.current),
          center: kansaiCenter,
          zoom: 9.2,
          interactive: false,
          attributionControl: false,
        });
        const loaded = instance;
        loaded.on("load", () => {
          const p = paletteRef.current;
          loaded.addSource(sourceIds.lines, { type: "geojson", data: geo.lines });
          loaded.addSource("backdrop-places", {
            type: "geojson",
            data: { type: "FeatureCollection", features: [] },
          });
          loaded.addLayer({
            id: "rail-lines",
            type: "line",
            source: sourceIds.lines,
            layout: { "line-cap": "round", "line-join": "round" },
            paint: { "line-color": p.rail, "line-width": 1.2, "line-opacity": p.railOpacity },
          });
          loaded.addLayer({
            id: "backdrop-places",
            type: "circle",
            source: "backdrop-places",
            paint: {
              "circle-radius": 7,
              "circle-color": p.text,
              "circle-stroke-color": p.textHalo,
              "circle-stroke-width": 3,
            },
          });
          installMapScale(loaded);
          setMap(loaded);
        });
      })
      .catch(() => {});
    return () => {
      disposed = true;
      instance?.remove();
      setMap(null);
      setDrawn(false);
    };
  }, [geo]);

  useEffect(() => {
    if (!map) return;
    return waitForOwnLayersDrawn(map, () => setDrawn(true));
  }, [map]);

  const positions = useMemo(
    () =>
      geo
        ? places
            .map((p) => resolvePlacePosition(geo.index, p))
            .filter((p): p is Position => p !== null)
        : [],
    [geo, places],
  );

  // 選んだ駅に点を打ち、そこへ寄せる。何も選んでいなければ関西の全体に戻す
  useEffect(() => {
    if (!map) return;
    const source = map.getSource("backdrop-places");
    if (source && "setData" in source) {
      (source as { setData: (d: unknown) => void }).setData({
        type: "FeatureCollection",
        features: positions.map((coordinates) => ({
          type: "Feature",
          geometry: { type: "Point", coordinates },
          properties: {},
        })),
      });
    }
    const duration = prefersReducedMotion() ? 0 : 1200;
    const bounds = computeFitBounds(positions, 0.08);
    if (bounds) {
      map.fitBounds(bounds, {
        padding: { top: 120, right: 64, bottom: bottomInset + 64, left: 64 },
        maxZoom: 11.5,
        duration,
      });
    } else {
      map.easeTo({ center: kansaiCenter, zoom: 9.2, duration });
    }
  }, [map, positions, bottomInset]);

  useEffect(() => {
    if (!map) return;
    for (const { layerId, key, value } of listPaintValues(palette, "wait")) {
      if (layerId === "background" || layerId === "gsi-pale") {
        type PaintArgs = Parameters<MapLibreMap["setPaintProperty"]>;
        map.setPaintProperty(layerId, key as PaintArgs[1], value as PaintArgs[2]);
      }
    }
    for (const id of backdropLayerIds) {
      if (!map.getLayer(id)) continue;
      if (id === "rail-lines") {
        map.setPaintProperty(id, "line-color", palette.rail);
        map.setPaintProperty(id, "line-opacity", palette.railOpacity);
      } else {
        map.setPaintProperty(id, "circle-color", palette.text);
        map.setPaintProperty(id, "circle-stroke-color", palette.textHalo);
      }
    }
  }, [map, palette]);

  return (
    <div
      data-testid={testIds.app.backdropMap}
      data-state={drawn ? "ready" : "loading"}
      className="fixed inset-0 z-0 bg-background"
    >
      <div ref={containerRef} aria-hidden className="h-full w-full" />
      {/* 地図を淡くし、上に載せるカードを読みやすくする */}
      <div
        aria-hidden
        className="absolute inset-0 bg-gradient-to-b from-background/60 via-background/10 to-background/85"
      />
      {showAttribution && (
        <p className="absolute right-3 bottom-[max(8px,env(safe-area-inset-bottom))] left-3 truncate text-[10px] text-muted opacity-80">
          <span aria-hidden>{attribution.short}</span>
          <span className="sr-only">{attribution.full[0]}</span>
        </p>
      )}
    </div>
  );
}
