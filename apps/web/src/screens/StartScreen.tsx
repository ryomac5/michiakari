"use client";

import type { RawInput } from "@repo/schema";
import { useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from "react";
import { AppHeader } from "@/components/AppHeader";
import { sheetTopInset } from "@/components/MapSheet";
import {
  type DirectionStop,
  type EntryDirection,
  listDirectionCandidates,
  listEntryDirections,
  listNearbyStops,
  pickSpreadStops,
} from "@/features/entry/directions";
import { EntryMap, type EntryMapApi, type MapStop } from "@/features/entry/EntryMap";
import { DemoDock, PromptCard } from "@/features/entry/EntryOverlays";
import { EntrySheet } from "@/features/entry/EntrySheet";
import {
  type AnsweredItem,
  AreaStep,
  CauseStep,
  computeDirectionAngle,
  DestinationStep,
  DirectionStep,
  ElapsedStep,
  EntryProgress,
  InputStep,
  PositionStep,
  type ResumeAnswer,
  ResumeStep,
  StationStep,
  TripCard,
  TripLine,
  useDirectionName,
} from "@/features/entry/EntrySteps";
import {
  createEntryData,
  type EntryData,
  type EntryLine,
  type EntryPlace,
  findAreaAt,
  findStationChoice,
  listEntryHubs,
  openStationChoice,
  type Position,
  pickPlaceName,
  resolveConfiguredArea,
} from "@/features/entry/entry-places";
import {
  initialEntryState,
  reduceEntry,
  selectProgressIndex,
  stageDepth,
} from "@/features/entry/flow";
import { buildLineObservation } from "@/features/entry/seed";
import {
  buildDefaultBetweenPosition,
  buildStationPosition,
  NEXT_STATION_CANDIDATE_LIMIT,
} from "@/features/entry/train-position-defaults";
import { useEntryHistory } from "@/features/entry/use-entry-history";
import { listMapStations } from "@/features/entry/visible-stations";
import { type TripContext, useJudgmentSession } from "@/features/judgment/session";
import { testIds } from "@/features/judgment/testids";
import { pickLocalized as pickCatalogName } from "@/features/knowledge/catalog";
import { loadMapGeoData, type MapGeoData } from "@/features/map/geo-data";
import type { MapInsets } from "@/features/map/MapPanel";
import { findFocusArea } from "@/features/map/station-guide";
import {
  findElapsedOption,
  listCauseOptions,
  listResumeTimeOptions,
} from "@/features/situation/plain-questions";
import {
  findNearestChoices,
  type NearestStationChoice,
  type StationChoice,
} from "@/features/stations/catalog";
import { describePlace, pickStationName } from "@/features/stations/describe";
import { useCurrentLocation } from "@/features/stations/use-current-location";
import { desktopMediaQuery, useMediaQuery } from "@/lib/use-media-query";

// 判断の画面が最初に寄せる大阪駅のまわりの拡大率に近い値
const handoffZoom = 15.8;
// PC 幅の右パネルの幅と余白
const panelInset = 400 + 32;
// PC 幅の関西の段で、左に重ねる列（上部の帯・問いかけ・デモの札）の幅と余白
const leftColumnInset = 560 + 32;

// 高さを測って地図の余白に使う
function useElementHeight<T extends HTMLElement>() {
  const [height, setHeight] = useState(0);
  const observerRef = useRef<ResizeObserver | null>(null);
  const ref = useCallback((el: T | null) => {
    observerRef.current?.disconnect();
    if (!el) {
      setHeight(0);
      return;
    }
    const measure = () => setHeight(el.offsetHeight);
    measure();
    observerRef.current = new ResizeObserver(measure);
    observerRef.current.observe(el);
  }, []);
  return [ref, height] as const;
}

function useEntryData(): { geo: MapGeoData | null; data: EntryData | null } {
  const [geo, setGeo] = useState<MapGeoData | null>(null);
  useEffect(() => {
    let cancelled = false;
    loadMapGeoData()
      .then((loaded) => {
        if (!cancelled) setGeo(loaded);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);
  const data = useMemo(() => (geo ? createEntryData(geo.nodes, geo.index) : null), [geo]);
  return { geo, data };
}

// 入口。大阪を中心にした地図で駅を選び、同じ地図の上のシートで状況まで入れて判断へ渡す
export function StartScreen() {
  const t = useTranslations();
  const locale = useLocale();
  const router = useRouter();
  const session = useJudgmentSession();
  const {
    origin,
    destination,
    originLine,
    setOrigin,
    setDestination,
    setOriginLine,
    setOriginNearest,
    setTripContext,
    tripContext,
    trainPosition,
    setTrainPosition,
    rememberStationName,
    stationNames,
    catalog,
    state: judgment,
    startJudgment,
  } = session;
  const { geo, data } = useEntryData();
  const [nearest, setNearest] = useState<NearestStationChoice[]>([]);
  const mapStations = useMemo(() => (data ? listMapStations(data) : []), [data]);
  const hubs = useMemo(() => (data ? listEntryHubs(data) : []), [data]);
  const [entry, dispatch] = useReducer(reduceEntry, initialEntryState);
  const [note, setNote] = useState<string | null>(null);
  const [handingOff, setHandingOff] = useState(false);
  const mapApi = useRef<EntryMapApi | null>(null);
  const desktop = useMediaQuery(desktopMediaQuery);
  const narrow = useMediaQuery("(max-width: 639px)");
  const [promptRef, promptHeight] = useElementHeight<HTMLDivElement>();
  const [dockRef, dockHeight] = useElementHeight<HTMLDivElement>();
  const [sheetHeight, setSheetHeight] = useState(0);
  const depth = stageDepth(entry.stage);
  const [restored, setRestored] = useState(false);
  const goToDepth = useEntryHistory(depth, dispatch, restored);
  const nameDirection = useDirectionName();
  // 電車の中と答えたか。近い駅を聞いている間も true
  const [onTrain, setOnTrain] = useState(false);
  // 電車の中で選んだ近い駅。出発の駅をこの駅で近似する
  const [nearStop, setNearStop] = useState<DirectionStop | null>(null);
  // 駅と駅の間と答えたか。次の駅を出発の駅にし、前提は判断の画面のチップで直す
  const between = trainPosition?.kind === "between_stations";
  // 前の列車の既定の並びを、運転パターンから推し量ったか
  const [betweenFromPattern, setBetweenFromPattern] = useState(false);
  const [destinationBasis, setDestinationBasis] =
    useState<TripContext["destinationBasis"]>("chosen");
  // 再開見込みの問いで押した答え。判断を始めるまでその札に印を出す
  const [pendingResume, setPendingResume] = useState<string | null>(null);
  const directions = useMemo(
    () => (data && entry.line ? listEntryDirections(data, entry.line) : []),
    [data, entry.line],
  );
  const direction = directions.find((d) => d.key === entry.direction) ?? null;
  const nearby = useMemo(
    () =>
      data && entry.line && direction
        ? listNearbyStops(data, entry.line, directions, direction)
        : [],
    [data, entry.line, directions, direction],
  );
  const causeOptions = useMemo(() => listCauseOptions(catalog), [catalog]);
  // 再開見込みの時刻の候補。問いに入った時刻から並べる
  const resumeTimes = useMemo(
    () => (entry.stage === "resume" ? listResumeTimeOptions(new Date()) : []),
    [entry.stage],
  );

  // エリアや関西まで引いたら、選んでいた出発の駅と路線を捨てる
  const prevStageRef = useRef(entry.stage);
  useEffect(() => {
    const prev = prevStageRef.current;
    prevStageRef.current = entry.stage;
    if (depth < stageDepth(prev) && depth <= stageDepth("area")) {
      setOrigin(null);
      setOriginLine(null);
      setNote(null);
    }
    if (depth >= stageDepth(prev)) return;
    setPendingResume(null);
    if (depth >= stageDepth("position")) return;
    // いまどこの段より前に引いたら、電車の中の答えを捨てて出発を選んだ駅に戻す
    setOnTrain(false);
    if ((nearStop || between) && entry.line) {
      setOrigin({ kind: "station", name: entry.line.stationName });
    }
    setNearStop(null);
    setTrainPosition(null);
  }, [
    entry.stage,
    entry.line,
    depth,
    nearStop,
    between,
    setOrigin,
    setOriginLine,
    setTrainPosition,
  ]);

  // 判断の画面から戻ったときは、選んだ駅・路線・行き先の状態に戻す
  useEffect(() => {
    if (!data || restored) return;
    setRestored(true);
    if (origin?.kind !== "station" || !originLine) return;
    const choice = findStationChoice(data, originLine.stationName);
    const opened = choice ? openStationChoice(data, choice) : null;
    if (!opened) return;
    dispatch({ type: "openPlace", area: opened.area, place: opened.place });
    const lineDirections = listEntryDirections(data, originLine);
    const auto = lineDirections.length === 1 ? (lineDirections[0]?.key ?? null) : null;
    dispatch({ type: "chooseLine", line: originLine, autoDirection: auto });
    const chosen = lineDirections.find((d) => d.key === tripContext?.directionKey);
    if (!chosen || !tripContext || !destination) return;
    if (!auto) dispatch({ type: "chooseDirection", direction: chosen.key });
    dispatch({ type: "chooseDestination" });
    setDestinationBasis(tripContext.destinationBasis);
    if (tripContext.position === "trainAtStation") {
      const stop = listNearbyStops(data, originLine, lineDirections, chosen).find(
        (s) => s.choice.name === origin.name,
      );
      setOnTrain(true);
      setNearStop(stop ?? null);
    }
    // 駅と駅の間の前提は session の trainPosition に残っている。出どころの印だけ戻す
    if (tripContext.position === "betweenStations") {
      setBetweenFromPattern(tripContext.trainsAheadFromPattern ?? false);
    }
    dispatch({ type: "choosePosition" });
    // 様子の段で答えたところまで進め、最後に答えた問いから選び直せるようにする
    const answers = tripContext.entryAnswers;
    if (!answers) return;
    if (answers.cause) dispatch({ type: "chooseCause", cause: answers.cause });
    else if (answers.method) dispatch({ type: "chooseMethod", method: answers.method });
    if (answers.elapsed) dispatch({ type: "chooseElapsed", elapsed: answers.elapsed });
  }, [data, restored, origin, originLine, destination, tripContext]);

  const openPlace = useCallback(
    (choice: StationChoice) => {
      if (!data) return;
      const opened = openStationChoice(data, choice);
      if (opened) dispatch({ type: "openPlace", area: opened.area, place: opened.place });
    },
    [data],
  );

  // 位置は端末内の駅データとの照合だけに使う。
  const handleLocated = useCallback(
    (point: { lat: number; lon: number }) => {
      if (!data) return;
      const choices = findNearestChoices(data.index, data.catalog, point, 1);
      setNearest(choices);
      setNote(choices.length ? null : t("entry.nearestEmpty"));
    },
    [data, t],
  );
  const { status: locateStatus, locate } = useCurrentLocation(handleLocated);
  const locateRef = useRef(locate);
  locateRef.current = locate;
  useEffect(() => {
    if (!data || !navigator.permissions) return;
    let cancelled = false;
    navigator.permissions
      .query({ name: "geolocation" })
      .then((permission) => {
        if (!cancelled && permission.state === "granted") locateRef.current();
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [data]);
  const locateMessage =
    locateStatus === "locating"
      ? `${t("start.locating")} ${t("entry.locationNote")}`
      : locateStatus === "failed"
        ? t("start.locateFailed")
        : locateStatus === "unsupported"
          ? t("start.locateUnsupported")
          : note && entry.stage === "kansai"
            ? note
            : null;

  function handleTap(point: Position) {
    if (!data) return;
    if (entry.stage === "kansai") {
      const area = findAreaAt(data, point);
      if (area) dispatch({ type: "openArea", area });
    } else if (entry.stage === "station") {
      goToDepth(stageDepth("area"));
    }
  }

  // 方面が 1 つしか無い路線（起点の駅など）は、方面を聞かずに決める
  function chooseLine(line: EntryLine) {
    rememberStationName(line.stationName, line.stationNameEn);
    setOrigin({ kind: "station", name: line.stationName });
    setOriginNearest(null);
    setOriginLine(line);
    const lineDirections = data ? listEntryDirections(data, line) : [];
    const auto = lineDirections.length === 1 ? (lineDirections[0]?.key ?? null) : null;
    dispatch({ type: "chooseLine", line, autoDirection: auto });
  }

  function chooseDirection(chosen: EntryDirection) {
    dispatch({ type: "chooseDirection", direction: chosen.key });
  }

  function chooseDestination(
    target: StationChoice | string,
    basis: TripContext["destinationBasis"] = "chosen",
  ) {
    const choice = typeof target === "string" && data ? findStationChoice(data, target) : target;
    if (choice && typeof choice !== "string") {
      rememberStationName(choice.name, choice.nameEn);
      setDestination({ kind: "station", name: choice.name });
    } else if (typeof target === "string") {
      setDestination({ kind: "station", name: target });
    }
    setDestinationBasis(basis);
    dispatch({ type: "chooseDestination" });
  }

  // 行き先を決めずに、方面の先の主な駅か終点で進む
  function chooseUndecided() {
    if (direction) chooseDestination(direction.fallback.stop.choice, direction.fallback.kind);
  }

  function chooseStation() {
    if (!entry.line) return;
    setOnTrain(false);
    setNearStop(null);
    setOrigin({ kind: "station", name: entry.line.stationName });
    setTrainPosition(buildStationPosition("at_station"));
    dispatch({ type: "choosePosition" });
  }

  // 駅に止まっている車内なら、選んだ駅にいるとみなす
  function chooseNearStop(stop: DirectionStop) {
    rememberStationName(stop.choice.name, stop.choice.nameEn);
    setNearStop(stop);
    setOrigin({ kind: "station", name: stop.choice.name });
    setTrainPosition(buildStationPosition("on_train_at_station"));
    dispatch({ type: "choosePosition" });
  }

  // 駅と駅の間なら、問いを重ねずに既定値で進む。次の駅を出発の駅にし、前提は判断の画面で直せる
  function chooseBetween() {
    if (!entry.line || !direction) return;
    const defaults = buildDefaultBetweenPosition(entry.line, direction);
    if (!defaults) {
      chooseStation();
      return;
    }
    const next = direction.stops[0];
    if (next) rememberStationName(next.choice.name, next.choice.nameEn);
    setOnTrain(false);
    setNearStop(null);
    setBetweenFromPattern(defaults.trainsAheadFromPattern);
    setTrainPosition(defaults.position, {
      edited: { nextStation: false, ownTrainType: false, trainsAhead: false },
      trainsAheadFromPattern: defaults.trainsAheadFromPattern,
    });
    if (defaults.position.nextStation) {
      setOrigin({ kind: "station", name: defaults.position.nextStation });
    }
    dispatch({ type: "choosePosition" });
  }

  function handleBack() {
    if (entry.stage === "position" && onTrain) setOnTrain(false);
    else goToDepth(depth - 1);
  }

  // 判断を始め、出発の駅へ寄せてから判断の画面へ移る。地図はそのまま判断の地図に引き継ぐ
  // 問いに答えたときだけ、止まってからの分と原因が分からないかを前提として残し、
  // 放送で聞いた再開見込みの時刻を路線の観測に載せる
  async function submit(
    input: RawInput | null,
    answers: {
      elapsedMinutes: number | null;
      causeUnknown: boolean;
      statedResumeTime: string | null;
    } | null = null,
  ) {
    if (!entry.line || !direction || origin === null) return;
    setTripContext({
      directionKey: direction.key,
      directionLabel: direction.label,
      destinationBasis,
      onTrain: nearStop !== null || between,
      position: between ? "betweenStations" : nearStop ? "trainAtStation" : "station",
      nextStationCandidates: direction.stops
        .slice(0, NEXT_STATION_CANDIDATE_LIMIT)
        .map((s) => ({ name: s.choice.name, nameEn: s.choice.nameEn })),
      directionStopNames: direction.stops.map((s) => s.choice.name),
      trainsAheadFromPattern: betweenFromPattern,
      entryAnswers: { method: entry.method, cause: entry.cause, elapsed: entry.elapsed },
      ...(answers
        ? { elapsedMinutes: answers.elapsedMinutes, causeUnknown: answers.causeUnknown }
        : {}),
    });
    startJudgment(input, [
      buildLineObservation(
        entry.line,
        new Date(),
        answers?.elapsedMinutes ?? null,
        answers?.statedResumeTime ?? null,
      ),
    ]);
    setHandingOff(true);
    if (findFocusArea(origin)) await mapApi.current?.zoomToOrigin(handoffZoom);
    router.push("/judgment");
  }

  const showSheet = entry.stage !== "kansai";
  const insets: MapInsets = desktop
    ? {
        top: sheetTopInset,
        right: showSheet ? panelInset : 0,
        bottom: 0,
        left: showSheet ? 0 : leftColumnInset,
      }
    : {
        top: showSheet ? sheetTopInset : sheetTopInset + promptHeight + 8,
        right: 0,
        bottom: showSheet ? sheetHeight : dockHeight,
        left: 0,
      };

  const originName = entry.place ? pickPlaceName(entry.place, locale) : "";
  const lineOriginName =
    entry.line && origin
      ? describePlace(origin, locale, t("start.currentLocation"), stationNames).label
      : originName;
  const lineStationName = entry.line
    ? pickStationName(
        { name: entry.line.stationName, nameEn: stationNames[entry.line.stationName] ?? null },
        locale,
      )
    : originName;
  const destinationLabel = destination
    ? describePlace(destination, locale, t("start.currentLocation"), stationNames).label
    : "";
  const destinationChoice =
    destination?.kind === "station" && data ? findStationChoice(data, destination.name) : null;
  const destinationMarker = destinationChoice
    ? {
        position: [destinationChoice.lon, destinationChoice.lat] as Position,
        label: destinationLabel,
      }
    : null;
  const candidates = direction ? listDirectionCandidates(direction) : [];
  const placePosition = entry.place?.position ?? null;
  // 電車の中で近い駅を選んだら、地図の現在地もその駅に移す
  const mapPlace =
    entry.place && nearStop
      ? {
          ...entry.place,
          name: { ja: nearStop.choice.name, en: nearStop.choice.nameEn },
          position: nearStop.position,
          // 近い駅の路線はすべては分からないので、乗っている路線の色だけを添える
          lines: entry.place.lines.filter((l) => l.lineId === entry.line?.lineId),
        }
      : entry.place;
  const angles = Object.fromEntries(
    directions.map((d) => [d.key, placePosition ? computeDirectionAngle(placePosition, d) : 0]),
  );
  const progressIndex = selectProgressIndex(entry.stage);
  const tripLine =
    entry.line && destination ? (
      <TripLine
        originName={lineOriginName}
        destinationName={destinationLabel}
        line={entry.line}
        onEditDestination={() => goToDepth(stageDepth("destination"))}
      />
    ) : null;
  const destinationNote =
    destinationBasis === "hub"
      ? t("entry.tripHub")
      : destinationBasis === "terminal"
        ? t("entry.tripTerminal")
        : direction
          ? nameDirection(direction)
          : null;

  // ここまでに答えた原因と時間のチップ。押すとその問いまで引いて選び直す
  function nameCause(eventType: string | null): string {
    if (eventType === null) return t("entry.causes.unknown");
    const option = causeOptions.find((o) => o.eventType === eventType);
    if (option?.kind === "preset") return t(`entry.causes.${option.id}`);
    const event = catalog.find((e) => e.id === eventType);
    return event ? pickCatalogName(event.name, locale) : eventType;
  }
  const answered: AnsweredItem[] = [
    ...(entry.cause
      ? [
          {
            kind: "cause" as const,
            label: nameCause(entry.cause.eventType),
            onEdit: () => goToDepth(stageDepth("cause")),
          },
        ]
      : []),
    ...(entry.elapsed
      ? [
          {
            kind: "elapsed" as const,
            label: t(`entry.elapsed.${entry.elapsed}`),
            onEdit: () => goToDepth(stageDepth("elapsed")),
          },
        ]
      : []),
  ];

  // 3 問目の答えで判断を始める。原因が分からなければ事象の無い観測で判断する
  function submitAnswers(answer: ResumeAnswer) {
    const eventType = entry.cause?.eventType ?? null;
    const elapsed = entry.elapsed ? findElapsedOption(entry.elapsed) : null;
    setPendingResume(answer.time?.id ?? answer.id);
    void submit(eventType ? { type: "selection", eventType, signalIds: [] } : null, {
      elapsedMinutes: elapsed?.minutes ?? null,
      causeUnknown: eventType === null,
      statedResumeTime: answer.time?.iso ?? null,
    });
  }

  // シートの答えと同じものを、地図の札にも置く
  function buildMapStops(): MapStop[] {
    if (!entry.line || !placePosition) return [];
    const from = placePosition;
    const color = entry.line.color;
    // 東西に並ぶ札は上に、南北に並ぶ札は右に出す。方面の札は文字が長いので、向きに合わせて上か下に出す
    const sideOf = (position: Position, long = false): MapStop["side"] => {
      const dx = (position[0] - from[0]) * Math.cos((from[1] * Math.PI) / 180);
      const dy = position[1] - from[1];
      if (long) return dy < 0 && Math.abs(dy) > Math.abs(dx) ? "bottom" : "top";
      return Math.abs(dx) > Math.abs(dy) ? "top" : "right";
    };
    const toStop = (key: string, stop: DirectionStop): MapStop => ({
      key,
      position: stop.position,
      label: pickStationName(stop.choice, locale),
      color,
      angle: null,
      side: sideOf(stop.position),
    });
    if (entry.stage === "direction") {
      return directions.flatMap((d, i) => {
        const stop = d.stops[Math.min(2, d.stops.length - 1)];
        if (!stop) return [];
        return [
          {
            ...toStop(`direction-${i}`, stop),
            label: nameDirection(d),
            angle: angles[d.key] ?? 0,
            side: sideOf(stop.position, true),
          },
        ];
      });
    }
    // 札が重ならないよう、離れた主な駅だけを地図に出す。シートには全部の候補を出す
    // 方面の呼び名に出した駅を先に置き、方面の向きが地図でも分かるようにする
    if (entry.stage === "destination" && direction) {
      const ordered = [
        ...direction.landmarks,
        ...candidates.filter((c) => !direction.landmarks.includes(c)),
      ];
      return pickSpreadStops(ordered, from).map((stop) =>
        toStop(`destination-${stop.choice.id}`, stop),
      );
    }
    // 選んだ駅は現在地の丸が受け持つので、隣の駅だけを札にする
    if (entry.stage === "position" && onTrain) {
      return nearby
        .filter((stop) => stop.choice.id !== entry.line?.stationName)
        .map((stop) => toStop(`near-${stop.choice.id}`, stop));
    }
    return [];
  }
  const mapStops = buildMapStops();

  function selectMapStop(key: string) {
    const [kind, ...rest] = key.split("-");
    const id = rest.join("-");
    if (kind === "direction") {
      const chosen = directions[Number(id)];
      if (chosen) chooseDirection(chosen);
    } else if (kind === "destination") {
      const stop = candidates.find((c) => c.choice.id === id);
      if (stop) chooseDestination(stop.choice);
    } else if (kind === "near") {
      const stop = nearby.find((c) => c.choice.id === id);
      if (stop) chooseNearStop(stop);
    }
  }

  // 地図の座標変換で端数が出ても44pxを下回らないよう、操作部品の高さに余裕を持たせる
  return (
    <div
      data-testid={testIds.start.screen}
      data-stage={entry.stage}
      className="h-dvh [&_[data-testid=start-map]_button]:min-h-12"
    >
      <EntryMap
        geo={geo}
        stations={mapStations}
        stage={entry.stage}
        hubs={hubs}
        area={entry.area}
        place={mapPlace}
        lineId={entry.line?.lineId ?? null}
        destination={destinationMarker}
        stops={mapStops}
        focus={entry.stage === "position" && !onTrain ? nearby.map((s) => s.position) : []}
        onSelectStop={selectMapStop}
        insets={insets}
        narrow={narrow}
        apiRef={mapApi}
        onSelectHub={(areaId) => {
          const area = data ? resolveConfiguredArea(data, areaId) : null;
          if (area) dispatch({ type: "openArea", area });
        }}
        onSelectPlace={(place: EntryPlace) => {
          // 選んだ駅の丸を押しても、ここまでの答えは捨てない。電車の中なら近い駅の答えにする
          if (place.key === entry.place?.key && stageDepth(entry.stage) > stageDepth("station")) {
            const here = nearby.find((s) => s.choice.id === entry.line?.stationName);
            if (entry.stage === "position" && onTrain && here) chooseNearStop(here);
            return;
          }
          const area = data ? findAreaAt(data, place.position) : null;
          if (area) dispatch({ type: "openPlace", area, place });
        }}
        onTap={handleTap}
      />
      <AppHeader
        variant="map"
        below={
          entry.stage === "kansai" ? (
            <>
              <div ref={promptRef} className="flex flex-col gap-2">
                <div
                  data-testid="start-intro"
                  className="glass-strong rounded-[20px] px-4 py-3 text-[14px] leading-snug"
                >
                  <p data-testid="start-intro-audience">{t("start.introAudience")}</p>
                  <p data-testid="start-intro-problem" className="mt-1 text-muted">
                    {t("start.introProblem")}
                  </p>
                  <p data-testid="start-intro-solution" className="mt-1 font-semibold">
                    {t("start.introSolution")}
                  </p>
                </div>
                <PromptCard
                  locateStatus={locateStatus}
                  message={locateMessage}
                  onLocate={locate}
                  nearest={nearest}
                  onSelect={openPlace}
                  quickPicks={desktop ? hubs : null}
                  onQuickPick={(stationName) => {
                    const choice = data ? findStationChoice(data, stationName) : null;
                    if (choice) openPlace(choice);
                  }}
                />
              </div>
              {desktop && <DemoDock inline />}
            </>
          ) : undefined
        }
      />
      <main id="main">
        {entry.stage === "kansai" && !desktop && <DemoDock ref={dockRef} />}
        {showSheet && (
          <EntrySheet
            stageKey={`${entry.stage}:${entry.area?.id}:${entry.place?.key}:${onTrain}`}
            onBack={handleBack}
            onHeightChange={setSheetHeight}
            progress={progressIndex >= 0 ? <EntryProgress index={progressIndex} /> : null}
          >
            {entry.stage === "area" && entry.area && (
              <AreaStep
                area={entry.area}
                onSelect={(place) =>
                  entry.area && dispatch({ type: "openPlace", area: entry.area, place })
                }
              />
            )}
            {entry.stage === "station" && entry.place && (
              <StationStep place={entry.place} note={note} onSelect={chooseLine} />
            )}
            {entry.stage === "direction" && entry.line && (
              <DirectionStep
                originName={lineStationName}
                line={entry.line}
                directions={directions}
                angles={angles}
                onSelect={chooseDirection}
              />
            )}
            {entry.stage === "destination" && entry.line && direction && (
              <DestinationStep
                originName={lineStationName}
                line={entry.line}
                direction={direction}
                candidates={candidates}
                onSelect={(station) => chooseDestination(station)}
                onUndecided={chooseUndecided}
                onFreeText={(text) => chooseDestination(text)}
              />
            )}
            {entry.stage === "position" && entry.line && (
              <PositionStep
                originName={lineStationName}
                line={entry.line}
                onTrain={onTrain}
                nearby={nearby}
                hereId={entry.line.stationName}
                onStation={chooseStation}
                onTrainChosen={() => setOnTrain(true)}
                onBetween={chooseBetween}
                onNearStop={chooseNearStop}
              />
            )}
            {entry.stage === "cause" && entry.line && (
              <TripCard
                originName={lineOriginName}
                originNote={
                  between
                    ? t("entry.positionBetweenTrip")
                    : nearStop
                      ? t("entry.positionTrain")
                      : null
                }
                destinationName={destinationLabel}
                destinationNote={destinationNote}
                line={entry.line}
                onEditLine={() => goToDepth(stageDepth("station"))}
                onEditDestination={() => goToDepth(stageDepth("destination"))}
              />
            )}
            {entry.stage === "cause" && (
              <CauseStep
                options={causeOptions}
                catalog={catalog}
                onSelect={(eventType) => dispatch({ type: "chooseCause", cause: { eventType } })}
                onMethod={(method) => dispatch({ type: "chooseMethod", method })}
              />
            )}
            {entry.stage === "input" && entry.method && (
              <InputStep
                method={entry.method}
                trip={tripLine}
                busy={handingOff || judgment.status === "streaming"}
                onSubmit={(input) => void submit(input)}
              />
            )}
            {entry.stage === "elapsed" && entry.cause && (
              <ElapsedStep
                trip={tripLine}
                answers={answered}
                onSelect={(option) => dispatch({ type: "chooseElapsed", elapsed: option.id })}
              />
            )}
            {entry.stage === "resume" && entry.cause && entry.elapsed && (
              <ResumeStep
                trip={tripLine}
                answers={answered}
                busy={handingOff || judgment.status === "streaming"}
                pending={pendingResume}
                times={resumeTimes}
                onSelect={submitAnswers}
              />
            )}
          </EntrySheet>
        )}
      </main>
    </div>
  );
}
