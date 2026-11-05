import type { LineType } from "@repo/geo";
import { LINE_COLORS, NEUTRAL_LINE_COLOR, OPERATOR_COLORS } from "../config/line-colors.ts";
import { LINE_NAMES_EN, OPERATOR_NAMES_EN } from "../config/line-names-en.ts";
import {
  DEFAULT_LINE_TYPE,
  LINE_TYPE_OVERRIDES,
  OPERATOR_DEFAULT_LINE_TYPES,
} from "../config/line-types.ts";
import { LINE_ALIASES } from "../config/operators.ts";
import { STATION_NAME_EN_OVERRIDES } from "../config/station-names-en.ts";
import { STATION_READINGS } from "../config/station-readings.ts";
import { romanizeReading } from "./romanize.ts";

// config/ の表から路線・駅の属性を引く

const buildLineKey = (operatorKey: string, lineName: string) => `${operatorKey}:${lineName}`;

export function resolveLineType(operatorKey: string, lineName: string): LineType {
  return (
    LINE_TYPE_OVERRIDES[buildLineKey(operatorKey, lineName)] ??
    OPERATOR_DEFAULT_LINE_TYPES[operatorKey] ??
    DEFAULT_LINE_TYPE
  );
}

export function resolveLineColor(operatorKey: string, lineName: string): string {
  return (
    LINE_COLORS[buildLineKey(operatorKey, lineName)] ??
    OPERATOR_COLORS[operatorKey] ??
    NEUTRAL_LINE_COLOR
  );
}

export function resolveLineAliases(operatorKey: string, lineName: string): string[] {
  return [...(LINE_ALIASES[buildLineKey(operatorKey, lineName)] ?? [])];
}

export function resolveStationReading(name: string): string | undefined {
  return STATION_READINGS[name];
}

export function resolveLineNameEn(operatorKey: string, lineName: string): string | undefined {
  return LINE_NAMES_EN[buildLineKey(operatorKey, lineName)];
}

export function resolveOperatorNameEn(operatorKey: string): string | undefined {
  return OPERATOR_NAMES_EN[operatorKey];
}

// 読みのある駅だけ英語名を持つ。上書きの表になければ読みをローマ字にする
export function resolveStationNameEn(name: string): string | undefined {
  const reading = resolveStationReading(name);
  if (reading === undefined) return undefined;
  return STATION_NAME_EN_OVERRIDES[name] ?? romanizeReading(reading);
}
