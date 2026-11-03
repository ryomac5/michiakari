import { addMinutesToIso, computeWaitArrival, estimateWalkMinutes, type LonLat } from "@repo/core";
import {
  type BlockedSection,
  formatLineName,
  formatRouteLabel,
  formatStationName,
  type GeoIndex,
  type LineInfo as GeoLineInfo,
  normalizeSearchText,
  type Router,
  type StationNode,
} from "@repo/geo";
import { loadGeoIndex, loadRouter } from "@repo/geo/node";
import type { Lang, Place, RouteLeg, RouteOption } from "@repo/schema";
import { findLineNicknameEn } from "./line-names-en.ts";
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

  // packages/geo の表示名は日本語なので、英語の利用者には英語名に付け直す。英語名がなければ日本語名のまま
  function localizeStationName(stationId: string | undefined, fallback: string): string {
    const station = stationId ? geo.getStation(stationId) : undefined;
    return station ? formatStationName(station, "en") : fallback;
  }

  function localizeLineName(leg: RouteLeg): string | undefined {
    const line = leg.lineId ? geo.getLine(leg.lineId) : undefined;
    return line ? formatLineName(line, "en") : leg.line;
  }

  function localizeLeg(leg: RouteLeg): RouteLeg {
    const line = localizeLineName(leg);
    return {
      ...leg,
      from: localizeStationName(leg.fromStationId, leg.from),
      to: localizeStationName(leg.toStationId, leg.to),
      ...(line !== undefined ? { line } : {}),
    };
  }

  // ラベルに使われた路線の区間を探し、その路線の英語名でラベルを作り直す
  function localizeLabel(option: RouteOption): string {
    if (option.kind === "taxi" || option.kind === "walk") {
      return formatRouteLabel({ ...option, line: null }, "en");
    }
    const labelOf = (line: string) => formatRouteLabel({ ...option, line });
    const main = option.legs.find((l) => l.line !== undefined && labelOf(l.line) === option.label);
    if (!main) return option.label;
    return formatRouteLabel({ ...option, line: localizeLineName(main) ?? null }, "en");
  }

  function localizeOption(option: RouteOption, language: Lang): RouteOption {
    if (language === "ja") return option;
    return { ...option, label: localizeLabel(option), legs: option.legs.map(localizeLeg) };
  }

  // 観測の路線名を画面の言語に合わせる。英語に直せなければ null を返し、路線データの名前を使う
  function localizeObservedLine(name: string, language: Lang): string | null {
    if (language === "ja" || !/[^\p{ASCII}]/u.test(name)) return name;
    const nickname = findLineNicknameEn(name);
    if (nickname) return nickname;
    const key = normalizeSearchText(name);
    const line = geo.listLines().find((l) => collectLineKeys(l).includes(key));
    return line?.nameEn ? formatLineName(line, "en") : null;
  }

  // 待つ選択肢のラベルと、止まっている路線の区間の路線名を、利用者の呼び方（観測の line）に揃える
  function applyObservedLine(
    option: RouteOption,
    lineId: string,
    query: AlternativesQuery,
  ): RouteOption {
    const line = query.blockedLine ? localizeObservedLine(query.blockedLine, query.language) : null;
    if (option.kind !== "wait" || line === null) return option;
    if (!option.legs.some((l) => l.lineId === lineId)) return option;
    return {
      ...option,
      label: formatRouteLabel({ kind: "wait", isTransferService: false, line }, query.language),
      legs: option.legs.map((l) => (l.lineId === lineId ? { ...l, line } : l)),
    };
  }

  // 経路を引けないときの待つ選択肢。到着ではなく、乗れる見込みの時刻を示す
  function buildUnroutedWaitOption(query: AlternativesQuery, place: string): RouteOption {
    const legs: RouteLeg[] = [
      { mode: "wait", from: place, to: place, minutes: query.remaining?.p50 ?? 0 },
    ];
    return {
      id: WAIT_OPTION_ID,
      kind: "wait",
      label: query.language === "ja" ? "運転再開を待つ" : "Wait for resumption",
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
      waitOption ??
        buildUnroutedWaitOption(query, formatStationName(origin.station, query.language)),
      ...alternatives,
      taxi,
    ].map((o) =>
      applyObservedLine(
        localizeOption(attachAccessWalks(o, origin, destination, query.language), query.language),
        waitLineId,
        query,
      ),
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
