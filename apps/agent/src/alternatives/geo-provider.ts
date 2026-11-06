import {
  addMinutesToIso,
  BUS_CHECK_MAX_WALK_MINUTES,
  BUS_STOP_SAME_NAME_METERS,
  computeInCarWaitArrival,
  computeWaitArrival,
  estimateWalkMinutes,
  type LonLat,
} from "@repo/core";
import {
  type BlockedSection,
  type BusStop,
  formatLineName,
  formatRouteLabel,
  formatStationName,
  type GeoIndex,
  type LineInfo as GeoLineInfo,
  listLineDirections,
  listWalkAccessBusStops,
  normalizeSearchText,
  type Router,
  type StationNode,
} from "@repo/geo";
import { loadBusStopMeta, loadBusStops, loadGeoIndex, loadRouter } from "@repo/geo/node";
import {
  BUS_CHECK_LIMIT,
  type BusCheck,
  type Lang,
  type Place,
  type RouteLeg,
  type RouteOption,
} from "@repo/schema";
import { findLineNicknameEn } from "./line-names-en.ts";
import type {
  AlternativesProvider,
  AlternativesQuery,
  AlternativesResult,
  LineInfo,
  ResolvedPlace,
  StationsAhead,
  StationsAheadQuery,
} from "./provider.ts";

// 国土数値情報の路線ネットワーク（packages/geo）による代替手段の算出

const WAIT_OPTION_ID = "wait";

export type GeoDeps = {
  router: Router;
  geo: GeoIndex;
  // バス停留所。生成物が無ければ空
  busStops: readonly BusStop[];
  // バス停の位置情報の資料の年。生成物が無ければ null
  busStopYear: number | null;
};

let sharedDeps: GeoDeps | null = null;

// 路線ネットワークは 1 回だけ読み、プロセス内で使い回す
export function loadSharedGeoDeps(): GeoDeps {
  sharedDeps ??= {
    router: loadRouter(),
    geo: loadGeoIndex(),
    busStops: loadBusStops(),
    busStopYear: loadBusStopMeta()?.dataYear ?? null,
  };
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
  const { router, geo, busStops, busStopYear } = deps;

  // 起点から歩いて確かめに行けるバス停。時刻を持たないので確認先の候補にとどめる
  function listBusChecksAt(coord: LonLat, dataYear: number): BusCheck[] {
    return listWalkAccessBusStops({
      stops: busStops,
      origin: coord,
      maxWalkMinutes: BUS_CHECK_MAX_WALK_MINUTES,
      sameNameMeters: BUS_STOP_SAME_NAME_METERS,
      limit: BUS_CHECK_LIMIT,
    }).flatMap(({ name, stops, walkMinutes }) => {
      const [nearest] = stops;
      if (!nearest) return [];
      return [
        {
          id: nearest.id,
          stopName: name,
          operators: stops.map((s) => ({ name: s.operator, officialUrl: s.officialUrl })),
          lon: nearest.lonLat[0],
          lat: nearest.lonLat[1],
          walkMinutes,
          dataYear,
        },
      ];
    });
  }

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

  // 止まっている区間を、同じ向きの路線の終わりの駅まで延ばす。向きを引けなければそのまま
  function extendToDirectionEnd(section: BlockedSection): BlockedSection {
    const line = geo.getLine(section.lineId);
    if (!line) return section;
    const direction = listLineDirections(line, section.fromStationId).find((d) =>
      d.stationIds.includes(section.toStationId),
    );
    const end = direction?.stationIds.at(-1);
    return end ? { ...section, toStationId: end } : section;
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
      // 駅間の車内のために作った区間で、終わりが別の路線の駅なら、区間の始まりから出発地を通って、その向きの終わりまでを止まっている区間にする
      // 行き先が別の路線にあるとき、止まっている路線に乗る経路を代替手段に数えない。駅にいる人の区間は延ばさない
      const toOrigin =
        from && query.blockedSectionFromTrain
          ? findBlockedSection(from, origin.station, query.blockedLine)
          : null;
      if (toOrigin) return extendToDirectionEnd(toOrigin);
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
      label: query.language === "ja" ? "運転再開を待つ" : "Wait for service to restart",
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
    // 代替手段は乗り出せる時刻から探す。駅間の車内なら次の駅に着く見込みの時刻
    const departureTime = query.departureTime ?? query.now;

    // 乗ったまま待つ側は、再開後に前の列車が先に発車するぶんも待つ
    const extraWait = query.extraWaitMinutesAfterResume ?? 0;
    const waitOption = waitRoute
      ? router.buildWaitOption({
          originStationId: origin.station.stationId,
          destinationStationId: destination.station.stationId,
          lineId: waitLineId,
          now: query.now,
          // 駅間の車内なら、降りる駅に着く見込みを起点にそろえる。代わりの手段と同じ起点で比べるため
          // 車内の人はすでに乗っているので、初列車待ちを除いた再開の見込みを使う。列車の位置の推定と同じ扱い
          arrivalTime: query.departureTime
            ? computeInCarWaitArrival({
                now: query.now,
                remainingMinutes: Math.max(
                  0,
                  (query.remaining?.p50 ?? 0) - (query.firstTrainWaitMinutes ?? 0),
                ),
                extraWaitMinutes: extraWait,
                alightArrival: query.departureTime,
                routeMinutes: waitRoute.minutes,
              })
            : computeWaitArrival(
                query.now,
                query.remaining?.p50 ?? 0,
                waitRoute.minutes + extraWait,
              ),
        })
      : null;
    const alternatives = router.findAlternativeRoutes({
      originStationId: origin.station.stationId,
      destinationStationId: destination.station.stationId,
      blockedSection: blocked,
      departureTime,
      transferServiceActive: query.transferServiceActive === true,
    });
    const taxi = router.buildTaxiOption({
      originStationId: origin.station.stationId,
      destinationStationId: destination.station.stationId,
      departureTime,
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
        ? waitRoute.minutes + extraWait + origin.accessWalkMinutes + destination.accessWalkMinutes
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

  // 来た側の駅から次の駅へ向かう向きで、同じ路線の先の駅を並べる。走行時間は駅間ごとに経路探索で求める
  function listStationsAhead(query: StationsAheadQuery): StationsAhead | null {
    const previous = resolveStation(query.previousStation, query.line);
    const next = resolveStation(query.nextStation, query.line);
    if (!previous || !next) return null;
    const section = findBlockedSection(previous, next, query.line);
    const line = section ? geo.getLine(section.lineId) : undefined;
    if (!section || !line) return null;
    const direction = listLineDirections(line, section.fromStationId).find((d) =>
      d.stationIds.includes(section.toStationId),
    );
    if (!direction) return null;
    const start = direction.stationIds.indexOf(section.toStationId);
    const ids = direction.stationIds.slice(start, start + Math.max(1, query.limit));
    let fromId = section.fromStationId;
    const stations: StationsAhead["stations"] = [];
    for (const id of ids) {
      const station = geo.getStation(id);
      if (!station) break;
      const ride = router.computeWaitRouteMinutes({
        originStationId: fromId,
        destinationStationId: id,
        lineId: section.lineId,
        departureTime: query.departureTime,
      });
      if (!ride) break;
      stations.push({ name: station.name, rideMinutesFromPrevious: ride.minutes });
      fromId = id;
    }
    return stations.length > 0 ? { lineId: section.lineId, stations } : null;
  }

  function listBusChecks(place: Place): BusCheck[] {
    const origin = resolveEndpoint(place, null);
    if (!origin || busStopYear === null) return [];
    return listBusChecksAt(origin.coord, busStopYear);
  }

  return { findAlternatives, resolvePlace, listLines, listStationsAhead, listBusChecks };
}
