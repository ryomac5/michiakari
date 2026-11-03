import {
  computeDistanceMeters,
  type LineDirection,
  listLineDirections,
  type StationNode,
} from "@repo/geo";
import type { StationChoice } from "@/features/stations/catalog";
import type { Localized } from "./areas";
import {
  type DirectionLabelConfig,
  directionLabels,
  preferredDirectionStation,
} from "./direction-labels";
import type { EntryData, EntryLine, Position } from "./entry-places";

// 選んだ路線の方面と、方面の先の行き先の候補を、駅データと方面の設定から組み立てる

export type DirectionStop = {
  choice: StationChoice;
  position: Position;
  // まとめた駅の乗降客数。乗換の多い主な駅ほど大きい
  passengers: number;
  // 選んだ路線と同じ事業者の駅か。直通先の駅は false になる
  sameOperator: boolean;
};

export type EntryDirection = {
  key: string;
  // 「新大阪・千里中央」。画面では「方面」を添えて出す
  label: Localized;
  // 呼び名に出した駅。行き先の候補に必ず入れる
  landmarks: DirectionStop[];
  // 先の駅。近い順
  stops: DirectionStop[];
  // 行き先を決めずに進んだときの行き先。方面の先の主な駅か、終点
  fallback: { stop: DirectionStop; kind: "hub" | "terminal" };
};

// 方面を求めるのに要る路線の項目。判断の画面から戻ったときの OriginLine でも引ける
export type DirectionLine = Pick<EntryLine, "key" | "lineId" | "stationName" | "observedName">;

// 選んだ路線での、選んだ駅のノード
function findLineNode(data: EntryData, line: DirectionLine): StationNode | undefined {
  return data.index.listStationsOnLine(line.lineId).find((n) => n.name === line.stationName);
}

function buildStop(data: EntryData, nodeId: string, operatorKey: string): DirectionStop | null {
  const node = data.index.getStation(nodeId);
  const groupId = data.catalog.groupIdByStationId.get(nodeId);
  const group = groupId ? data.catalog.groupById.get(groupId) : undefined;
  if (!node || !group) return null;
  return {
    choice: group.choice,
    position: [group.choice.lon, group.choice.lat],
    passengers: group.passengers,
    sameOperator: data.index.getLine(node.lineId)?.operatorKey === operatorKey,
  };
}

// 終わりの駅から直通する路線の先の駅を足す
function extendThrough(data: EntryData, terminalName: string, throughLineId: string): string[] {
  const line = data.index.getLine(throughLineId);
  const node = data.index.listStationsOnLine(throughLineId).find((n) => n.name === terminalName);
  if (!line || !node) return [];
  const [longest] = listLineDirections(line, node.stationId).sort(
    (a, b) => b.stationIds.length - a.stationIds.length,
  );
  return longest?.stationIds ?? [];
}

function findLabelConfig(lineId: string, terminalName: string): DirectionLabelConfig | undefined {
  return directionLabels.find((c) => c.lineId === lineId && c.terminal === terminalName);
}

function nameStop(stop: DirectionStop): Localized {
  return { ja: stop.choice.name, en: stop.choice.nameEn ?? stop.choice.name };
}

function joinNames(names: Localized[]): Localized {
  return { ja: names.map((n) => n.ja).join("・"), en: names.map((n) => n.en).join(" / ") };
}

// 方面の呼び名と、呼び名に出した駅。設定があれば先にある目印の駅を前から 2 つ、
// 無ければ乗降客数の多い 2 駅を道順に並べる
function buildLabel(
  stops: DirectionStop[],
  config: DirectionLabelConfig | undefined,
): { label: Localized; landmarks: DirectionStop[] } {
  const byName = new Map(stops.map((s) => [s.choice.name, s]));
  const configured = (config?.landmarks ?? [])
    .flatMap((l) => {
      const stop = byName.get(l.station);
      return stop ? [{ stop, name: l.label ?? nameStop(stop) }] : [];
    })
    .slice(0, 2);
  if (configured.length > 0) {
    return {
      label: joinNames(configured.map((c) => c.name)),
      landmarks: configured.map((c) => c.stop),
    };
  }
  const major = [...stops].sort((a, b) => b.passengers - a.passengers).slice(0, 2);
  const landmarks = stops.filter((s) => major.includes(s));
  return { label: joinNames(landmarks.map(nameStop)), landmarks };
}

// 行き先を決めないときの行き先。隣の駅は避け、同じ事業者の主な駅を選ぶ。先が短ければ終点にする
export function pickFallbackStop(stops: DirectionStop[]): EntryDirection["fallback"] | null {
  const terminal = stops.at(-1);
  if (!terminal) return null;
  const pool = stops.slice(1).filter((s) => s.sameOperator);
  const hub = [...pool].sort((a, b) => b.passengers - a.passengers)[0];
  if (!hub || hub === terminal) return { stop: terminal, kind: "terminal" };
  return { stop: hub, kind: "hub" };
}

function buildDirection(
  data: EntryData,
  line: DirectionLine,
  direction: LineDirection,
  operatorKey: string,
): EntryDirection | null {
  const terminalName = data.index.getStation(direction.terminalId)?.name ?? "";
  const config = findLabelConfig(line.lineId, terminalName);
  const ids = [
    ...direction.stationIds,
    ...(config?.throughLineId ? extendThrough(data, terminalName, config.throughLineId) : []),
  ];
  const seen = new Set<string>([line.stationName]);
  const stops: DirectionStop[] = [];
  for (const id of ids) {
    const stop = buildStop(data, id, operatorKey);
    if (!stop || seen.has(stop.choice.id)) continue;
    seen.add(stop.choice.id);
    stops.push(stop);
  }
  const fallback = pickFallbackStop(stops);
  if (!fallback) return null;
  return {
    key: `${line.key}>${direction.terminalId}`,
    ...buildLabel(stops, config),
    stops,
    fallback,
  };
}

// 選んだ路線の方面。JR の通称を選んだときは、その通称の区間へ向かう方面を先に出す
export function listEntryDirections(data: EntryData, line: DirectionLine): EntryDirection[] {
  const node = findLineNode(data, line);
  const info = data.index.getLine(line.lineId);
  if (!node || !info) return [];
  // 地図の向きと合わせ、北へ向かう方面を先に出す
  const directions = listLineDirections(info, node.stationId)
    .flatMap((d) => buildDirection(data, line, d, info.operatorKey) ?? [])
    .sort((a, b) => (b.stops.at(-1)?.position[1] ?? 0) - (a.stops.at(-1)?.position[1] ?? 0));
  const preferred = preferredDirectionStation[line.observedName];
  if (!preferred) return directions;
  const hasPreferred = (d: EntryDirection) => d.stops.some((s) => s.choice.name === preferred);
  return [...directions.filter(hasPreferred), ...directions.filter((d) => !hasPreferred(d))];
}

const compareStops = (a: DirectionStop, b: DirectionStop) =>
  Number(b.sameOperator) - Number(a.sameOperator) || b.passengers - a.passengers;

// 行き先の候補。同じ事業者の駅を先に、乗降客数の多い主な駅から並べる
// 方面の呼び名に出した駅（終点の京都河原町や直通先の千里中央など）は必ず入れる
export function listDirectionCandidates(direction: EntryDirection, limit = 5): DirectionStop[] {
  const landmarks = direction.landmarks.slice(0, limit);
  const rest = [...direction.stops]
    .filter((s) => !landmarks.includes(s))
    .sort(compareStops)
    .slice(0, limit - landmarks.length);
  return [...rest, ...landmarks].sort(compareStops);
}

// 地図の札に出す駅。候補の順に、現在地と先に選んだ札から離れた駅だけを残す
// 離す距離は、札を出す範囲の広さに合わせて広げる
export function pickSpreadStops(
  stops: DirectionStop[],
  origin: Position,
  limit = 4,
): DirectionStop[] {
  const span = Math.max(0, ...stops.map((s) => computeDistanceMeters(origin, s.position)));
  const minMeters = Math.max(1200, span / 8);
  const picked: DirectionStop[] = [];
  for (const stop of stops) {
    const near = [origin, ...picked.map((p) => p.position)].some(
      (p) => computeDistanceMeters(p, stop.position) < minMeters,
    );
    if (!near) picked.push(stop);
    if (picked.length >= limit) break;
  }
  return picked;
}

// 電車の中にいる人に聞く、近い駅の候補。来た側の隣の駅、選んだ駅、進む側の隣の駅を道順に並べる
export function listNearbyStops(
  data: EntryData,
  line: DirectionLine,
  directions: EntryDirection[],
  chosen: EntryDirection,
): DirectionStop[] {
  const info = data.index.getLine(line.lineId);
  const node = findLineNode(data, line);
  const here = node && info ? buildStop(data, node.stationId, info.operatorKey) : null;
  const behind = directions.find((d) => d.key !== chosen.key)?.stops[0];
  const ahead = chosen.stops[0];
  return [behind, here, ahead].flatMap((s) => (s ? [s] : []));
}
