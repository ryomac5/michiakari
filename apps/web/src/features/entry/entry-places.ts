import {
  computeDistanceMeters,
  formatLineName,
  type GeoIndex,
  type LineInfo,
  type StationNode,
} from "@repo/geo";
import {
  buildStationCatalog,
  type StationCatalog,
  type StationChoice,
  type StationGroup,
} from "@/features/stations/catalog";
import {
  type EntryAreaConfig,
  type EntryPlaceConfig,
  entryAreas,
  type LabelSide,
  type Localized,
  type Sides,
} from "./areas";

// 入口の地図に出すエリア・駅・路線を、駅データと手で整えた設定から組み立てる

export type Position = [number, number];

// 駅で選べる路線。選ぶと出発の駅名と、止まっている路線の名前が決まる
export type EntryLine = {
  key: string;
  lineId: string;
  // 判断の要求に送る出発の駅名（日本語）
  stationName: string;
  stationNameEn: string | null;
  // 観測に入れる路線名。路線データの別名と照らせる日本語の名前にする
  observedName: string;
  name: Localized;
  operator: Localized;
  color: string;
};

export type EntryPlace = {
  key: string;
  name: { ja: string; en: string | null };
  position: Position;
  side: Sides;
  lines: EntryLine[];
};

export type EntryArea = {
  id: string;
  // 手で整えたエリアの名前。駅データから作ったエリアは null で、先頭の駅の名前を使う
  name: Localized | null;
  center: Position;
  places: EntryPlace[];
};

export type EntryHub = {
  areaId: string;
  stationName: string;
  label: Localized;
  position: Position;
  side: Sides;
  core: boolean;
};

export type EntryData = {
  index: GeoIndex;
  catalog: StationCatalog;
};

// 手で整えたエリアに寄せる範囲（m）。関西の段で触った点からこの距離の中にある丸を選ぶ
const hubSnapMeters = 3000;
// 駅データから作るエリアの半径と駅の数
const genericRadiusMeters = 1300;
const genericPlaceLimit = 6;
const stationChoiceRadiusMeters = 1000;
// 指の幅から出した距離の上限（m）。丸に寄せる範囲と同じにし、それより遠い駅は「その近く」と感じない
const maxTapReachMeters = hubSnapMeters;

// JR の東海道線は、走る場所で通称が変わる。大阪を境に西は JR神戸線、東は JR京都線
const tokaidoNicknames = {
  kobe: { ja: "JR神戸線", en: "JR Kobe Line" },
  kyoto: { ja: "JR京都線", en: "JR Kyoto Line" },
  biwako: { ja: "琵琶湖線", en: "JR Biwako Line" },
} as const;
const osakaLon = 135.495;
const kyotoLon = 135.76;

export function createEntryData(nodes: readonly StationNode[], index: GeoIndex): EntryData {
  return { index, catalog: buildStationCatalog([...nodes], index.listLines()) };
}

function selectTokaidoNicknames(lon: number): Localized[] {
  if (Math.abs(lon - osakaLon) < 0.004) return [tokaidoNicknames.kobe, tokaidoNicknames.kyoto];
  if (lon < osakaLon) return [tokaidoNicknames.kobe];
  if (Math.abs(lon - kyotoLon) < 0.004) return [tokaidoNicknames.kyoto, tokaidoNicknames.biwako];
  return lon < kyotoLon ? [tokaidoNicknames.kyoto] : [tokaidoNicknames.biwako];
}

function describeLineNames(line: LineInfo, lon: number): Localized[] {
  if (line.lineId === "jr-west.東海道線") return selectTokaidoNicknames(lon);
  return [{ ja: formatLineName(line, "ja"), en: formatLineName(line, "en") }];
}

// まとめた駅の路線を、路線色付きで選べる形に並べる
export function listGroupLines(data: EntryData, group: StationGroup): EntryLine[] {
  const seen = new Set<string>();
  const lines: EntryLine[] = [];
  for (const stationId of group.stationIds) {
    const node = data.index.getStation(stationId);
    const line = node ? data.index.getLine(node.lineId) : undefined;
    if (!node || !line) continue;
    for (const name of describeLineNames(line, node.lonLat[0])) {
      const key = `${group.choice.name}|${line.lineId}|${name.ja}`;
      if (seen.has(key)) continue;
      seen.add(key);
      lines.push({
        key,
        lineId: line.lineId,
        stationName: group.choice.name,
        stationNameEn: group.choice.nameEn,
        observedName: name.ja,
        name,
        operator: { ja: line.operator, en: line.operatorEn ?? line.operator },
        color: line.color,
      });
    }
  }
  return lines;
}

function findGroup(data: EntryData, stationName: string): StationGroup | undefined {
  return data.catalog.groupById.get(stationName);
}

function toPosition(choice: StationChoice): Position {
  return [choice.lon, choice.lat];
}

function buildPlace(
  data: EntryData,
  config: EntryPlaceConfig,
  center: Position,
): EntryPlace | null {
  const groups = config.stationNames.flatMap((name) =>
    data.catalog.groups
      .filter(
        (group) =>
          group.choice.name === name &&
          computeDistanceMeters(center, toPosition(group.choice)) <= hubSnapMeters,
      )
      .sort(
        (a, b) =>
          computeDistanceMeters(center, toPosition(a.choice)) -
          computeDistanceMeters(center, toPosition(b.choice)),
      )
      .slice(0, 1),
  );
  const [first] = groups;
  if (!first) return null;
  return {
    key: config.key,
    name: config.label ?? { ja: first.choice.name, en: first.choice.nameEn },
    position: toPosition(first.choice),
    side: config.side,
    lines: groups.flatMap((g) => listGroupLines(data, g)),
  };
}

function buildConfiguredArea(data: EntryData, config: EntryAreaConfig): EntryArea {
  const hub = findGroup(data, config.hub.stationName);
  const center: Position = hub ? toPosition(hub.choice) : [135.5, 34.7];
  const places = config.places.flatMap((p) => buildPlace(data, p, center) ?? []);
  return {
    id: config.id,
    name: config.name,
    center: hub ? toPosition(hub.choice) : (places[0]?.position ?? [135.5, 34.7]),
    places,
  };
}

export function listEntryHubs(data: EntryData): EntryHub[] {
  return entryAreas.flatMap((area) => {
    const group = findGroup(data, area.hub.stationName);
    return group
      ? [
          {
            areaId: area.id,
            stationName: area.hub.stationName,
            label: area.hub.label,
            position: toPosition(group.choice),
            side: area.hub.side,
            core: area.hub.core,
          },
        ]
      : [];
  });
}

export function resolveConfiguredArea(data: EntryData, areaId: string): EntryArea | null {
  const config = entryAreas.find((a) => a.id === areaId);
  return config ? buildConfiguredArea(data, config) : null;
}

// 札は中心より西の駅なら左、東の駅なら右に出し、丸どうしで札が重なりにくくする
function selectAutoSide(position: Position, center: Position): Sides {
  const side: LabelSide = position[0] < center[0] ? "left" : "right";
  return { wide: side, narrow: side };
}

// 触った点のまわりの駅を、乗降客数の多い順に集めてエリアにする
export function buildNearbyArea(data: EntryData, center: Position): EntryArea | null {
  const groups = data.catalog.groups
    .map((group) => ({
      group,
      meters: computeDistanceMeters(center, toPosition(group.choice)),
    }))
    .filter((g) => g.meters <= genericRadiusMeters)
    .sort((a, b) => b.group.passengers - a.group.passengers)
    .slice(0, genericPlaceLimit);
  const [first] = groups;
  if (!first) return null;
  return {
    id: `near-${first.group.choice.id}`,
    name: null,
    center,
    places: groups.map(({ group }) => ({
      key: group.choice.id,
      name: { ja: group.choice.name, en: group.choice.nameEn },
      position: toPosition(group.choice),
      side: selectAutoSide(toPosition(group.choice), center),
      lines: listGroupLines(data, group),
    })),
  };
}

// 関西の段で触った点から寄せるエリア。近くに手で整えたエリアがあればそれを、無ければ駅データから作る
// reachMeters は指の幅を地図の距離にしたもの。点の近くに駅が無ければ、その中で一番近い駅のまわりで作る
export function findAreaAt(data: EntryData, point: Position, reachMeters = 0): EntryArea | null {
  const hub = listEntryHubs(data)
    .map((h) => ({ hub: h, meters: computeDistanceMeters(point, h.position) }))
    .filter((h) => h.meters <= hubSnapMeters)
    .sort((a, b) => a.meters - b.meters)[0];
  if (hub) return resolveConfiguredArea(data, hub.hub.areaId);
  const area = buildNearbyArea(data, point);
  if (area || reachMeters <= genericRadiusMeters) return area;
  const nearest = findNearestGroupPosition(data, point, Math.min(reachMeters, maxTapReachMeters));
  return nearest ? buildNearbyArea(data, nearest) : null;
}

function findNearestGroupPosition(
  data: EntryData,
  point: Position,
  maxMeters: number,
): Position | null {
  const nearest = data.catalog.groups
    .map((group) => ({
      position: toPosition(group.choice),
      meters: computeDistanceMeters(point, toPosition(group.choice)),
    }))
    .filter((g) => g.meters <= maxMeters)
    .sort((a, b) => a.meters - b.meters)[0];
  return nearest?.position ?? null;
}

// 検索や現在地で選んだ駅を、その駅を含むエリアの中の 1 つとして開く
export function openStationChoice(
  data: EntryData,
  choice: StationChoice,
): { area: EntryArea; place: EntryPlace } | null {
  const point = toPosition(choice);
  for (const config of entryAreas) {
    const area = buildConfiguredArea(data, config);
    const place = area.places.find(
      (p) =>
        p.lines.some((line) => line.stationName === choice.name) &&
        computeDistanceMeters(p.position, point) <= stationChoiceRadiusMeters,
    );
    if (place) return { area, place };
  }
  const group = data.catalog.groupById.get(choice.id);
  const area = buildNearbyArea(data, point);
  if (!group || !area) return null;
  const place = area.places.find((p) => p.key === choice.id) ?? {
    key: choice.id,
    name: { ja: choice.name, en: choice.nameEn },
    position: point,
    side: { wide: "right", narrow: "right" },
    lines: listGroupLines(data, group),
  };
  const places = area.places.some((p) => p.key === place.key)
    ? area.places
    : [place, ...area.places.slice(0, genericPlaceLimit - 1)];
  return { area: { ...area, places }, place };
}

export function findStationChoice(data: EntryData, stationName: string): StationChoice | null {
  return data.catalog.groupById.get(stationName)?.choice ?? null;
}

export function pickLocalized(text: Localized, locale: string): string {
  return locale === "en" ? text.en : text.ja;
}

export function pickPlaceName(place: EntryPlace, locale: string): string {
  return locale === "en" && place.name.en ? place.name.en : place.name.ja;
}
