import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { GeoMeta, LineInfo, NetworkData, StationNode } from "@repo/geo";
import { roundCoordinates } from "./geometry.ts";

// geo/data/ への書き出し。配列の要素を1行ずつ書き、差分を読みやすくする

export type LineGeometryRow = {
  operator_key: string;
  line_name: string;
  geometry: string;
};

export type Feature = {
  type: "Feature";
  properties: Record<string, unknown>;
  geometry: { type: string; coordinates: unknown };
};

export function serializeFeatureCollection(features: readonly Feature[]): string {
  const body = features.map((f) => JSON.stringify(f)).join(",\n");
  return `{"type":"FeatureCollection","features":[\n${body}\n]}\n`;
}

export function serializeArrays(object: Record<string, unknown>): string {
  const entries = Object.entries(object).map(([key, value]) => {
    if (!Array.isArray(value)) return `${JSON.stringify(key)}:${JSON.stringify(value)}`;
    const items = value.map((v) => JSON.stringify(v)).join(",\n");
    return `${JSON.stringify(key)}:[\n${items}\n]`;
  });
  return `{\n${entries.join(",\n")}\n}\n`;
}

export function buildLineFeatures(
  lines: readonly LineInfo[],
  geometries: readonly LineGeometryRow[],
): Feature[] {
  const byKey = new Map(geometries.map((g) => [`${g.operator_key}\u0000${g.line_name}`, g]));
  return lines.flatMap((line) => {
    const row = byKey.get(`${line.operatorKey}\u0000${line.lineName}`);
    if (!row) return [];
    const geometry = JSON.parse(row.geometry) as Feature["geometry"];
    if (geometry.type !== "LineString" && geometry.type !== "MultiLineString") return [];
    return [
      {
        type: "Feature",
        properties: {
          lineId: line.lineId,
          operator: line.operator,
          lineName: line.lineName,
          nameEn: line.nameEn,
          operatorEn: line.operatorEn,
          lineType: line.lineType,
          color: line.color,
        },
        geometry: { type: geometry.type, coordinates: roundCoordinates(geometry.coordinates, 5) },
      },
    ];
  });
}

export function buildStationFeatures(nodes: readonly StationNode[]): Feature[] {
  return nodes.map((n) => ({
    type: "Feature",
    properties: {
      stationId: n.stationId,
      name: n.name,
      ...(n.nameEn ? { nameEn: n.nameEn } : {}),
      operator: n.operator,
      lineId: n.lineId,
      passengers: n.passengers,
    },
    geometry: { type: "Point", coordinates: [...n.lonLat] },
  }));
}

export async function writeGeoData(
  outDir: string,
  outputs: {
    lineFeatures: Feature[];
    stationFeatures: Feature[];
    network: NetworkData;
    meta: GeoMeta;
  },
): Promise<void> {
  await mkdir(outDir, { recursive: true });
  await writeFile(join(outDir, "lines.geojson"), serializeFeatureCollection(outputs.lineFeatures));
  await writeFile(
    join(outDir, "stations.geojson"),
    serializeFeatureCollection(outputs.stationFeatures),
  );
  await writeFile(join(outDir, "network.json"), serializeArrays(outputs.network));
  await writeFile(join(outDir, "meta.json"), `${JSON.stringify(outputs.meta, null, 2)}\n`);
}
