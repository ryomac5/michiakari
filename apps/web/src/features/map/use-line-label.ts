"use client";

import { useLocale } from "next-intl";
import { useEffect, useState } from "react";
import { loadMapGeoData, type MapGeoData } from "./geo-data";
import { translateLineName } from "./scene";

// 路線名を画面の言語に合わせる関数を返す。日本語ではそのまま、英語では路線データの英語名にする
// 英語名の対応が無い通称（JR神戸線など）は null を返し、呼び出し側で路線名を省く
export function useLineTranslator(): (line: string) => string | null {
  const english = useLocale() === "en";
  const [geo, setGeo] = useState<MapGeoData | null>(null);

  useEffect(() => {
    if (!english) return;
    let cancelled = false;
    loadMapGeoData()
      .then((data) => {
        if (!cancelled) setGeo(data);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [english]);

  return (line) => {
    if (!english) return line;
    return geo ? translateLineName(geo.index, line) : null;
  };
}

export function useLineLabel(line: string | null): string | null {
  const translate = useLineTranslator();
  return line === null ? null : translate(line);
}
