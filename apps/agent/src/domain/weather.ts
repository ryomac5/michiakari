// 雨量の推移の要約。規制の基準値は扱わず、推移の向きと警報の有無だけを見る

export type RainReading = {
  time: string;
  rainfall10minMm: number | null;
  warnings: string[];
};

export type RainSummary = {
  latest: RainReading | null;
  trend: "rising" | "falling" | "steady" | null;
  // 警報が出ている、または雨が弱まっていない
  rainContinuing: boolean | null;
};

function hasWarning(reading: RainReading): boolean {
  return reading.warnings.some((w) => w.includes("警報"));
}

export function summarizeRain(readings: readonly RainReading[]): RainSummary {
  const valid = readings.filter((r) => r.rainfall10minMm !== null);
  const latest = valid.at(-1) ?? null;
  if (!latest || latest.rainfall10minMm === null) {
    return { latest, trend: null, rainContinuing: null };
  }
  const prev = valid.at(-2)?.rainfall10minMm ?? null;
  const trend =
    prev === null
      ? null
      : latest.rainfall10minMm > prev
        ? "rising"
        : latest.rainfall10minMm < prev
          ? "falling"
          : "steady";
  const rainContinuing = hasWarning(latest) || (latest.rainfall10minMm > 0 && trend !== "falling");
  return { latest, trend, rainContinuing };
}
