import type { WeatherCheckedReading } from "@repo/schema";

// 雨量の推移の棒グラフの配置を求める。描画とは分けて、座標だけを返す

export type WeatherBar = {
  time: string;
  // 欠測は null。棒を描かず、欠測の印を置く
  mm: number | null;
  // 棒の左端と幅（グラフの幅に対する割合）
  x: number;
  width: number;
  // 棒の高さ（グラフの高さに対する割合）
  height: number;
  latest: boolean;
};

export type WeatherChart = {
  bars: WeatherBar[];
  // 縦軸の上端（mm）
  scaleMaxMm: number;
  missingCount: number;
};

// 弱い雨だけのときに棒が上端まで伸びて強い雨に見えないよう、縦軸の上端に下限を置く
const MIN_SCALE_MM = 5;
// 棒の幅は 1 本分の枠に対するこの割合
const BAR_RATIO = 0.62;

export function buildWeatherChart(readings: readonly WeatherCheckedReading[]): WeatherChart {
  const values = readings.flatMap((r) => (r.rainfall10minMm === null ? [] : [r.rainfall10minMm]));
  const scaleMaxMm = Math.max(MIN_SCALE_MM, Math.ceil(Math.max(0, ...values)));
  const slot = readings.length > 0 ? 1 / readings.length : 0;
  const lastValidIndex = readings.findLastIndex((r) => r.rainfall10minMm !== null);
  const bars = readings.map((r, i) => ({
    time: r.time,
    mm: r.rainfall10minMm,
    x: i * slot + (slot * (1 - BAR_RATIO)) / 2,
    width: slot * BAR_RATIO,
    height: r.rainfall10minMm === null ? 0 : r.rainfall10minMm / scaleMaxMm,
    latest: i === lastValidIndex,
  }));
  return { bars, scaleMaxMm, missingCount: readings.length - values.length };
}

// 警報が出ているか。注意報は警報に数えない
export function hasWeatherWarning(warnings: readonly string[]): boolean {
  return warnings.some((w) => w.includes("警報"));
}

// 気象庁の警報・注意報の名前の英語表記。表に無いものは日本語のまま出す
const warningNamesEn: Record<string, string> = {
  大雨特別警報: "Heavy rain emergency warning",
  大雨警報: "Heavy rain warning",
  大雨注意報: "Heavy rain advisory",
  洪水警報: "Flood warning",
  洪水注意報: "Flood advisory",
  暴風警報: "Storm warning",
  強風注意報: "Gale advisory",
  雷注意報: "Thunderstorm advisory",
};

export function formatWarningName(name: string, locale: string): string {
  return locale === "ja" ? name : (warningNamesEn[name] ?? name);
}
