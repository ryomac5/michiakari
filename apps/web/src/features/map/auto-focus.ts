import { estimateWalkMinutes } from "@repo/core";
import { computeDistanceMeters, type StationNode } from "@repo/geo";
import type { Place } from "@repo/schema";
import type { BubblePlacement, FocusArea, FocusStation } from "./focus-areas";
import { type MapGeo, type Position, resolveStationByName } from "./scene";

// 手で整えた範囲が無い駅で、乗り換え候補の駅を駅データと路線データから選ぶ。表示用の純関数だけを置く
// 徒歩の分数は core の概算を使い、新しい判断の数値は作らない

// 候補にする徒歩の上限（分）
export const AUTO_WALK_MINUTES = 15;
// 選択肢が最初に乗る駅は、この分数までなら徒歩圏の外でも候補に入れる
const BOARDING_WALK_MINUTES = 25;
// 徒歩圏に別の駅が無いときは、この分数まで広げて探す
const FALLBACK_WALK_MINUTES = 25;
// 同じ駅の路線違いをまとめる距離
const SAME_STATION_METERS = 300;
export const MAX_AUTO_STATIONS = 4;

export type AutoCandidate = {
  stationIds: string[];
  name: { ja: string; en: string };
  operator: { ja: string; en: string };
  position: Position;
  walkMinutes: number;
  lineIds: string[];
  // 行き先の方面へ近づける度合い（0〜1）
  progress: number;
  score: number;
};

export type AutoCandidateInput = {
  origin: StationNode;
  // 止まっている路線。この路線の駅は候補にしない
  blockedLineIds: readonly string[];
  destination: Position | null;
  // 選択肢が最初に乗る駅。徒歩圏の外でも先に出す
  boardingIds?: ReadonlySet<string>;
  max?: number;
};

const toPosition = (p: readonly [number, number]): Position => [p[0], p[1]];

// 同じ駅とみなす組。名前と事業者が同じで近い駅（心斎橋の御堂筋線と長堀鶴見緑地線など）
// 事業者が違う同名の駅（JR と阪急の宝塚など）は、歩いて乗り換える別の駅として扱う
function isSameStation(a: StationNode, b: StationNode): boolean {
  return (
    a.name === b.name &&
    a.operator === b.operator &&
    computeDistanceMeters(a.lonLat, b.lonLat) <= SAME_STATION_METERS
  );
}

// 現在地の駅と、同じ駅の路線違い
export function listOriginGroup(geo: MapGeo, origin: StationNode): StationNode[] {
  return geo.nodes.filter((n) => isSameStation(n, origin));
}

// 吹き出しの単位。同じ名前で近い駅は、事業者が違っても 1 つにまとめる（阪神と近鉄の大阪難波など）
function groupStations(nodes: readonly StationNode[]): StationNode[][] {
  const groups: StationNode[][] = [];
  for (const node of nodes) {
    const group = groups.find(
      (g) =>
        g[0] !== undefined &&
        g[0].name === node.name &&
        computeDistanceMeters(g[0].lonLat, node.lonLat) <= SAME_STATION_METERS,
    );
    if (group) group.push(node);
    else groups.push([node]);
  }
  return groups;
}

// 路線に乗って行き先へどれだけ近づけるか。路線の駅のうち行き先に最も近い駅までの縮み方で測る
function measureProgress(
  geo: MapGeo,
  lineId: string,
  from: Position,
  destination: Position | null,
): number {
  if (!destination) return 0;
  const start = computeDistanceMeters(from, destination);
  if (start < 1) return 0;
  const nearest = geo.index
    .listStationsOnLine(lineId)
    .reduce(
      (best, s) => Math.min(best, computeDistanceMeters(s.lonLat, destination)),
      Number.POSITIVE_INFINITY,
    );
  return Math.max(0, Math.min(1, (start - nearest) / start));
}

function describeOperators(geo: MapGeo, nodes: readonly StationNode[]): { ja: string; en: string } {
  const lines = [...new Set(nodes.map((n) => n.lineId))].flatMap(
    (id) => geo.index.getLine(id) ?? [],
  );
  const ja = [...new Set(lines.map((l) => l.operator))];
  const en = [...new Set(lines.map((l) => l.operatorEn ?? l.operator))];
  return { ja: ja.join("・"), en: en.join(" / ") };
}

// 乗り換え候補の駅を選ぶ。止まっている路線の駅を除き、徒歩およそ 15 分以内の別の路線の駅から
// 行き先の方面へ向かえる路線、乗降客数の多い駅、近い駅の順に重みを付け、多くても 4 駅にする
export function selectAutoCandidates(geo: MapGeo, input: AutoCandidateInput): AutoCandidate[] {
  const max = input.max ?? MAX_AUTO_STATIONS;
  const originIds = new Set(listOriginGroup(geo, input.origin).map((n) => n.stationId));
  const boarding = input.boardingIds ?? new Set<string>();
  const here = toPosition(input.origin.lonLat);
  const walkOf = (n: StationNode) => estimateWalkMinutes(here, toPosition(n.lonLat));
  const reachable = geo.nodes.filter(
    (n) => !originIds.has(n.stationId) && !input.blockedLineIds.includes(n.lineId),
  );
  const near = reachable.filter((n) => {
    const walk = walkOf(n);
    return (
      walk <= AUTO_WALK_MINUTES || (boarding.has(n.stationId) && walk <= BOARDING_WALK_MINUTES)
    );
  });
  const pool = near.length > 0 ? near : reachable.filter((n) => walkOf(n) <= FALLBACK_WALK_MINUTES);

  const candidates = groupStations(pool).map((nodes): AutoCandidate => {
    const first = nodes[0] as StationNode;
    const position = toPosition(first.lonLat);
    const lineIds = [...new Set(nodes.map((n) => n.lineId))];
    const walkMinutes = Math.min(...nodes.map(walkOf));
    const progress = Math.max(
      ...lineIds.map((id) => measureProgress(geo, id, position, input.destination)),
    );
    const passengers = Math.max(0, ...nodes.map((n) => n.passengers ?? 0));
    const used = nodes.some((n) => boarding.has(n.stationId));
    const score =
      (used ? 10 : 0) +
      2 * progress +
      0.15 * Math.log10(1 + passengers) -
      (0.8 * walkMinutes) / AUTO_WALK_MINUTES;
    return {
      stationIds: nodes.map((n) => n.stationId),
      name: { ja: first.name, en: nodes.find((n) => n.nameEn)?.nameEn ?? first.name },
      operator: describeOperators(geo, nodes),
      position,
      walkMinutes,
      lineIds,
      progress,
      score,
    };
  });

  // 同じ路線ばかりにならないよう、既に選んだ駅で乗れる路線だけの駅は後ろへ回す
  const picked: AutoCandidate[] = [];
  const rest = [...candidates];
  while (picked.length < max && rest.length > 0) {
    const covered = new Set(picked.flatMap((c) => c.lineIds));
    const adjusted = (c: AutoCandidate) =>
      c.score - (c.lineIds.every((id) => covered.has(id)) ? 1 : 0);
    rest.sort((a, b) => adjusted(b) - adjusted(a));
    picked.push(rest.shift() as AutoCandidate);
  }
  return picked;
}

// 吹き出しの既定の置き場所。現在地から離れる向きに置く。重なりは画面の上で選び直す
export function selectAwayPlacement(here: Position, station: Position): BubblePlacement {
  const scale = Math.cos((here[1] * Math.PI) / 180);
  const dx = (station[0] - here[0]) * scale;
  const dy = station[1] - here[1];
  if (Math.abs(dx) >= Math.abs(dy)) return dx >= 0 ? "right" : "left";
  return dy >= 0 ? "top" : "bottom";
}

export type AutoFocusInput = {
  origin: Place;
  blockedLineIds: readonly string[];
  destination: Position | null;
  boardingIds?: ReadonlySet<string>;
};

// 手で整えた範囲と同じ形にして、吹き出しの組み立てをそのまま使う
export function buildAutoFocusArea(geo: MapGeo, input: AutoFocusInput): FocusArea | null {
  if (input.origin.kind !== "station") return null;
  const name = input.origin.name.replace(/駅$/, "");
  const origin = resolveStationByName(geo.index, name, input.blockedLineIds);
  if (!origin) return null;
  const candidates = selectAutoCandidates(geo, {
    origin,
    blockedLineIds: input.blockedLineIds,
    destination: input.destination,
    boardingIds: input.boardingIds,
  });
  if (candidates.length === 0) return null;
  const here = toPosition(origin.lonLat);
  // 同じ名前の駅が並ぶとき（なんばと難波など）は、小さな札で見分けられるようにする
  // 事業者が違えば事業者を、同じ事業者の別の駅（四つ橋線の本町など）なら路線を添える
  const originOperator = geo.index.getLine(origin.lineId)?.operatorKey;
  const duplicated = (c: AutoCandidate) =>
    c.name.ja === origin.name || candidates.some((o) => o !== c && o.name.ja === c.name.ja);
  const describePrefix = (c: AutoCandidate): { ja: string; en: string } => {
    const line = c.lineIds[0] ? geo.index.getLine(c.lineIds[0]) : undefined;
    if (line && line.operatorKey === originOperator) {
      return { ja: line.lineName, en: line.nameEn ?? line.lineName };
    }
    return c.operator;
  };
  const stations = candidates.map((c, i): FocusStation => {
    const away = selectAwayPlacement(here, c.position);
    const prefix = duplicated(c) ? describePrefix(c) : null;
    return {
      key: `auto-${i + 1}`,
      stationIds: c.stationIds,
      name: c.name,
      ...(prefix
        ? { shortName: { ja: `${prefix.ja} ${c.name.ja}`, en: `${prefix.en} ${c.name.en}` } }
        : {}),
      operator: c.operator,
      placement: { wide: away, narrow: away },
      priority: i + 1,
    };
  });
  return {
    id: `auto:${origin.name}`,
    auto: true,
    originNames: [origin.name],
    hereName: { ja: origin.name, en: origin.nameEn ?? origin.name },
    herePlacement: { wide: "left", narrow: "top" },
    stations,
  };
}
