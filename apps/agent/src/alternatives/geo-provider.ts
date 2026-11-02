import { addMinutesToIso, computeWaitArrival, estimateWalkMinutes, type LonLat } from "@repo/core";
import {
  type BlockedSection,
  formatLineName,
  type GeoIndex,
  type LineInfo as GeoLineInfo,
  normalizeSearchText,
  type Router,
  type StationNode,
} from "@repo/geo";
import { loadGeoIndex, loadRouter } from "@repo/geo/node";
import type { Lang, Place, RouteLeg, RouteOption } from "@repo/schema";
import type {
  AlternativesProvider,
  AlternativesQuery,
  AlternativesResult,
  LineInfo,
  ResolvedPlace,
} from "./provider.ts";

// 国土数値情報の路線ネットワーク（packages/geo）による代替手段の算出

const WAIT_OPTION_ID = "wait";

export type GeoDeps = {
  router: Router;
  geo: GeoIndex;
};

let sharedDeps: GeoDeps | null = null;

// 路線ネットワークは 1 回だけ読み、プロセス内で使い回す
export function loadSharedGeoDeps(): GeoDeps {
  sharedDeps ??= { router: loadRouter(), geo: loadGeoIndex() };
  return sharedDeps;
}

type Endpoint = {
  station: StationNode;
  // 現在地や目的地が座標のとき、駅までの徒歩（分）
  accessWalkMinutes: number;
  coord: LonLat;
};

function normalizeStationName(name: string): string {
  return name.trim().replace(/駅$/, "");
}

function collectLineKeys(line: GeoLineInfo): string[] {
  return [formatLineName(line), line.lineName, line.operator + line.lineName, ...line.aliases]
    .map(normalizeSearchText)
    .filter((k) => k.length > 0);
}

function sumWalkMinutes(legs: readonly RouteLeg[]): number {
  return legs.filter((l) => l.mode === "walk").reduce((sum, l) => sum + l.minutes, 0);
}

export function createGeoProvider(deps: GeoDeps = loadSharedGeoDeps()): AlternativesProvider {
  const { router, geo } = deps;

  function resolveStation(name: string, lineHint: string | null): StationNode | null {
    const id = router.resolveStationId(normalizeStationName(name), lineHint ?? undefined);
    return id ? (geo.getStation(id) ?? null) : null;
  }

  function resolveEndpoint(place: Place, lineHint: string | null): Endpoint | null {
    if (place.kind === "station") {
      const station = resolveStation(place.name, lineHint);
      return station ? { station, accessWalkMinutes: 0, coord: station.lonLat } : null;
    }
    const coord: LonLat = [place.lon, place.lat];
    const nearest = geo.findNearestStations(coord, 1)[0];
    if (!nearest) return null;
    return {
      station: nearest.station,
      accessWalkMinutes: estimateWalkMinutes(coord, nearest.station.lonLat),
      coord,
    };
  }

  // 2 駅を結ぶ路線のうち、路線名の手がかりに合うものを止まっている区間とする
  function findBlockedSection(
    from: StationNode,
    to: StationNode,
    lineHint: string | null,
  ): BlockedSection | null {
    const candidates = geo.listLinesBetween(from.stationId, to.stationId);
    const hint = lineHint ? normalizeSearchText(lineHint) : null;
    const chosen =
      (hint ? candidates.find((c) => collectLineKeys(c.line).includes(hint)) : undefined) ??
      candidates[0];
    return chosen
      ? {
          lineId: chosen.line.lineId,
          fromStationId: chosen.from.stationId,
          toStationId: chosen.to.stationId,
        }
      : null;
  }

  function resolveBlockedSection(
    query: AlternativesQuery,
    origin: Endpoint,
    destination: Endpoint,
  ): BlockedSection | null {
    const section = query.blockedSection;
    if (section) {
      const from = resolveStation(section.fromStation, query.blockedLine);
      const to = resolveStation(section.toStation, query.blockedLine);
      const found = from && to ? findBlockedSection(from, to, query.blockedLine) : null;
      if (found) return found;
    }
    // 区間が分からなければ、出発地と目的地を結ぶ路線が止まっているとみなす
    return findBlockedSection(origin.station, destination.station, query.blockedLine);
  }

  // 座標の地点なら、駅までの徒歩を前後に足して到着時刻をずらす
  function attachAccessWalks(
    option: RouteOption,
    origin: Endpoint,
    destination: Endpoint,
    language: Lang,
  ): RouteOption {
    const extra = origin.accessWalkMinutes + destination.accessWalkMinutes;
    if (extra === 0) return option;
    const here = language === "ja" ? "現在地" : "Current location";
    const there = language === "ja" ? "目的地" : "Destination";
    const legs: RouteLeg[] = [
      ...(origin.accessWalkMinutes > 0
        ? [
            {
              mode: "walk" as const,
              from: here,
              to: origin.station.name,
              minutes: origin.accessWalkMinutes,
              toStationId: origin.station.stationId,
            },
          ]
        : []),
      ...option.legs,
      ...(destination.accessWalkMinutes > 0
        ? [
            {
              mode: "walk" as const,
              from: destination.station.name,
              to: there,
              minutes: destination.accessWalkMinutes,
              fromStationId: destination.station.stationId,
            },
          ]
        : []),
    ];
    return {
      ...option,
      legs,
      arrivalTime: addMinutesToIso(option.arrivalTime, extra),
      walkMinutes: sumWalkMinutes(legs),
    };
  }

  // packages/geo の表示名は日本語なので、英語の利用者には付け直す
  function translateLabel(option: RouteOption, language: Lang): RouteOption {
    if (language === "ja") return option;
    const line = option.label.replace(/(の運転再開を待つ|で振替|経由)$/, "");
    const label =
      option.kind === "wait"
        ? `Wait for ${line} to resume`
        : option.kind === "taxi"
          ? "Taxi"
          : option.kind === "walk"
            ? "Walk"
            : option.isTransferService
              ? `Transfer service via ${line}`
              : `Via ${line}`;
    return { ...option, label };
  }

  // 経路を引けないときの待つ選択肢。到着ではなく、乗れる見込みの時刻を示す
  function buildUnroutedWaitOption(query: AlternativesQuery, place: string): RouteOption {
    const legs: RouteLeg[] = [
      { mode: "wait", from: place, to: place, minutes: query.remaining?.p50 ?? 0 },
    ];
    return {
      id: WAIT_OPTION_ID,
      kind: "wait",
      label:
        query.language === "ja"
          ? "運転再開を待つ（乗車後の所要時間は不明）"
          : "Wait for resumption (travel time unknown)",
      legs,
      arrivalTime: addMinutesToIso(query.now, query.remaining?.p50 ?? 0),
      fareYen: null,
      walkMinutes: 0,
      isTransferService: false,
    };
  }

  async function findAlternatives(query: AlternativesQuery): Promise<AlternativesResult> {
    const origin = resolveEndpoint(query.origin, query.blockedLine);
    const destination = resolveEndpoint(query.destination, query.blockedLine);
    if (!origin || !destination) {
      const place =
        query.origin.kind === "station"
          ? query.origin.name
          : query.language === "ja"
            ? "現在地"
            : "Current location";
      return {
        options: [buildUnroutedWaitOption(query, place)],
        waitOptionId: WAIT_OPTION_ID,
        waitRouteMinutesAfterResume: null,
        notes: ["出発地または目的地を路線ネットワークで見つけられませんでした"],
      };
    }

    const blocked = resolveBlockedSection(query, origin, destination);
    const waitLineId = blocked?.lineId ?? origin.station.lineId;
    const waitRoute = router.computeWaitRouteMinutes({
      originStationId: origin.station.stationId,
      destinationStationId: destination.station.stationId,
      lineId: waitLineId,
      departureTime: query.now,
    });
    const notes: string[] = [];
    if (!blocked) notes.push("止まっている区間を路線ネットワーク上で特定できませんでした");

    const waitOption = waitRoute
      ? router.buildWaitOption({
          originStationId: origin.station.stationId,
          destinationStationId: destination.station.stationId,
          lineId: waitLineId,
          now: query.now,
          arrivalTime: computeWaitArrival(query.now, query.remaining?.p50 ?? 0, waitRoute.minutes),
        })
      : null;
    const alternatives = router.findAlternativeRoutes({
      originStationId: origin.station.stationId,
      destinationStationId: destination.station.stationId,
      blockedSection: blocked,
      departureTime: query.now,
      transferServiceActive: query.transferServiceActive === true,
    });
    const taxi = router.buildTaxiOption({
      originStationId: origin.station.stationId,
      destinationStationId: destination.station.stationId,
      departureTime: query.now,
    });

    const options = [
      waitOption ?? buildUnroutedWaitOption(query, origin.station.name),
      ...alternatives,
      taxi,
    ].map((o) =>
      translateLabel(attachAccessWalks(o, origin, destination, query.language), query.language),
    );

    return {
      options,
      waitOptionId: WAIT_OPTION_ID,
      waitRouteMinutesAfterResume: waitRoute
        ? waitRoute.minutes + origin.accessWalkMinutes + destination.accessWalkMinutes
        : null,
      notes: [
        ...notes,
        "乗車時間は国土数値情報の路線距離と表定速度の推定から求めた概算。時刻表にもとづく値ではない",
      ],
    };
  }

  function resolvePlace(place: Place): ResolvedPlace | null {
    const endpoint = resolveEndpoint(place, null);
    return endpoint ? { name: endpoint.station.name, coord: endpoint.station.lonLat } : null;
  }

  function listLines(): readonly LineInfo[] {
    return geo.listLines().flatMap((line) =>
      [...new Set([formatLineName(line), ...line.aliases])].map((name) => ({
        name,
        operator: line.operator,
      })),
    );
  }

  return { findAlternatives, resolvePlace, listLines };
}
