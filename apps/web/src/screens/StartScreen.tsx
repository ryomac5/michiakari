"use client";

import type { RawInput } from "@repo/schema";
import { ChevronLeft } from "lucide-react";
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
  listTrainPositionStops,
  mergeDirectionCandidates,
  pickSpreadStops,
} from "@/features/entry/directions";
import {
  LocationStep,
  TrainLineStep,
  TrainPositionStep,
} from "@/features/entry/EntryLocationSteps";
import { EntryMap, type EntryMapApi, type MapStop } from "@/features/entry/EntryMap";
import { DemoDock, LocationSearch, PromptCard } from "@/features/entry/EntryOverlays";
import { EntrySheet } from "@/features/entry/EntrySheet";
import {
  type AnsweredItem,
  AreaStep,
  CauseKindStep,
  CauseStep,
  computeDirectionAngle,
  DestinationStep,
  DirectionStep,
  ElapsedStep,
  EntryProgress,
  InputStep,
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
import {
  type GpsChoice,
  inferSegmentTravel,
  listGpsChoices,
  listSegmentTravels,
  resolveSegmentTravel,
  type SegmentTravel,
} from "@/features/entry/gps-candidates";
import { inferEntryRoutes, listTrainLines } from "@/features/entry/infer-route";
import { buildLineObservation } from "@/features/entry/seed";
import {
  buildDefaultBetweenPosition,
  buildStationPosition,
  NEXT_STATION_CANDIDATE_LIMIT,
} from "@/features/entry/train-position-defaults";
import { useEntryHistory } from "@/features/entry/use-entry-history";
import { useGpsPosition } from "@/features/entry/use-gps-position";
import { listMapStations } from "@/features/entry/visible-stations";
import { type TripContext, useJudgmentSession } from "@/features/judgment/session";
import { testIds } from "@/features/judgment/testids";
import { loadMapGeoData, type MapGeoData } from "@/features/map/geo-data";
import type { MapInsets } from "@/features/map/MapPanel";
import { findFocusArea } from "@/features/map/station-guide";
import { type CauseAnswer, resolveCauseEventType } from "@/features/situation/cause-categories";
import { findElapsedOption, listResumeTimeOptions } from "@/features/situation/plain-questions";
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
  const depth = stageDepth(entry);
  const getDepth = (stage: Parameters<typeof stageDepth>[1]) => stageDepth(entry, stage);
  const [restored, setRestored] = useState(false);
  const goToDepth = useEntryHistory(depth, dispatch, restored);
  const nameDirection = useDirectionName();
  // 電車の中と答えたか。近い駅を聞いている間も true
  const onTrain = entry.location === "train";
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
  // 現在地から読み取った駅の間を通る向き。方面の段にはこの向きだけを出す
  const segmentTravels = useMemo(
    () =>
      data && entry.segment && entry.line
        ? listSegmentTravels(data, entry.line, entry.segment)
        : [],
    [data, entry.segment, entry.line],
  );
  const stepDirections = entry.segment ? segmentTravels.map((t) => t.direction) : directions;
  const direction =
    segmentTravels.find(
      (t) => t.line.stationName === entry.line?.stationName && t.direction.key === entry.direction,
    )?.direction ??
    directions.find((d) => d.key === entry.direction) ??
    null;
  const nearby = useMemo(
    () =>
      data && entry.line && direction
        ? listNearbyStops(data, entry.line, directions, direction)
        : [],
    [data, entry.line, directions, direction],
  );
  // 再開見込みの時刻の候補。問いに入った時刻から並べる
  const resumeTimes = useMemo(
    () => (entry.stage === "resume" ? listResumeTimeOptions(new Date()) : []),
    [entry.stage],
  );

  // 判断から戻る際は、実際に通った分岐と履歴をそのまま復元する。
  useEffect(() => {
    if (!data || restored) return;
    setRestored(true);
    if (!tripContext?.entryState || !originLine) return;
    dispatch({ type: "restore", state: tripContext.entryState });
    setDestinationBasis(tripContext.destinationBasis);
    setBetweenFromPattern(tripContext.trainsAheadFromPattern ?? false);
    if (tripContext.position === "trainAtStation") {
      const restoredDirections = listEntryDirections(data, originLine);
      const chosen = restoredDirections.find((d) => d.key === tripContext.directionKey);
      if (chosen)
        setNearStop(
          [
            ...listNearbyStops(data, originLine, restoredDirections, chosen),
            ...restoredDirections.flatMap((d) => d.stops),
          ].find((stop) => origin?.kind === "station" && stop.choice.name === origin.name) ?? null,
        );
    }
  }, [data, restored, origin, originLine, tripContext]);

  useEffect(() => {
    if (!restored) return;
    if (entry.stage !== "resume") setPendingResume(null);
    if (entry.stage === "position" || entry.stage === "kansai" || entry.stage === "area") {
      setOrigin(null);
      setOriginLine(null);
      setTrainPosition(null);
      setNearStop(null);
    }
  }, [entry.stage, restored, setOrigin, setOriginLine, setTrainPosition]);

  const selectPlace = useCallback(
    (area: NonNullable<typeof entry.area>, place: EntryPlace) => {
      if (!["position", "kansai", "area"].includes(entry.stage)) return;
      const line = place.lines[0];
      if (line) {
        rememberStationName(line.stationName, line.stationNameEn);
        setOrigin({ kind: "station", name: line.stationName });
        setTrainPosition(buildStationPosition("at_station"));
      }
      dispatch({ type: "openPlace", area, place });
    },
    [entry.stage, rememberStationName, setOrigin, setTrainPosition],
  );

  const openPlace = useCallback(
    (choice: StationChoice) => {
      if (!data) return;
      const opened = openStationChoice(data, choice);
      if (opened) selectPlace(opened.area, opened.place);
    },
    [data, selectPlace],
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
  // 入口の最初の段の「現在地から読み取る」。候補は端末の中の駅データだけで出す
  const gps = useGpsPosition();
  const gpsChoices = useMemo(
    () =>
      gps.status.kind === "located" && data && geo
        ? listGpsChoices(data, geo.nodes, gps.status.point)
        : [],
    [gps.status, data, geo],
  );

  function confirmGpsChoice(choice: GpsChoice) {
    if (!data || entry.stage !== "position") return;
    if (choice.kind === "station") {
      const opened = openStationChoice(data, choice.choice);
      const line = opened?.place.lines[0];
      if (!opened || !line) return;
      rememberStationName(line.stationName, line.stationNameEn);
      setOrigin({ kind: "station", name: line.stationName });
      setTrainPosition(buildStationPosition("at_station"));
      dispatch({ type: "locateStation", area: opened.area, place: opened.place });
      return;
    }
    rememberStationName(choice.from.name, choice.from.nameEn);
    rememberStationName(choice.to.name, choice.to.nameEn);
    setOrigin({ kind: "station", name: choice.from.name });
    setOriginNearest(null);
    setOriginLine(choice.line);
    const opened = openStationChoice(data, choice.from);
    dispatch({
      type: "locateBetween",
      line: choice.line,
      segment: { from: choice.from.name, to: choice.to.name },
      ...(opened ?? {}),
    });
  }

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
    if (entry.stage === "position" || entry.stage === "kansai") {
      const area = findAreaAt(data, point);
      if (area) dispatch({ type: "openArea", area });
    } else if (entry.stage === "destination" && !onTrain) {
      // 検索や近くの駅から来た人はエリアの段を通っていないので、地図の段へ戻す。無ければ留まる
      const mapDepth = Math.max(getDepth("area"), getDepth("kansai"));
      if (mapDepth >= 0) goToDepth(mapDepth);
    }
  }

  // 方面が 1 つしか無い路線（起点の駅など）は、方面を聞かずに決める
  function chooseLine(line: EntryLine) {
    rememberStationName(line.stationName, line.stationNameEn);
    setOrigin({ kind: "station", name: line.stationName });
    setOriginNearest(null);
    setOriginLine(line);
    const lineDirections = data ? listEntryDirections(data, line) : [];
    const matching =
      !onTrain && !entry.routeEditing && destinationChoice && data && entry.place
        ? inferEntryRoutes(data, entry.place, destinationChoice).filter(
            (c) => c.line.key === line.key,
          )
        : [];
    const auto =
      matching.length === 1
        ? (matching[0]?.direction.key ?? null)
        : !onTrain && lineDirections.length === 1
          ? (lineDirections[0]?.key ?? null)
          : null;
    const station = data ? findStationChoice(data, line.stationName) : null;
    const opened = data && station ? openStationChoice(data, station) : null;
    dispatch({
      type: "chooseLine",
      line,
      autoDirection: auto,
      ...(onTrain && opened ? opened : {}),
    });
  }

  // 読み取った駅の間の向きを決められなければ、先へ進めず手で選ぶ流れに戻す
  function abandonSegment() {
    gps.reset();
    goToDepth(0);
  }

  function chooseDirection(chosen: EntryDirection) {
    // 現在地から読み取った駅の間なら、選んだ方面をその駅の間を通る向きに対応づける
    if (entry.segment) {
      const travel = resolveSegmentTravel(segmentTravels, chosen);
      if (!travel || !applyBetween(travel)) {
        abandonSegment();
        return;
      }
      dispatch({ type: "chooseDirection", direction: travel.direction.key, line: travel.line });
      return;
    }
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
    const targetChoice = typeof choice !== "string" ? choice : null;
    // 現在地から読み取った駅の間は、行き先から進む向きを決める。決まらなければ方面を聞く
    if (onTrain && entry.segment) {
      if (segmentTravels.length === 0) {
        abandonSegment();
        return;
      }
      const travel = targetChoice ? inferSegmentTravel(segmentTravels, targetChoice) : null;
      const applied = travel !== null && applyBetween(travel);
      dispatch({
        type: "chooseDestination",
        inferred:
          travel && applied ? { line: travel.line, direction: travel.direction.key } : undefined,
      });
      return;
    }
    const inferred =
      !onTrain && data && entry.place && targetChoice
        ? inferEntryRoutes(data, entry.place, targetChoice)
        : [];
    const candidate = inferred.length === 1 ? inferred[0] : null;
    if (candidate) {
      setOriginLine(candidate.line);
      setOrigin({ kind: "station", name: candidate.line.stationName });
    }
    dispatch({
      type: "chooseDestination",
      inferred: candidate
        ? { line: candidate.line, direction: candidate.direction.key }
        : undefined,
    });
  }

  // 行き先を決めずに、方面の先の主な駅か終点で進む
  function chooseUndecided() {
    if (direction) chooseDestination(direction.fallback.stop.choice, direction.fallback.kind);
  }

  // 駅に止まっている車内なら、選んだ駅にいるとみなす
  function chooseNearStop(stop: DirectionStop) {
    if (!entry.line || !data) return;
    const line = {
      ...entry.line,
      stationName: stop.choice.name,
      stationNameEn: stop.choice.nameEn,
    };
    const options = listEntryDirections(data, line);
    const chosen = options.find((d) => d.key === entry.direction) ?? options[0];
    if (!chosen) return;
    setOriginLine(line);
    rememberStationName(stop.choice.name, stop.choice.nameEn);
    setNearStop(stop);
    setOrigin({ kind: "station", name: stop.choice.name });
    setTrainPosition(buildStationPosition("on_train_at_station"));
    dispatch({ type: "choosePosition", line, direction: chosen.key });
  }

  // 駅と駅の間なら、問いを重ねずに既定値で進む。次の駅を出発の駅にし、前提は判断の画面で直せる
  function chooseBetween(from: DirectionStop, to: DirectionStop) {
    if (!entry.line || !direction || !data) return;
    const line = {
      ...entry.line,
      stationName: from.choice.name,
      stationNameEn: from.choice.nameEn,
    };
    const chosen = listEntryDirections(data, line).find(
      (d) => d.stops[0]?.choice.id === to.choice.id,
    );
    if (!chosen) return;
    rememberStationName(to.choice.name, to.choice.nameEn);
    if (applyBetween({ line, direction: chosen }))
      dispatch({ type: "choosePosition", line, direction: chosen.key });
  }

  // 駅と駅の間の既定値を置く。次の駅を出発の駅にする
  function applyBetween({ line, direction: chosen }: SegmentTravel): boolean {
    const defaults = buildDefaultBetweenPosition(line, chosen);
    const next = chosen.stops[0];
    if (!defaults || !next) return false;
    setNearStop(null);
    setBetweenFromPattern(defaults.trainsAheadFromPattern);
    setOriginLine(line);
    setTrainPosition(defaults.position, {
      edited: { nextStation: false, ownTrainType: false, trainsAhead: false },
      trainsAheadFromPattern: defaults.trainsAheadFromPattern,
    });
    setOrigin({ kind: "station", name: next.choice.name });
    return true;
  }

  function handleBack() {
    goToDepth(depth - 1);
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
      entryState: entry,
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
  // 現在地から読み取った駅の間では、乗っている路線の両側の駅を候補にする
  const suggestedDirections = !data
    ? []
    : onTrain && entry.segment
      ? stepDirections
      : entry.place
        ? entry.place.lines.flatMap((line) => listEntryDirections(data, line))
        : [];
  const candidates = direction
    ? listDirectionCandidates(direction)
    : mergeDirectionCandidates(suggestedDirections);
  const routeCandidates =
    data && entry.place && destinationChoice
      ? inferEntryRoutes(data, entry.place, destinationChoice)
      : [];
  const routePlace =
    entry.place && routeCandidates.length && !entry.routeEditing
      ? {
          ...entry.place,
          lines: entry.place.lines.filter((line) =>
            routeCandidates.some((c) => c.line.key === line.key),
          ),
        }
      : entry.place;
  const trainLines = useMemo(() => (data ? listTrainLines(data) : []), [data]);
  const trainStops =
    direction && data && entry.line ? listTrainPositionStops(data, entry.line, direction) : [];
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
    [...directions, ...stepDirections].map((d) => [
      d.key,
      placePosition ? computeDirectionAngle(placePosition, d) : 0,
    ]),
  );
  const progressIndex = selectProgressIndex(entry.stage, entry.location);
  const tripLine =
    entry.line && destination ? (
      <TripLine
        originName={lineOriginName}
        destinationName={destinationLabel}
        line={entry.line}
        onEditDestination={() => goToDepth(getDepth("destination"))}
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
  // 種類まで答えたらその種類、そうでなければ大分類の呼び名
  function nameCause(cause: CauseAnswer): string {
    if (cause.kind && cause.kind !== "other") return t(`entry.causeKinds.${cause.kind}`);
    return t(`entry.causes.${cause.category ?? "unknown"}`);
  }
  const answered: AnsweredItem[] = [
    ...(entry.cause
      ? [
          {
            kind: "cause" as const,
            label: nameCause(entry.cause),
            onEdit: () => goToDepth(getDepth("cause")),
          },
        ]
      : []),
    ...(entry.elapsed
      ? [
          {
            kind: "elapsed" as const,
            label: t(`entry.elapsed.${entry.elapsed}`),
            onEdit: () => goToDepth(getDepth("elapsed")),
          },
        ]
      : []),
  ];

  // 3 問目の答えで判断を始める。原因が分からないか、大分類に知見が無ければ事象の無い観測で判断する
  function submitAnswers(answer: ResumeAnswer) {
    const eventType = resolveCauseEventType(entry.cause, catalog);
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
    if (!placePosition) return [];
    const from = placePosition;
    const color = entry.line?.color ?? entry.place?.lines[0]?.color ?? "#626264";
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
      return stepDirections.flatMap((d, i) => {
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
    if (entry.stage === "destination" && !direction) {
      return pickSpreadStops(candidates, from).map((stop) =>
        toStop(`destination-${stop.choice.id}`, stop),
      );
    }
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
    if (entry.stage === "trainPosition" && onTrain) {
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
      const chosen = stepDirections[Number(id)];
      if (chosen) chooseDirection(chosen);
    } else if (kind === "destination") {
      const stop = candidates.find((c) => c.choice.id === id);
      if (stop) chooseDestination(stop.choice);
    } else if (kind === "near") {
      const stop = nearby.find((c) => c.choice.id === id);
      if (stop) chooseNearStop(stop);
    }
  }

  return (
    <div data-testid={testIds.start.screen} data-stage={entry.stage} className="h-dvh">
      <EntryMap
        geo={geo}
        stations={mapStations}
        // 最初の段も関西の地図として描き、エリアと駅を押せるようにする
        stage={entry.stage === "position" ? "kansai" : entry.stage}
        hubs={hubs}
        area={entry.area}
        place={mapPlace}
        lineId={entry.line?.lineId ?? null}
        destination={destinationMarker}
        stops={mapStops}
        focus={entry.stage === "trainPosition" ? trainStops.map((s) => s.position) : []}
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
          if (
            place.key === entry.place?.key &&
            entry.stage !== "area" &&
            entry.stage !== "kansai"
          ) {
            const here = nearby.find((s) => s.choice.id === entry.line?.stationName);
            if (entry.stage === "trainPosition" && onTrain && here) chooseNearStop(here);
            return;
          }
          const area = data ? findAreaAt(data, place.position) : null;
          if (area) selectPlace(area, place);
        }}
        onTap={handleTap}
      />
      <AppHeader
        variant="map"
        // 関西の段はシートが無いので、帯のロゴの場所にいまどこの問いへ戻る札を置く
        leading={
          entry.stage === "kansai" ? (
            <button
              type="button"
              data-testid={testIds.start.back}
              onClick={handleBack}
              className="pointer-events-auto inline-flex min-h-11 shrink-0 items-center gap-0.5 rounded-full pr-3 pl-1 text-[14px] font-medium text-muted transition-colors hover:bg-foreground/5 hover:text-foreground active:scale-[0.97]"
            >
              <ChevronLeft className="size-5" strokeWidth={2} aria-hidden />
              {t("entry.back")}
            </button>
          ) : undefined
        }
        below={
          entry.stage === "kansai" ? (
            <>
              <div ref={promptRef} className="flex flex-col gap-2">
                <div
                  data-testid={testIds.start.intro}
                  className="glass-strong rounded-[20px] px-4 py-3 text-[14px] leading-snug"
                >
                  <p data-testid={testIds.start.introAudience}>{t("start.introAudience")}</p>
                  <p data-testid={testIds.start.introProblem} className="mt-1 text-muted">
                    {t("start.introProblem")}
                  </p>
                  <p data-testid={testIds.start.introSolution} className="mt-1 font-semibold">
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
                onSelect={(place) => entry.area && selectPlace(entry.area, place)}
              />
            )}
            {entry.stage === "position" && (
              <LocationStep
                onSelect={(location) => dispatch({ type: "chooseLocation", location })}
                gps={{
                  status: gps.status,
                  choices: gpsChoices,
                  onLocate: gps.locate,
                  onConfirm: confirmGpsChoice,
                  onDismiss: gps.reset,
                }}
              >
                <LocationSearch onSelect={openPlace} />
              </LocationStep>
            )}
            {entry.stage === "station" && onTrain && (
              <TrainLineStep lines={trainLines} onSelect={chooseLine} />
            )}
            {entry.stage === "station" && !onTrain && routePlace && (
              <StationStep place={routePlace} note={note} onSelect={chooseLine} />
            )}
            {entry.stage === "direction" && entry.line && (
              <DirectionStep
                originName={lineStationName}
                line={entry.line}
                directions={stepDirections}
                angles={angles}
                onSelect={chooseDirection}
              />
            )}
            {entry.stage === "destination" && (
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
            {entry.stage === "trainPosition" && direction && (
              <TrainPositionStep
                key={direction.key}
                stops={trainStops}
                initialIndex={Math.max(
                  0,
                  trainStops.findIndex((stop) => stop.choice.name === entry.line?.stationName),
                )}
                onBetween={chooseBetween}
                onNearStop={chooseNearStop}
              />
            )}
            {entry.stage === "cause" && entry.line && direction && (
              <button
                type="button"
                className="min-h-12 truncate text-left text-sm font-semibold"
                data-testid={testIds.start.routeSummary}
                onClick={() => dispatch({ type: "editRoute" })}
              >
                {t("entry.routeInferred", {
                  line: locale === "en" ? entry.line.name.en : entry.line.name.ja,
                  direction: nameDirection(direction),
                })}
              </button>
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
                onEditLine={() => dispatch({ type: "editRoute" })}
                onEditDestination={() => goToDepth(getDepth("destination"))}
              />
            )}
            {entry.stage === "cause" && (
              <CauseStep
                onSelect={(category) =>
                  dispatch({ type: "chooseCause", cause: { category, kind: null } })
                }
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
            {entry.stage === "causeKind" && entry.cause?.category && (
              <CauseKindStep
                trip={tripLine}
                answers={answered}
                category={entry.cause.category}
                onSelect={(kind) => dispatch({ type: "chooseCauseKind", kind })}
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
