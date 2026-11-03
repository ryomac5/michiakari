import {
  addMinutesToIso,
  classifyTimeOfDay,
  computeArrival,
  computeHaversineMeters,
  computeRideMinutes,
  computeRideMinutesUnrounded,
  computeTaxiFare,
  computeTaxiMinutes,
  computeWaitMinutes,
  diffMinutes,
  estimateTaxiRoadKm,
  estimateWalkMinutes,
  MAX_ROUTE_CANDIDATES,
  MAX_ROUTE_RATIO_TO_BEST,
  OTHER_LINE_PENALTY_MINUTES,
  REDUCED_TRANSFER_PENALTY_MINUTES,
  REDUCED_WALK_COST_FACTOR,
  sumLegMinutes,
  type TimeOfDay,
  WALK_ONLY_MAX_MINUTES,
  WALK_ONLY_MAX_MINUTES_REDUCED,
} from "@repo/core";
import type { Lang, RouteLeg, RouteOption } from "@repo/schema";
import { applyNetworkCorrections } from "./corrections.ts";
import { createGeoIndex } from "./geo-index.ts";
import { buildNetworkGraph, type NetworkGraph } from "./graph.ts";
import { normalizeSearchText } from "./text.ts";
import type { LineInfo, LineType, NetworkData, StationNode } from "./types.ts";

// 止まっている区間を避けた代替経路の探索。所要時間はすべて packages/core で計算する

// 止まっている区間。lineId 上で 2 駅の間にある隣接辺をすべて除く
export type BlockedSection = {
  lineId: string;
  fromStationId: string;
  toStationId: string;
};

export type RouteConstraints = {
  // 徒歩を減らしたい
  reduceWalking?: boolean;
  // 乗換を減らしたい
  reduceTransfers?: boolean;
};

export type FindAlternativeRoutesInput = {
  originStationId: string;
  destinationStationId: string;
  blockedSection: BlockedSection | null;
  departureTime: string;
  transferServiceActive: boolean;
  constraints?: RouteConstraints;
};

export type TaxiOptionInput = {
  originStationId: string;
  destinationStationId: string;
  departureTime: string;
};

export type WaitRouteInput = {
  originStationId: string;
  destinationStationId: string;
  // 再開を待つ路線
  lineId: string;
  // 時間帯の判定に使う時刻。再開見込みの時刻を渡す
  departureTime: string;
};

export type WaitRoute = {
  // 再開後に乗ってから着くまでの分。最初に止まっている路線へ乗るときの待ちは含めない
  minutes: number;
  legs: RouteLeg[];
};

export type WaitOptionInput = {
  originStationId: string;
  destinationStationId: string;
  lineId: string;
  now: string;
  // 呼び出し側が core の再開見込みから求めた到着時刻
  arrivalTime: string;
};

export type Router = {
  resolveStationId: (name: string, lineHint?: string) => string | null;
  findAlternativeRoutes: (input: FindAlternativeRoutesInput) => RouteOption[];
  buildTaxiOption: (input: TaxiOptionInput) => RouteOption;
  buildWaitOption: (input: WaitOptionInput) => RouteOption | null;
  computeWaitRouteMinutes: (input: WaitRouteInput) => WaitRoute | null;
};

// 探索の状態。0: まだ乗っていない、1: 乗車中、2: 一度乗って降りた
type Phase = 0 | 1 | 2;

type RideStep = {
  kind: "ride";
  from: string;
  to: string;
  lineId: string;
  lineType: LineType;
  distanceKm: number;
  boarding: boolean;
};

type WalkStep = { kind: "walk"; from: string; to: string; minutes: number };

type Step = RideStep | WalkStep;

type SearchOptions = {
  originStationId: string;
  destinationStationId: string;
  departureTime: string;
  blockedEdges: ReadonlySet<string>;
  // 乗らない路線。候補を多様にするため、前の候補の主な路線を除く
  bannedLines: ReadonlySet<string>;
  walkCostFactor: number;
  transferPenalty: number;
  // 指定すると、この路線以外に乗るたびに罰則を足し、最初にこの路線へ乗る待ちを数えない
  preferredLineId?: string;
};

type Label = {
  cost: number;
  minutes: number;
  prevKey: string | null;
  step: Step | null;
};

const OPERATOR_PREFIXES: Readonly<Record<string, string>> = {
  "osaka-metro": "地下鉄",
  "kyoto-subway": "地下鉄",
  "kobe-subway": "地下鉄",
};

const toStateKey = (stationId: string, phase: Phase) => `${phase}|${stationId}`;

const toEdgeKey = (lineId: string, a: string, b: string) =>
  a < b ? `${lineId}|${a}|${b}` : `${lineId}|${b}|${a}`;

function formatLineNameJa(line: LineInfo): string {
  if (line.operatorKey === "jr-west") {
    const name = line.aliases.length === 1 ? (line.aliases[0] as string) : line.lineName;
    return name.startsWith("JR") ? name : `JR${name}`;
  }
  if (line.lineName.startsWith(line.operator)) return line.lineName;
  return `${OPERATOR_PREFIXES[line.operatorKey] ?? line.operator}${line.lineName}`;
}

// 画面に出す短い路線名。例: 阪急神戸線、JR神戸線、地下鉄御堂筋線、Hankyu Kobe Line
// 英語名のない路線は日本語名で代用する
export function formatLineName(line: LineInfo, language: Lang = "ja"): string {
  return language === "en" && line.nameEn ? line.nameEn : formatLineNameJa(line);
}

// 画面に出す駅名。英語名のない駅は日本語名で代用する
export function formatStationName(station: StationNode, language: Lang = "ja"): string {
  return language === "en" && station.nameEn ? station.nameEn : station.name;
}

export type RouteLabelInput = Pick<RouteOption, "kind" | "isTransferService"> & {
  // 待つ選択肢では待つ路線、乗換の選択肢では主に乗る路線の表示名
  line: string | null;
};

// 選択肢のラベル。路線名は呼び出し側が言語に合わせて渡す
export function formatRouteLabel(input: RouteLabelInput, language: Lang = "ja"): string {
  const ja = language === "ja";
  const { kind, line } = input;
  if (kind === "taxi") return ja ? "タクシー" : "Taxi";
  if (kind === "walk" || line === null) return ja ? "徒歩で移動" : "Walk";
  if (kind === "wait") return ja ? `${line}の運転再開を待つ` : `Wait for ${line} to resume`;
  if (input.isTransferService) return ja ? `${line}で振替` : `Transfer service via ${line}`;
  return ja ? `${line}経由` : `Via ${line}`;
}

// 最小ヒープ。遅延削除で使う
function createMinHeap() {
  const items: { key: string; cost: number }[] = [];
  const swap = (i: number, j: number) => {
    const t = items[i] as { key: string; cost: number };
    items[i] = items[j] as { key: string; cost: number };
    items[j] = t;
  };
  const costAt = (i: number) => (items[i] as { cost: number }).cost;
  return {
    push(key: string, cost: number) {
      items.push({ key, cost });
      let i = items.length - 1;
      while (i > 0) {
        const parent = (i - 1) >> 1;
        if (costAt(parent) <= costAt(i)) break;
        swap(i, parent);
        i = parent;
      }
    },
    pop(): { key: string; cost: number } | undefined {
      const top = items[0];
      const last = items.pop();
      if (top === undefined || last === undefined || items.length === 0) return top;
      items[0] = last;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1;
        const r = l + 1;
        let m = i;
        if (l < items.length && costAt(l) < costAt(m)) m = l;
        if (r < items.length && costAt(r) < costAt(m)) m = r;
        if (m === i) break;
        swap(i, m);
        i = m;
      }
      return top;
    },
  };
}

// 同じ路線の辺だけをたどり、2駅の間にある辺のキーを返す
function collectLineEdgeKeys(
  graph: NetworkGraph,
  lineId: string,
  from: string,
  to: string,
): string[] | null {
  const dist = new Map<string, number>([[from, 0]]);
  const prev = new Map<string, string>();
  const heap = createMinHeap();
  heap.push(from, 0);
  for (let item = heap.pop(); item !== undefined; item = heap.pop()) {
    if (item.cost > (dist.get(item.key) ?? Number.POSITIVE_INFINITY)) continue;
    if (item.key === to) break;
    for (const link of graph.get(item.key) ?? []) {
      if (link.kind !== "ride" || link.lineId !== lineId) continue;
      const nd = item.cost + link.distanceKm;
      if (nd < (dist.get(link.to) ?? Number.POSITIVE_INFINITY)) {
        dist.set(link.to, nd);
        prev.set(link.to, item.key);
        heap.push(link.to, nd);
      }
    }
  }
  if (!dist.has(to)) return null;
  const keys: string[] = [];
  for (let v = to; v !== from; ) {
    const p = prev.get(v) as string;
    keys.push(toEdgeKey(lineId, p, v));
    v = p;
  }
  return keys;
}

// 乗車・乗換を状態つきでたどるダイクストラ。見つからなければ null
function searchShortestSteps(graph: NetworkGraph, options: SearchOptions): Step[] | null {
  const timeOfDayCache = new Map<number, TimeOfDay>();
  const classifyAt = (minutes: number): TimeOfDay => {
    const whole = Math.floor(minutes);
    let timeOfDay = timeOfDayCache.get(whole);
    if (timeOfDay === undefined) {
      timeOfDay = classifyTimeOfDay(addMinutesToIso(options.departureTime, whole));
      timeOfDayCache.set(whole, timeOfDay);
    }
    return timeOfDay;
  };

  const labels = new Map<string, Label>();
  const heap = createMinHeap();
  const startKey = toStateKey(options.originStationId, 0);
  labels.set(startKey, { cost: 0, minutes: 0, prevKey: null, step: null });
  heap.push(startKey, 0);

  const relax = (key: string, label: Label) => {
    const current = labels.get(key);
    if (current !== undefined && current.cost <= label.cost) return;
    labels.set(key, label);
    heap.push(key, label.cost);
  };

  let goalKey: string | null = null;
  for (let item = heap.pop(); item !== undefined; item = heap.pop()) {
    const label = labels.get(item.key) as Label;
    if (item.cost > label.cost) continue;
    const phase = Number(item.key.slice(0, 1)) as Phase;
    const stationId = item.key.slice(2);
    if (stationId === options.destinationStationId && phase !== 0) {
      goalKey = item.key;
      break;
    }

    for (const link of graph.get(stationId) ?? []) {
      if (link.kind === "transfer") {
        const minutes = link.walkMinutes;
        relax(toStateKey(link.to, phase === 0 ? 0 : 2), {
          cost: label.cost + minutes * options.walkCostFactor,
          minutes: label.minutes + minutes,
          prevKey: item.key,
          step: { kind: "walk", from: stationId, to: link.to, minutes },
        });
        continue;
      }
      if (options.blockedEdges.has(toEdgeKey(link.lineId, stationId, link.to))) continue;
      const boarding = phase !== 1;
      if (boarding && options.bannedLines.has(link.lineId)) continue;

      let wait = 0;
      let penalty = 0;
      if (boarding) {
        const skipWait = phase === 0 && link.lineId === options.preferredLineId;
        wait = skipWait ? 0 : computeWaitMinutes(link.lineType, classifyAt(label.minutes));
        if (phase === 2) penalty += options.transferPenalty;
        if (options.preferredLineId !== undefined && link.lineId !== options.preferredLineId) {
          penalty += OTHER_LINE_PENALTY_MINUTES;
        }
      }
      const ride = computeRideMinutesUnrounded(link.distanceKm, link.lineType);
      relax(toStateKey(link.to, 1), {
        cost: label.cost + wait + ride + penalty,
        minutes: label.minutes + wait + ride,
        prevKey: item.key,
        step: {
          kind: "ride",
          from: stationId,
          to: link.to,
          lineId: link.lineId,
          lineType: link.lineType,
          distanceKm: link.distanceKm,
          boarding,
        },
      });
    }
  }
  if (goalKey === null) return null;

  const steps: Step[] = [];
  for (let key: string | null = goalKey; key !== null; ) {
    const label = labels.get(key) as Label;
    if (label.step !== null) steps.push(label.step);
    key = label.prevKey;
  }
  return steps.reverse();
}

// 主な乗車区間。止まっている路線以外で乗車の分が最も長いもの。なければ全乗車区間から選ぶ
// 選択肢の名前と、振替輸送で乗る路線に使う
export function findMainRideLeg(
  legs: readonly RouteLeg[],
  blockedLineId: string | undefined,
): RouteLeg | undefined {
  const rides = legs.filter((l) => l.mode === "ride");
  const others = rides.filter((l) => l.lineId !== blockedLineId);
  return (others.length > 0 ? others : rides).reduce<RouteLeg | undefined>(
    (best, l) => (best === undefined || l.minutes > best.minutes ? l : best),
    undefined,
  );
}

function sumWalkMinutes(legs: readonly RouteLeg[]): number {
  return legs.filter((l) => l.mode === "walk").reduce((sum, l) => sum + l.minutes, 0);
}

function buildLegSignature(legs: readonly RouteLeg[]): string {
  return legs
    .filter((l) => l.mode !== "wait")
    .map((l) => `${l.mode}:${l.fromStationId}>${l.toStationId}:${l.lineId ?? ""}`)
    .join(",");
}

export function createRouter(input: NetworkData): Router {
  const network = applyNetworkCorrections(input);
  const geo = createGeoIndex(network);
  const graph = buildNetworkGraph(network);
  const stationById = new Map(network.nodes.map((n) => [n.stationId, n]));
  const lineById = new Map(network.lines.map((l) => [l.lineId, l]));

  const getStation = (stationId: string): StationNode => {
    const station = stationById.get(stationId);
    if (!station) throw new Error(`駅 ID が見つかりません: ${stationId}`);
    return station;
  };

  const getLineName = (lineId: string): string => {
    const line = lineById.get(lineId);
    return line ? formatLineName(line) : lineId;
  };

  // 指定の駅が lineId 上になければ、同名の lineId 上の駅に読み替える
  const resolveOnLine = (stationId: string, lineId: string): string => {
    const station = getStation(stationId);
    if (station.lineId === lineId) return stationId;
    const same = network.nodes.find((n) => n.lineId === lineId && n.name === station.name);
    if (!same) throw new Error(`${lineId} に ${station.name} がありません`);
    return same.stationId;
  };

  const collectBlockedEdges = (section: BlockedSection | null): Set<string> => {
    if (section === null) return new Set();
    const from = resolveOnLine(section.fromStationId, section.lineId);
    const to = resolveOnLine(section.toStationId, section.lineId);
    const keys = collectLineEdgeKeys(graph, section.lineId, from, to);
    if (keys === null) throw new Error(`止まっている区間を路線上でたどれません: ${from} - ${to}`);
    return new Set(keys);
  };

  const matchLineHint = (lineId: string, hint: string, loose: boolean): boolean => {
    const line = lineById.get(lineId);
    if (!line) return false;
    if (line.lineId === hint) return true;
    const h = normalizeSearchText(hint);
    const keys = [
      line.lineName,
      ...line.aliases,
      formatLineName(line),
      line.operator + line.lineName,
      line.operator,
    ]
      .map(normalizeSearchText)
      .filter((k) => k.length > 0);
    return loose ? keys.some((k) => h.includes(k)) : keys.includes(h);
  };

  // 区間の経路を区間ごとの脚に組み立てる。待ちの分は乗る時刻の時間帯で求める
  const buildLegs = (
    steps: readonly Step[],
    departureTime: string,
    preferredLineId?: string,
  ): RouteLeg[] => {
    const legs: RouteLeg[] = [];
    let elapsed = 0;
    let isFirstBoarding = true;
    const push = (leg: RouteLeg) => {
      legs.push(leg);
      elapsed += leg.minutes;
    };
    let i = 0;
    while (i < steps.length) {
      const step = steps[i] as Step;
      if (step.kind === "walk") {
        let minutes = 0;
        let last = step;
        while (i < steps.length && (steps[i] as Step).kind === "walk") {
          last = steps[i] as WalkStep;
          minutes += last.minutes;
          i++;
        }
        if (minutes > 0) {
          push({
            mode: "walk",
            from: getStation(step.from).name,
            to: getStation(last.to).name,
            minutes,
            fromStationId: step.from,
            toStationId: last.to,
          });
        }
        continue;
      }

      let distanceKm = 0;
      let last = step;
      do {
        last = steps[i] as RideStep;
        distanceKm += last.distanceKm;
        i++;
      } while (
        i < steps.length &&
        (steps[i] as Step).kind === "ride" &&
        !(steps[i] as RideStep).boarding
      );
      const line = getLineName(step.lineId);
      const from = getStation(step.from).name;
      const skipWait = isFirstBoarding && step.lineId === preferredLineId;
      isFirstBoarding = false;
      if (!skipWait) {
        const timeOfDay = classifyTimeOfDay(addMinutesToIso(departureTime, elapsed));
        push({
          mode: "wait",
          from,
          to: from,
          minutes: computeWaitMinutes(step.lineType, timeOfDay),
          line,
          fromStationId: step.from,
          toStationId: step.from,
          lineId: step.lineId,
        });
      }
      push({
        mode: "ride",
        from,
        to: getStation(last.to).name,
        minutes: computeRideMinutes(distanceKm, step.lineType),
        line,
        fromStationId: step.from,
        toStationId: last.to,
        lineId: step.lineId,
      });
    }
    return legs;
  };

  const buildRailOption = (
    legs: RouteLeg[],
    input: FindAlternativeRoutesInput,
  ): Omit<RouteOption, "id"> => {
    const rides = legs.filter((l) => l.mode === "ride");
    const blockedLineId = input.blockedSection?.lineId;
    const isTransferService =
      input.transferServiceActive &&
      blockedLineId !== undefined &&
      rides.some((l) => l.lineId !== blockedLineId);
    const main = findMainRideLeg(legs, blockedLineId);
    const kind = main === undefined ? "walk" : "transfer";
    return {
      kind,
      label: formatRouteLabel({ kind, isTransferService, line: main?.line ?? null }),
      legs,
      arrivalTime: computeArrival(input.departureTime, legs),
      fareYen: null,
      walkMinutes: sumWalkMinutes(legs),
      isTransferService,
    };
  };

  // 全区間徒歩の候補。近距離のときだけ返す
  const buildWalkOnlyOption = (
    input: FindAlternativeRoutesInput,
  ): Omit<RouteOption, "id"> | null => {
    const origin = getStation(input.originStationId);
    const destination = getStation(input.destinationStationId);
    const minutes = estimateWalkMinutes(origin.lonLat, destination.lonLat);
    const limit = input.constraints?.reduceWalking
      ? WALK_ONLY_MAX_MINUTES_REDUCED
      : WALK_ONLY_MAX_MINUTES;
    if (minutes > limit) return null;
    const legs: RouteLeg[] = [
      {
        mode: "walk",
        from: origin.name,
        to: destination.name,
        minutes,
        fromStationId: origin.stationId,
        toStationId: destination.stationId,
      },
    ];
    return {
      kind: "walk",
      label: formatRouteLabel({ kind: "walk", isTransferService: false, line: null }),
      legs,
      arrivalTime: computeArrival(input.departureTime, legs),
      fareYen: null,
      walkMinutes: minutes,
      isTransferService: false,
    };
  };

  const computeWaitRouteMinutes = (input: WaitRouteInput): WaitRoute | null => {
    if (input.originStationId === input.destinationStationId) return { minutes: 0, legs: [] };
    getStation(input.originStationId);
    getStation(input.destinationStationId);
    const steps = searchShortestSteps(graph, {
      originStationId: input.originStationId,
      destinationStationId: input.destinationStationId,
      departureTime: input.departureTime,
      blockedEdges: new Set(),
      bannedLines: new Set(),
      walkCostFactor: 1,
      transferPenalty: 0,
      preferredLineId: input.lineId,
    });
    if (steps === null) return null;
    const legs = buildLegs(steps, input.departureTime, input.lineId);
    return { minutes: sumLegMinutes(legs), legs };
  };

  return {
    resolveStationId(name, lineHint) {
      const q = normalizeSearchText(name);
      const candidates = geo.findStationsByName(name, 200);
      const exact = candidates.filter((s) => normalizeSearchText(s.name) === q);
      const pool = exact.length > 0 ? exact : candidates;
      if (lineHint !== undefined && lineHint.trim().length > 0) {
        const hit =
          pool.find((s) => matchLineHint(s.lineId, lineHint, false)) ??
          pool.find((s) => matchLineHint(s.lineId, lineHint, true));
        if (hit) return hit.stationId;
      }
      return pool[0]?.stationId ?? null;
    },

    findAlternativeRoutes(input) {
      getStation(input.originStationId);
      getStation(input.destinationStationId);
      if (input.originStationId === input.destinationStationId) return [];
      const blockedEdges = collectBlockedEdges(input.blockedSection);
      const constraints = input.constraints ?? {};
      const bannedLines = new Set<string>();
      const candidates: Omit<RouteOption, "id">[] = [];

      // 前の候補の主な路線を除いて探し直し、異なる経路を集める
      for (let i = 0; i < MAX_ROUTE_CANDIDATES; i++) {
        const steps = searchShortestSteps(graph, {
          originStationId: input.originStationId,
          destinationStationId: input.destinationStationId,
          departureTime: input.departureTime,
          blockedEdges,
          bannedLines,
          walkCostFactor: constraints.reduceWalking ? REDUCED_WALK_COST_FACTOR : 1,
          transferPenalty: constraints.reduceTransfers ? REDUCED_TRANSFER_PENALTY_MINUTES : 0,
        });
        if (steps === null) break;
        const option = buildRailOption(buildLegs(steps, input.departureTime), input);
        candidates.push(option);
        const main = findMainRideLeg(option.legs, input.blockedSection?.lineId);
        if (main?.lineId === undefined) break;
        bannedLines.add(main.lineId);
      }
      const walkOnly = buildWalkOnlyOption(input);
      if (walkOnly !== null) candidates.push(walkOnly);

      const totalOf = (o: Omit<RouteOption, "id">) => sumLegMinutes(o.legs);
      const best = Math.min(...candidates.map(totalOf));
      const seen = new Set<string>();
      return (
        candidates
          // 全区間徒歩は近距離に限って作るので、遠回りの判定から外す
          .filter((o) => o === walkOnly || totalOf(o) <= best * MAX_ROUTE_RATIO_TO_BEST)
          .sort((a, b) => totalOf(a) - totalOf(b))
          .filter((o) => {
            const signature = buildLegSignature(o.legs);
            if (seen.has(signature)) return false;
            seen.add(signature);
            return true;
          })
          .slice(0, MAX_ROUTE_CANDIDATES)
          .map((o, index) => ({ id: `${o.kind}_${index + 1}`, ...o }))
      );
    },

    buildTaxiOption(input) {
      const origin = getStation(input.originStationId);
      const destination = getStation(input.destinationStationId);
      const straightKm = computeHaversineMeters(origin.lonLat, destination.lonLat) / 1000;
      const roadKm = estimateTaxiRoadKm(straightKm);
      const legs: RouteLeg[] = [
        {
          mode: "taxi",
          from: origin.name,
          to: destination.name,
          minutes: computeTaxiMinutes(roadKm),
          fromStationId: origin.stationId,
          toStationId: destination.stationId,
        },
      ];
      return {
        id: "taxi",
        kind: "taxi",
        label: formatRouteLabel({ kind: "taxi", isTransferService: false, line: null }),
        legs,
        arrivalTime: computeArrival(input.departureTime, legs),
        fareYen: computeTaxiFare(roadKm, input.departureTime).fareYen,
        walkMinutes: 0,
        isTransferService: false,
      };
    },

    buildWaitOption(input) {
      const route = computeWaitRouteMinutes({ ...input, departureTime: input.now });
      if (route === null) return null;
      const origin = getStation(input.originStationId);
      const line = getLineName(input.lineId);
      const waitMinutes = Math.max(
        0,
        Math.round(diffMinutes(input.now, input.arrivalTime)) - route.minutes,
      );
      const legs: RouteLeg[] = [
        {
          mode: "wait",
          from: origin.name,
          to: origin.name,
          minutes: waitMinutes,
          line,
          fromStationId: origin.stationId,
          toStationId: origin.stationId,
          lineId: input.lineId,
        },
        ...route.legs,
      ];
      return {
        id: "wait",
        kind: "wait",
        label: formatRouteLabel({ kind: "wait", isTransferService: false, line }),
        legs,
        arrivalTime: input.arrivalTime,
        fareYen: null,
        walkMinutes: sumWalkMinutes(route.legs),
        isTransferService: false,
      };
    },

    computeWaitRouteMinutes,
  };
}
