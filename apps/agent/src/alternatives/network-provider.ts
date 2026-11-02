import {
  classifyTimeOfDay,
  computeArrival,
  computeHaversineMeters,
  computeRideMinutes,
  computeTaxiFare,
  computeWaitMinutes,
  estimateWalkMinutes,
  type LonLat,
} from "@repo/core";
import type { Lang, Place, RouteLeg, RouteOption, Section } from "@repo/schema";
import { alternativesParams } from "../config.ts";
import { FIXTURE_NETWORK, type FixtureLine, type FixtureNetwork } from "./fixture-network.ts";
import type {
  AlternativesProvider,
  AlternativesQuery,
  AlternativesResult,
  LineInfo,
  ResolvedPlace,
} from "./provider.ts";

// 駅名ベースの簡易プロバイダ。開発用ネットワーク上で最短経路を引く

type Edge =
  | { kind: "board"; line: FixtureLine; minutes: number }
  | { kind: "ride"; line: FixtureLine; minutes: number }
  | { kind: "alight"; line: FixtureLine; minutes: 0 }
  | { kind: "walk"; minutes: number };

type NodeKey = string;

type PathStep = { from: string; to: string; edge: Edge };

type Endpoint = {
  station: string;
  coord: LonLat;
  // 現在地や目的地が座標のとき、駅までの徒歩
  accessWalkMinutes: number;
  label: string;
};

const WAIT_OPTION_ID = "wait";

function normalizeStationName(name: string): string {
  return name.trim().replace(/駅$/, "");
}

function buildNodeKey(station: string, line: string | null): NodeKey {
  return `${station}|${line ?? ""}`;
}

function buildSegmentKey(line: string, a: string, b: string): string {
  return a < b ? `${line}|${a}|${b}` : `${line}|${b}|${a}`;
}

export function createNetworkProvider(network: FixtureNetwork = FIXTURE_NETWORK) {
  const stations = new Map(network.stations.map((s) => [s.name, [s.lon, s.lat] as LonLat]));
  const linesByName = new Map(network.lines.map((l) => [l.name, l]));
  const linesAtStation = new Map<string, FixtureLine[]>();
  for (const line of network.lines) {
    for (const name of line.stations) {
      linesAtStation.set(name, [...(linesAtStation.get(name) ?? []), line]);
    }
  }
  const walkLinks = buildWalkLinks();

  function getCoord(name: string): LonLat {
    const coord = stations.get(name);
    if (!coord) throw new Error(`駅の座標がありません: ${name}`);
    return coord;
  }

  function buildWalkLinks(): Map<string, { to: string; minutes: number }[]> {
    const links = new Map<string, { to: string; minutes: number }[]>();
    for (const a of network.stations) {
      for (const b of network.stations) {
        if (a.name === b.name) continue;
        const meters = computeHaversineMeters([a.lon, a.lat], [b.lon, b.lat]);
        if (meters > alternativesParams.walkLinkMaxMeters) continue;
        const minutes = estimateWalkMinutes([a.lon, a.lat], [b.lon, b.lat]);
        links.set(a.name, [...(links.get(a.name) ?? []), { to: b.name, minutes }]);
      }
    }
    return links;
  }

  function findNearestStation(coord: LonLat): string {
    let best = network.stations[0];
    if (!best) throw new Error("ネットワークに駅がありません");
    let bestMeters = Number.POSITIVE_INFINITY;
    for (const s of network.stations) {
      const meters = computeHaversineMeters(coord, [s.lon, s.lat]);
      if (meters < bestMeters) {
        best = s;
        bestMeters = meters;
      }
    }
    return best.name;
  }

  function resolveEndpoint(place: Place, language: Lang, role: "origin" | "destination") {
    if (place.kind === "station") {
      const name = normalizeStationName(place.name);
      const coord = stations.get(name);
      return coord ? { station: name, coord, accessWalkMinutes: 0, label: name } : null;
    }
    const coord: LonLat = [place.lon, place.lat];
    const station = findNearestStation(coord);
    const label =
      role === "origin"
        ? language === "ja"
          ? "現在地"
          : "Current location"
        : language === "ja"
          ? "目的地"
          : "Destination";
    return {
      station,
      coord,
      accessWalkMinutes: estimateWalkMinutes(coord, getCoord(station)),
      label,
    } satisfies Endpoint;
  }

  function computeSegmentKm(a: string, b: string): number {
    return (
      (computeHaversineMeters(getCoord(a), getCoord(b)) / 1000) *
      alternativesParams.rideDetourFactor
    );
  }

  // 止まっている区間の駅間を集める。区間が路線上に無ければ路線全体を止める
  function collectBlockedSegments(line: FixtureLine, section: Section | null): Set<string> {
    const blocked = new Set<string>();
    const from = section ? line.stations.indexOf(normalizeStationName(section.fromStation)) : -1;
    const to = section ? line.stations.indexOf(normalizeStationName(section.toStation)) : -1;
    const [start, end] =
      from >= 0 && to >= 0
        ? [Math.min(from, to), Math.max(from, to)]
        : [0, line.stations.length - 1];
    for (let i = start; i < end; i++) {
      const a = line.stations[i];
      const b = line.stations[i + 1];
      if (a && b) blocked.add(buildSegmentKey(line.name, a, b));
    }
    return blocked;
  }

  function findBlockedLines(query: AlternativesQuery, origin: Endpoint, destination: Endpoint) {
    const named = query.blockedLine ? linesByName.get(query.blockedLine) : undefined;
    if (named) return [named];
    // 路線が分からなければ、出発地と目的地を直接結ぶ路線を止まっているとみなす
    return network.lines.filter(
      (l) => l.stations.includes(origin.station) && l.stations.includes(destination.station),
    );
  }

  // 徒歩・乗車・待ちを辺とする最短経路（ダイクストラ法）
  function findShortestPath(
    from: string,
    to: string,
    now: string,
    blockedSegments: Set<string>,
    excludedLines: Set<string>,
  ): PathStep[] | null {
    const timeOfDay = classifyTimeOfDay(now);
    const dist = new Map<NodeKey, number>([[buildNodeKey(from, null), 0]]);
    const prev = new Map<NodeKey, { key: NodeKey; step: PathStep }>();
    const done = new Set<NodeKey>();
    const goal = buildNodeKey(to, null);

    for (;;) {
      let current: NodeKey | null = null;
      let currentDist = Number.POSITIVE_INFINITY;
      for (const [key, d] of dist) {
        if (!done.has(key) && d < currentDist) {
          current = key;
          currentDist = d;
        }
      }
      if (current === null) return null;
      if (current === goal) break;
      done.add(current);

      const [station = "", lineName = ""] = current.split("|");
      const relax = (target: NodeKey, step: PathStep) => {
        const d = currentDist + step.edge.minutes;
        if (d < (dist.get(target) ?? Number.POSITIVE_INFINITY)) {
          dist.set(target, d);
          prev.set(target, { key: current, step });
        }
      };

      if (lineName === "") {
        for (const line of linesAtStation.get(station) ?? []) {
          if (excludedLines.has(line.name)) continue;
          const minutes = computeWaitMinutes(line.lineType, timeOfDay);
          relax(buildNodeKey(station, line.name), {
            from: station,
            to: station,
            edge: { kind: "board", line, minutes },
          });
        }
        for (const link of walkLinks.get(station) ?? []) {
          relax(buildNodeKey(link.to, null), {
            from: station,
            to: link.to,
            edge: { kind: "walk", minutes: link.minutes },
          });
        }
        continue;
      }

      const line = linesByName.get(lineName);
      if (!line) continue;
      relax(buildNodeKey(station, null), {
        from: station,
        to: station,
        edge: { kind: "alight", line, minutes: 0 },
      });
      const index = line.stations.indexOf(station);
      for (const neighbor of [line.stations[index - 1], line.stations[index + 1]]) {
        if (!neighbor || blockedSegments.has(buildSegmentKey(line.name, station, neighbor)))
          continue;
        const minutes = computeRideMinutes(computeSegmentKm(station, neighbor), line.lineType);
        relax(buildNodeKey(neighbor, line.name), {
          from: station,
          to: neighbor,
          edge: { kind: "ride", line, minutes },
        });
      }
    }

    const steps: PathStep[] = [];
    let key = goal;
    for (let entry = prev.get(key); entry; entry = prev.get(key)) {
      steps.unshift(entry.step);
      key = entry.key;
    }
    return steps;
  }

  // 経路の辺を RouteLeg に直す。同じ路線の連続した乗車は 1 区間にまとめる
  function convertStepsToLegs(steps: readonly PathStep[]): RouteLeg[] {
    const legs: RouteLeg[] = [];
    let ride: { line: FixtureLine; from: string; to: string; km: number } | null = null;
    const flushRide = () => {
      if (!ride) return;
      legs.push({
        mode: "ride",
        from: ride.from,
        to: ride.to,
        minutes: computeRideMinutes(ride.km, ride.line.lineType),
        line: ride.line.name,
      });
      ride = null;
    };
    for (const step of steps) {
      const { edge } = step;
      if (edge.kind === "ride") {
        if (ride && ride.line.name === edge.line.name) {
          ride.to = step.to;
          ride.km += computeSegmentKm(step.from, step.to);
        } else {
          flushRide();
          ride = {
            line: edge.line,
            from: step.from,
            to: step.to,
            km: computeSegmentKm(step.from, step.to),
          };
        }
        continue;
      }
      flushRide();
      if (edge.kind === "walk") {
        legs.push({ mode: "walk", from: step.from, to: step.to, minutes: edge.minutes });
      } else if (edge.kind === "board") {
        legs.push({
          mode: "wait",
          from: step.from,
          to: step.to,
          minutes: edge.minutes,
          line: edge.line.name,
        });
      }
    }
    flushRide();
    return legs;
  }

  function wrapWithAccess(legs: RouteLeg[], origin: Endpoint, destination: Endpoint): RouteLeg[] {
    const wrapped = [...legs];
    if (origin.accessWalkMinutes > 0) {
      wrapped.unshift({
        mode: "walk",
        from: origin.label,
        to: origin.station,
        minutes: origin.accessWalkMinutes,
      });
    }
    if (destination.accessWalkMinutes > 0) {
      wrapped.push({
        mode: "walk",
        from: destination.station,
        to: destination.label,
        minutes: destination.accessWalkMinutes,
      });
    }
    return wrapped;
  }

  function sumWalkMinutes(legs: readonly RouteLeg[]): number {
    return legs.filter((l) => l.mode === "walk").reduce((sum, l) => sum + l.minutes, 0);
  }

  // 再開後に乗ってから着くまでの区間。止まっている路線で直通できればその乗車、無ければ平常時の最短経路
  function buildResumedRouteLegs(
    query: AlternativesQuery,
    origin: Endpoint,
    destination: Endpoint,
    blockedLines: readonly FixtureLine[],
  ): RouteLeg[] | null {
    const direct = blockedLines.find(
      (l) => l.stations.includes(origin.station) && l.stations.includes(destination.station),
    );
    if (direct) {
      const a = direct.stations.indexOf(origin.station);
      const b = direct.stations.indexOf(destination.station);
      const ordered = direct.stations.slice(Math.min(a, b), Math.max(a, b) + 1);
      let km = 0;
      for (let i = 0; i + 1 < ordered.length; i++) {
        km += computeSegmentKm(ordered[i] ?? "", ordered[i + 1] ?? "");
      }
      return [
        {
          mode: "ride",
          from: origin.station,
          to: destination.station,
          minutes: computeRideMinutes(km, direct.lineType),
          line: direct.name,
        },
      ];
    }
    const steps = findShortestPath(
      origin.station,
      destination.station,
      query.now,
      new Set(),
      new Set(),
    );
    // 待つ選択肢では最初の列車待ちを残り時間に含めるので、乗る前の待ちを除く
    return steps ? convertStepsToLegs(steps).filter((l) => l.mode !== "wait") : null;
  }

  function buildWaitOption(
    query: AlternativesQuery,
    origin: Endpoint,
    destination: Endpoint,
    resumedLegs: RouteLeg[] | null,
  ): RouteOption {
    const ja = query.language === "ja";
    const waitMinutes = query.remaining?.p50 ?? 0;
    const legs = wrapWithAccess(
      [
        {
          mode: "wait",
          from: origin.station,
          to: origin.station,
          minutes: waitMinutes,
          ...(query.blockedLine ? { line: query.blockedLine } : {}),
        },
        ...(resumedLegs ?? []),
      ],
      origin,
      destination,
    );
    const label =
      query.remaining === null
        ? ja
          ? "運転再開を待つ（再開時刻は不明）"
          : "Wait for resumption (time unknown)"
        : ja
          ? "運転再開を待つ"
          : "Wait for resumption";
    return {
      id: WAIT_OPTION_ID,
      kind: "wait",
      label,
      legs,
      arrivalTime: computeArrival(query.now, legs),
      fareYen: null,
      walkMinutes: sumWalkMinutes(legs),
      isTransferService: false,
    };
  }

  // 経路を引けないときの待つ選択肢。到着ではなく、乗れる見込みの時刻を示す
  function buildUnroutedWaitOption(query: AlternativesQuery): RouteOption {
    const place =
      query.origin.kind === "station"
        ? query.origin.name
        : query.language === "ja"
          ? "現在地"
          : "Current location";
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
      arrivalTime: computeArrival(query.now, legs),
      fareYen: null,
      walkMinutes: 0,
      isTransferService: false,
    };
  }

  function buildTransferOption(
    query: AlternativesQuery,
    id: string,
    legs: RouteLeg[],
  ): RouteOption {
    const lines = [...new Set(legs.flatMap((l) => (l.mode === "ride" && l.line ? [l.line] : [])))];
    const ja = query.language === "ja";
    return {
      id,
      kind: "transfer",
      label: ja ? `${lines.join("・")}経由` : `Via ${lines.join(" / ")}`,
      legs,
      arrivalTime: computeArrival(query.now, legs),
      fareYen: null,
      walkMinutes: sumWalkMinutes(legs),
      isTransferService: query.transferServiceActive === true,
    };
  }

  function buildTaxiOption(
    query: AlternativesQuery,
    origin: Endpoint,
    destination: Endpoint,
  ): RouteOption {
    const km =
      (computeHaversineMeters(origin.coord, destination.coord) / 1000) *
      alternativesParams.taxiRoadFactor;
    const fare = computeTaxiFare(km, query.now);
    const legs: RouteLeg[] = [
      {
        mode: "wait",
        from: origin.label,
        to: origin.label,
        minutes: alternativesParams.taxiPickupMinutes,
      },
      {
        mode: "taxi",
        from: origin.label,
        to: destination.label,
        minutes: Math.ceil((km / alternativesParams.taxiSpeedKmh) * 60),
      },
    ];
    return {
      id: "taxi",
      kind: "taxi",
      label: query.language === "ja" ? "タクシー" : "Taxi",
      legs,
      arrivalTime: computeArrival(query.now, legs),
      fareYen: fare.fareYen,
      walkMinutes: 0,
      isTransferService: false,
    };
  }

  function buildWalkOption(
    query: AlternativesQuery,
    origin: Endpoint,
    destination: Endpoint,
  ): RouteOption | null {
    const minutes = estimateWalkMinutes(origin.coord, destination.coord);
    if (minutes > alternativesParams.maxWalkOptionMinutes) return null;
    const legs: RouteLeg[] = [{ mode: "walk", from: origin.label, to: destination.label, minutes }];
    return {
      id: "walk",
      kind: "walk",
      label: query.language === "ja" ? "歩く" : "Walk",
      legs,
      arrivalTime: computeArrival(query.now, legs),
      fareYen: null,
      walkMinutes: minutes,
      isTransferService: false,
    };
  }

  // 1 本目、1 本目の主な路線を除いた 2 本目、の順に振替経路を引く
  function findTransferOptions(
    query: AlternativesQuery,
    origin: Endpoint,
    destination: Endpoint,
    blockedSegments: Set<string>,
  ): RouteOption[] {
    const first = findShortestPath(
      origin.station,
      destination.station,
      query.now,
      blockedSegments,
      new Set(),
    );
    if (!first?.some((s) => s.edge.kind === "ride")) return [];
    const firstOption = buildTransferOption(
      query,
      "transfer_1",
      wrapWithAccess(convertStepsToLegs(first), origin, destination),
    );

    const firstLine = first.find((s) => s.edge.kind === "ride")?.edge;
    const excluded = new Set(firstLine && firstLine.kind === "ride" ? [firstLine.line.name] : []);
    const second = findShortestPath(
      origin.station,
      destination.station,
      query.now,
      blockedSegments,
      excluded,
    );
    if (!second?.some((s) => s.edge.kind === "ride")) return [firstOption];
    const secondOption = buildTransferOption(
      query,
      "transfer_2",
      wrapWithAccess(convertStepsToLegs(second), origin, destination),
    );
    const gapMinutes =
      (Date.parse(secondOption.arrivalTime) - Date.parse(firstOption.arrivalTime)) / 60_000;
    return gapMinutes <= alternativesParams.secondTransferWithinMinutes
      ? [firstOption, secondOption]
      : [firstOption];
  }

  async function findAlternatives(query: AlternativesQuery): Promise<AlternativesResult> {
    const origin = resolveEndpoint(query.origin, query.language, "origin");
    const destination = resolveEndpoint(query.destination, query.language, "destination");
    if (!origin || !destination) {
      return {
        options: [buildUnroutedWaitOption(query)],
        waitOptionId: WAIT_OPTION_ID,
        waitRouteMinutesAfterResume: null,
        notes: ["出発地または目的地を開発用ネットワークで見つけられませんでした"],
      };
    }

    const blockedLines = findBlockedLines(query, origin, destination);
    const blockedSegments = new Set(
      blockedLines.flatMap((l) => [...collectBlockedSegments(l, query.blockedSection)]),
    );
    const resumedLegs = buildResumedRouteLegs(query, origin, destination, blockedLines);
    const waitRouteMinutesAfterResume =
      resumedLegs === null
        ? null
        : resumedLegs.reduce((sum, l) => sum + l.minutes, 0) +
          origin.accessWalkMinutes +
          destination.accessWalkMinutes;

    const options: RouteOption[] = [buildWaitOption(query, origin, destination, resumedLegs)];
    options.push(...findTransferOptions(query, origin, destination, blockedSegments));
    const walk = buildWalkOption(query, origin, destination);
    if (walk) options.push(walk);
    options.push(buildTaxiOption(query, origin, destination));

    return {
      options,
      waitOptionId: WAIT_OPTION_ID,
      waitRouteMinutesAfterResume,
      notes: [
        "開発用の簡易ネットワークによる概算。乗車時間は駅間の直線距離と表定速度の推定から求めた",
      ],
    };
  }

  function resolvePlace(place: Place): ResolvedPlace | null {
    const endpoint = resolveEndpoint(place, "ja", "origin");
    return endpoint ? { name: endpoint.station, coord: endpoint.coord } : null;
  }

  function listLines(): readonly LineInfo[] {
    return network.lines.map((l) => ({ name: l.name, operator: l.operator }));
  }

  return { findAlternatives, resolvePlace, listLines } satisfies AlternativesProvider;
}
