import type { StationChoice } from "@/features/stations/catalog";
import { preferredDirectionStation } from "./direction-labels";
import { type EntryDirection, listEntryDirections } from "./directions";
import { type EntryData, type EntryLine, type EntryPlace, listGroupLines } from "./entry-places";

export type RouteCandidate = { line: EntryLine; direction: EntryDirection };

// 同一路線の駅を両端に持つ方面だけを残す。通称が重なる場合は、向かう側の呼び名を使う。
export function inferEntryRoutes(
  data: EntryData,
  origin: EntryPlace,
  destination: StationChoice,
): RouteCandidate[] {
  const candidates = origin.lines.flatMap((line) => {
    const servesDestination = data.index
      .listStationsOnLine(line.lineId)
      .some((s) => s.name === destination.name);
    if (!servesDestination || line.stationName === destination.name) return [];
    return listEntryDirections(data, line)
      .filter((direction) => direction.stops.some((s) => s.choice.id === destination.id))
      .map((direction) => ({ line, direction }));
  });
  const preferred = candidates.filter(({ line, direction }) => {
    const landmark = preferredDirectionStation[line.observedName];
    return !landmark || direction.stops.some((s) => s.choice.name === landmark);
  });
  const resolved = candidates.filter(
    (candidate) =>
      preferred.includes(candidate) ||
      !preferred.some((p) => p.line.lineId === candidate.line.lineId),
  );
  return resolved.filter(
    (candidate, i) =>
      !resolved
        .slice(0, i)
        .some(
          (p) =>
            p.line.lineId === candidate.line.lineId &&
            p.direction.stops.map((s) => s.choice.id).join() ===
              candidate.direction.stops.map((s) => s.choice.id).join(),
        ),
  );
}

// 車内では駅を先に聞かず、路線を選ぶ。方面の基準には路線内の主な駅を使う。
export function listTrainLines(data: EntryData): EntryLine[] {
  const groups = [...data.catalog.groups].sort((a, b) => b.passengers - a.passengers);
  const seen = new Set<string>();
  return groups.flatMap((group) =>
    listGroupLines(data, group).filter((line) => {
      const id = `${line.lineId}|${line.observedName}`;
      if (seen.has(id)) return false;
      seen.add(id);
      return true;
    }),
  );
}
