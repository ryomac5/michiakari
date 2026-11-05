import { estimateWalkMinutes } from "@repo/core";
import {
  computeDistanceMeters,
  findMainRideLeg,
  formatLineName,
  formatStationName,
  listWalkAccessStations,
  type StationNode,
  type WalkAccessSource,
} from "@repo/geo";
import type { Lang, Place, RouteOption } from "@repo/schema";
import {
  type FocusArea,
  type FocusStation,
  focusAreas,
  MAX_FOCUS_STATIONS,
  type Placements,
} from "./focus-areas";
import {
  type Bounds,
  computeFitBounds,
  type FeatureCollection,
  type MapGeo,
  type Position,
  resolveStationByName,
  translateLineName,
} from "./scene";

// 現在地のまわりの乗り換え候補の駅を、地図の吹き出し用に組み立てる。表示用の純関数だけを置く
// 徒歩の分数は、選択肢の徒歩区間、路線データの乗換の徒歩、core の概算の順に使う。新しい数値は作らない

export type GuideLine = {
  lineId: string;
  name: string;
  color: string;
  suspended: boolean;
  // 振替輸送で乗る路線。振替の選択肢の主な乗車区間（選択肢の名前の路線）から求める
  transferService: boolean;
};

// 推奨の選択肢の乗り方。最初に乗る路線と、結論が名前に出す路線が違えば乗り継ぎを 1 段添える
export type GuideRoute = {
  first: GuideLine;
  // 例: 西中島南方で阪急京都線
  via: { stationName: string; line: GuideLine } | null;
};

export type WalkSource = "option" | "transfer" | "estimate";

export type GuideStation = {
  key: string;
  name: string;
  // 小さな札に出す名前
  shortName: string;
  operator: string;
  position: Position;
  placement: Placements;
  lines: GuideLine[];
  // 乗れる路線がすべて止まっている
  suspended: boolean;
  walkMinutes: number;
  walkSource: WalkSource;
  // 振替輸送で乗る路線のどれかが、この駅から出る
  transferService: boolean;
  // 推奨の選択肢の乗り方。おすすめの駅だけが持つ
  route: GuideRoute | null;
  // 地図に描く選択肢が最初に乗る駅。一覧で選ばなければ推奨の選択肢
  recommended: boolean;
  // 推奨の選択肢が最初に乗る駅。おすすめの星を付ける
  starred: boolean;
  // 吹き出しを押したときに移る選択肢。推奨を優先する
  optionId: string | null;
};

export type StationGuide = {
  areaId: string;
  here: {
    position: Position;
    name: string;
    lines: GuideLine[];
    // 推奨の選択肢が現在地の駅で乗る路線
    recommendedLineId: string | null;
  };
  // 駅間の車内の人が降りる駅。現在地の印は駅間の線路の上に置き、この駅を別の印で目立たせる
  alight: { position: Position; name: string } | null;
  stations: GuideStation[];
  // 現在地から各駅への徒歩の道。直線の点線で示す
  walkPaths: FeatureCollection<
    { type: "LineString"; coordinates: Position[] },
    { key: string; recommended: boolean }
  >;
  // 徒歩の道の中ほどに置く「徒歩 6 分」の札
  walkLabels: FeatureCollection<
    { type: "Point"; coordinates: Position },
    { key: string; label: string; recommended: boolean }
  >;
  // 吹き出しや現在地に出す路線。地図の上で路線色に塗る
  relevantLineIds: string[];
  // 選択肢ごとの最初に乗る駅。シートの選択肢の行に、吹き出しと同じ色と名前で添える
  optionMarks: OptionMark[];
  bounds: Bounds | null;
};

export type OptionMark = {
  optionId: string;
  // 吹き出しの識別子。現在地の駅で乗るときは "here"
  key: string;
  stationName: string;
  color: string;
};

export type StationGuideInput = {
  origin: Place;
  options: readonly RouteOption[];
  // 地図に描く選択肢。一覧で選ばなければ推奨の選択肢
  recommendedOptionId: string | null;
  // おすすめの星を付ける選択肢。省略時は recommendedOptionId
  starOptionId?: string | null;
  // 駅間の車内。現在地の印を来た側の駅と次の駅のあいだの線路の上に置く。label は「大阪〜塚本の間」
  between?: { previousStation: string; nextStation: string; label: string } | null;
  // 止まっている区間の折れ線。駅間の現在地を線路の上に置くのに使う
  blockedPath?: readonly Position[] | null;
  // 止まっている路線。地図の止まっている区間から求めたもの
  blockedLineIds: readonly string[];
  // 止まっている路線の呼び方（観測の line）。現在地の札に使う
  blockedLineName: string | null;
  language: Lang;
  formatWalk: (minutes: number) => string;
};

// 同じ駅の路線違いをまとめる距離
const SAME_STATION_METERS = 300;

const toPosition = (p: readonly [number, number]): Position => [p[0], p[1]];

// 現在地が手で整えた範囲に入っていれば、その範囲を返す
export function findFocusArea(origin: Place): FocusArea | null {
  if (origin.kind !== "station") return null;
  const name = origin.name.replace(/駅$/, "");
  return focusAreas.find((area) => area.originNames.includes(name)) ?? null;
}

function listGroupNodes(geo: MapGeo, origin: StationNode): StationNode[] {
  return geo.nodes.filter(
    (n) =>
      n.name === origin.name &&
      computeDistanceMeters(n.lonLat, origin.lonLat) <= SAME_STATION_METERS,
  );
}

function buildGuideLine(
  geo: MapGeo,
  lineId: string,
  input: StationGuideInput,
  transferLineIds: ReadonlySet<string> = new Set(),
): GuideLine | null {
  const line = geo.index.getLine(lineId);
  if (!line) return null;
  const suspended = input.blockedLineIds.includes(lineId);
  // 止まっている路線は、観測の呼び方（JR京都線など）を優先する。英語では英語名のあるものだけ
  const observed =
    suspended && input.blockedLineName
      ? input.language === "en"
        ? translateLineName(geo.index, input.blockedLineName)
        : input.blockedLineName
      : null;
  return {
    lineId,
    name: observed ?? formatLineName(line, input.language),
    color: line.color,
    suspended,
    transferService: !suspended && transferLineIds.has(lineId),
  };
}

function uniqueLines(lines: (GuideLine | null)[]): GuideLine[] {
  const seen = new Set<string>();
  return lines.filter((l): l is GuideLine => {
    if (l === null || seen.has(l.lineId)) return false;
    seen.add(l.lineId);
    return true;
  });
}

// 選択肢が最初に乗る区間。待ち・乗車・タクシーのうち最初のもの
function findBoardingLeg(option: RouteOption) {
  return option.legs.find((leg) => leg.mode !== "walk") as
    | (RouteOption["legs"][number] & { fromStationId?: string | null; lineId?: string | null })
    | undefined;
}

// 選択肢が最初に乗る駅の ID。自動で選ぶ候補に先に入れる
export function listBoardingStationIds(options: readonly RouteOption[]): Set<string> {
  return new Set(
    options.flatMap((o) => {
      if (o.kind === "wait" || o.kind === "taxi") return [];
      const id = findBoardingLeg(o)?.fromStationId;
      return id ? [id] : [];
    }),
  );
}

// 選択肢の最初の徒歩区間が、現在地からこの駅へ向かうなら、その分数
function findOptionWalkMinutes(
  options: readonly RouteOption[],
  originIds: ReadonlySet<string>,
  stationIds: readonly string[],
): number | null {
  for (const option of options) {
    const first = option.legs[0] as
      | (RouteOption["legs"][number] & {
          fromStationId?: string | null;
          toStationId?: string | null;
        })
      | undefined;
    if (
      first?.mode === "walk" &&
      first.fromStationId &&
      originIds.has(first.fromStationId) &&
      first.toStationId &&
      stationIds.includes(first.toStationId)
    ) {
      return first.minutes;
    }
  }
  return null;
}

// 選択肢の徒歩が無い駅の徒歩の分。代替手段の探索と同じ関数で、乗換の徒歩（路線データ）か概算を求める
// 同じ駅の路線違いは、近いほうを使う
function findAccessWalkMinutes(
  geo: MapGeo,
  originNode: StationNode,
  stationIds: readonly string[],
): { minutes: number; source: WalkAccessSource } | null {
  const nodes = stationIds.flatMap((id) => geo.index.getStation(id) ?? []);
  const nearest = listWalkAccessStations({
    nodes,
    graph: geo.graph,
    origin: originNode,
    blockedLineIds: [],
    maxWalkMinutes: Number.POSITIVE_INFINITY,
  })[0];
  return nearest ? { minutes: nearest.walkMinutes, source: nearest.source } : null;
}

export function resolveWalkMinutes(
  geo: MapGeo,
  originNode: StationNode,
  originIds: ReadonlySet<string>,
  station: FocusStation,
  position: Position,
  options: readonly RouteOption[],
): { minutes: number; source: WalkSource } {
  const fromOption = findOptionWalkMinutes(options, originIds, station.stationIds);
  if (fromOption !== null) return { minutes: fromOption, source: "option" };
  const access = findAccessWalkMinutes(geo, originNode, station.stationIds);
  if (access !== null) return access;
  return { minutes: estimateWalkMinutes(originNode.lonLat, position), source: "estimate" };
}

type LegWithIds = RouteOption["legs"][number] & {
  fromStationId?: string | null;
  toStationId?: string | null;
  lineId?: string | null;
};

// 振替輸送で乗る路線。振替の選択肢の主な乗車区間で、選択肢の名前（阪急京都線で振替）の路線
// 乗り継ぎに使うだけの路線（御堂筋線など）は含めない
export function listTransferLineIds(input: StationGuideInput): Set<string> {
  const blocked = input.blockedLineIds[0];
  return new Set(
    input.options
      .filter((o) => o.isTransferService)
      .flatMap((o) => {
        const main = findMainRideLeg(o.legs, blocked) as LegWithIds | undefined;
        return main?.lineId ? [main.lineId] : [];
      }),
  );
}

// 推奨の選択肢の乗り方。最初の乗車区間と、主な乗車区間が違えば乗り継ぎの駅と路線を添える
function buildGuideRoute(
  geo: MapGeo,
  option: RouteOption,
  input: StationGuideInput,
  transferLineIds: ReadonlySet<string>,
): GuideRoute | null {
  const rides = option.legs.filter((l) => l.mode === "ride") as LegWithIds[];
  const firstLeg = rides[0];
  const first = firstLeg?.lineId
    ? buildGuideLine(geo, firstLeg.lineId, input, transferLineIds)
    : null;
  if (!first) return null;
  const main = findMainRideLeg(option.legs, input.blockedLineIds[0]) as LegWithIds | undefined;
  if (!main?.lineId || main === firstLeg || main.lineId === firstLeg?.lineId) {
    return { first, via: null };
  }
  const line = buildGuideLine(geo, main.lineId, input, transferLineIds);
  const station = main.fromStationId ? geo.index.getStation(main.fromStationId) : undefined;
  if (!line) return { first, via: null };
  return {
    first,
    via: {
      stationName: station ? formatStationName(station, input.language) : main.from,
      line,
    },
  };
}

// 路線の並び。推奨の選択肢が乗る路線、ほかの選択肢が乗る路線、そのほかの順
function sortLines(lines: GuideLine[], preferred: readonly string[]): GuideLine[] {
  const rank = (l: GuideLine) => {
    const i = preferred.indexOf(l.lineId);
    return i === -1 ? preferred.length : i;
  };
  return [...lines].sort((a, b) => rank(a) - rank(b));
}

// 吹き出しに出す駅を選ぶ。選択肢が最初に乗る駅を先に、残りは設定の優先度の順
function selectStations(
  area: FocusArea,
  boardingIds: ReadonlySet<string>,
  max = MAX_FOCUS_STATIONS,
): FocusStation[] {
  const used = (s: FocusStation) => s.stationIds.some((id) => boardingIds.has(id));
  return [...area.stations]
    .sort((a, b) => Number(used(b)) - Number(used(a)) || a.priority - b.priority)
    .slice(0, max);
}

export function buildStationGuide(
  geo: MapGeo,
  area: FocusArea,
  input: StationGuideInput,
): StationGuide | null {
  const originName = area.originNames[0] as string;
  const originNode = resolveStationByName(geo.index, originName, input.blockedLineIds);
  if (!originNode) return null;
  const groupNodes = listGroupNodes(geo, originNode);
  const originIds = new Set(groupNodes.map((n) => n.stationId));
  const lang = input.language;

  const recommended = input.options.find((o) => o.id === input.recommendedOptionId);
  const recommendedBoarding = recommended ? findBoardingLeg(recommended) : undefined;
  const starId = input.starOptionId === undefined ? input.recommendedOptionId : input.starOptionId;
  const star = input.options.find((o) => o.id === starId);
  const starBoarding = star ? findBoardingLeg(star) : undefined;
  const boardings = input.options.flatMap((o) => {
    const leg = findBoardingLeg(o);
    return leg?.fromStationId ? [{ option: o, leg, stationId: leg.fromStationId }] : [];
  });
  const boardingIds = new Set(boardings.map((b) => b.stationId));
  const transferLineIds = listTransferLineIds(input);

  const stations = selectStations(area, boardingIds).flatMap((station): GuideStation[] => {
    const nodes = station.stationIds.flatMap((id) => geo.index.getStation(id) ?? []);
    const first = nodes[0];
    if (!first) return [];
    const position = toPosition(first.lonLat);
    const boardingHere = boardings
      .filter((b) => station.stationIds.includes(b.stationId))
      // 推奨の選択肢を先に置き、路線の並びと押したときに移る先に使う
      .sort(
        (a, b) => Number(b.option.id === recommended?.id) - Number(a.option.id === recommended?.id),
      );
    const lines = sortLines(
      uniqueLines([
        ...nodes.map((n) => buildGuideLine(geo, n.lineId, input, transferLineIds)),
        ...boardingHere.map((b) =>
          b.leg.lineId ? buildGuideLine(geo, b.leg.lineId, input, transferLineIds) : null,
        ),
      ]),
      boardingHere.flatMap((b) => (b.leg.lineId ? [b.leg.lineId] : [])),
    );
    const walk = resolveWalkMinutes(geo, originNode, originIds, station, position, input.options);
    const isRecommended =
      recommendedBoarding?.fromStationId !== undefined &&
      recommendedBoarding.fromStationId !== null &&
      station.stationIds.includes(recommendedBoarding.fromStationId);
    return [
      {
        key: station.key,
        name: station.name[lang],
        shortName: (station.shortName ?? station.name)[lang],
        operator: station.operator[lang],
        position,
        placement: station.placement,
        lines,
        suspended: lines.length > 0 && lines.every((l) => l.suspended),
        walkMinutes: walk.minutes,
        walkSource: walk.source,
        transferService: lines.some((l) => l.transferService),
        recommended: isRecommended,
        starred:
          starBoarding?.fromStationId != null &&
          station.stationIds.includes(starBoarding.fromStationId),
        route:
          isRecommended && recommended
            ? buildGuideRoute(geo, recommended, input, transferLineIds)
            : null,
        optionId: isRecommended ? (recommended?.id ?? null) : (boardingHere[0]?.option.id ?? null),
      },
    ];
  });

  // 出発の駅の位置。徒歩の道と到達範囲はこの駅から引く
  const originPosition = toPosition(originNode.lonLat);
  // 現在地の印。駅間の車内なら、来た側の駅と次の駅のあいだの線路の上に置く
  const previousNode = input.between
    ? resolveStationByName(geo.index, input.between.previousStation, input.blockedLineIds)
    : undefined;
  const herePosition = previousNode
    ? findMidpointAlongPath(
        input.blockedPath ?? [],
        toPosition(previousNode.lonLat),
        originPosition,
      )
    : originPosition;
  const hereLines = uniqueLines(
    groupNodes.map((n) => buildGuideLine(geo, n.lineId, input, transferLineIds)),
  )
    // 止まっている路線を先に出す
    .sort((a, b) => Number(b.suspended) - Number(a.suspended));
  const recommendedLineId =
    recommendedBoarding?.fromStationId && originIds.has(recommendedBoarding.fromStationId)
      ? (recommendedBoarding.lineId ?? null)
      : null;

  const optionMarks = boardings.flatMap(({ option, leg, stationId }): OptionMark[] => {
    if (option.kind === "wait" || option.kind === "taxi") return [];
    const color = (leg.lineId && geo.index.getLine(leg.lineId)?.color) || "#888888";
    if (originIds.has(stationId)) {
      return [{ optionId: option.id, key: "here", stationName: area.hereName[lang], color }];
    }
    const station = stations.find((s) =>
      area.stations.some((f) => f.key === s.key && f.stationIds.includes(stationId)),
    );
    return station
      ? [{ optionId: option.id, key: station.key, stationName: station.name, color }]
      : [];
  });

  return {
    areaId: area.id,
    optionMarks,
    here: {
      position: herePosition,
      name: previousNode && input.between ? input.between.label : area.hereName[lang],
      lines: hereLines,
      recommendedLineId: recommended?.kind === "wait" ? null : recommendedLineId,
    },
    alight: previousNode ? { position: originPosition, name: area.hereName[lang] } : null,
    stations,
    walkPaths: {
      type: "FeatureCollection",
      features: stations.map((s) => ({
        type: "Feature",
        geometry: { type: "LineString", coordinates: [originPosition, s.position] },
        properties: { key: s.key, recommended: s.recommended },
      })),
    },
    walkLabels: {
      type: "FeatureCollection",
      features: stations.map((s) => ({
        type: "Feature",
        geometry: {
          type: "Point",
          coordinates: [
            (originPosition[0] + s.position[0]) / 2,
            (originPosition[1] + s.position[1]) / 2,
          ],
        },
        properties: {
          key: s.key,
          label: input.formatWalk(s.walkMinutes),
          recommended: s.recommended,
        },
      })),
    },
    relevantLineIds: [
      ...new Set([...hereLines, ...stations.flatMap((s) => s.lines)].map((l) => l.lineId)),
    ],
    bounds: computeFitBounds(
      [herePosition, originPosition, ...stations.map((s) => s.position)],
      0.004,
    ),
  };
}

// 折れ線の上で、2 点にいちばん近い頂点のあいだの道のりの中ほどの点。駅間の現在地を線路の上に置くのに使う
// 折れ線が無いか、2 点が同じ頂点に寄るときは、2 点の直線の中点にする
export function findMidpointAlongPath(
  path: readonly Position[],
  a: Position,
  b: Position,
): Position {
  const straight: Position = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
  if (path.length < 2) return straight;
  const nearestIndex = (p: Position) => {
    let best = 0;
    let bestMeters = Number.POSITIVE_INFINITY;
    path.forEach((vertex, i) => {
      const meters = computeDistanceMeters(vertex, p);
      if (meters < bestMeters) {
        bestMeters = meters;
        best = i;
      }
    });
    return best;
  };
  const ia = nearestIndex(a);
  const ib = nearestIndex(b);
  if (ia === ib) return straight;
  const segment = path.slice(Math.min(ia, ib), Math.max(ia, ib) + 1);
  const cumulative = [0];
  for (let i = 1; i < segment.length; i++) {
    const prev = segment[i - 1] as Position;
    const next = segment[i] as Position;
    cumulative.push((cumulative[i - 1] ?? 0) + computeDistanceMeters(prev, next));
  }
  const total = cumulative.at(-1) ?? 0;
  if (total === 0) return straight;
  const half = total / 2;
  for (let i = 1; i < segment.length; i++) {
    const end = cumulative[i] ?? 0;
    if (end < half) continue;
    const start = cumulative[i - 1] ?? 0;
    const prev = segment[i - 1] as Position;
    const next = segment[i] as Position;
    const t = end === start ? 0 : (half - start) / (end - start);
    return [prev[0] + (next[0] - prev[0]) * t, prev[1] + (next[1] - prev[1]) * t];
  }
  return straight;
}

// 折れ線の上で、起点からの直線距離が meters を初めて超える点。止まっている区間の札を置くのに使う
// 届かなければ折れ線の終点を返す
export function findPointAtDistance(
  path: readonly Position[],
  from: Position,
  meters: number,
): Position | null {
  if (path.length === 0) return null;
  for (let i = 1; i < path.length; i++) {
    const a = path[i - 1] as Position;
    const b = path[i] as Position;
    if (computeDistanceMeters(b, from) < meters) continue;
    // 区間の中で距離が meters になるところを二分法で探す
    let lo = 0;
    let hi = 1;
    for (let step = 0; step < 24; step++) {
      const mid = (lo + hi) / 2;
      const p: Position = [a[0] + (b[0] - a[0]) * mid, a[1] + (b[1] - a[1]) * mid];
      if (computeDistanceMeters(p, from) < meters) lo = mid;
      else hi = mid;
    }
    return [a[0] + (b[0] - a[0]) * hi, a[1] + (b[1] - a[1]) * hi];
  }
  return path.at(-1) as Position;
}

// 到達範囲の外周で、方位 bearing（度、北が 0）の向きに最も張り出した頂点。範囲の札を置く
export function findRingLabelPoint(
  ring: readonly Position[],
  center: Position,
  bearing: number,
): Position | null {
  const rad = (bearing * Math.PI) / 180;
  const dir: Position = [Math.sin(rad), Math.cos(rad)];
  const scale = Math.cos((center[1] * Math.PI) / 180);
  let best: Position | null = null;
  let bestScore = Number.NEGATIVE_INFINITY;
  for (const p of ring) {
    const score = (p[0] - center[0]) * scale * dir[0] + (p[1] - center[1]) * dir[1];
    if (score > bestScore) {
      bestScore = score;
      best = p;
    }
  }
  return best;
}
