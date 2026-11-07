"use client";

import { computeDistanceMeters, createRouter } from "@repo/geo";
import type { IncidentCause, RawInput } from "@repo/schema";
import { ChevronLeft } from "lucide-react";
import type { PrefetchKind } from "next/dist/client/components/router-reducer/router-reducer-types";
import { useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from "react";
import { AppHeader } from "@/components/AppHeader";
import { sheetTopInset } from "@/components/MapSheet";
import {
  findGroupDirection,
  groupDirectionCandidates,
  groupLineStops,
} from "@/features/entry/direction-groups";
import {
  type DirectionStop,
  type EntryDirection,
  isLoopAt,
  listDirectionCandidates,
  listEntryDirections,
  listNearbyStops,
  listTrainPositionStops,
  mergeDirectionCandidates,
  pickSpreadStops,
} from "@/features/entry/directions";
import {
  BetweenStep,
  LocationStep,
  MapPickStep,
  TrainLineStep,
  TrainPositionStep,
} from "@/features/entry/EntryLocationSteps";
import {
  EntryMap,
  type EntryMapApi,
  type LineFocus,
  type MapSegment,
  type MapStop,
} from "@/features/entry/EntryMap";
import { DemoDock, LocationSearch, PromptCard, StartIntro } from "@/features/entry/EntryOverlays";
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
  ProtectionStep,
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
  pickLocalized,
  pickPlaceName,
  resolveConfiguredArea,
} from "@/features/entry/entry-places";
import {
  betweenPickStages,
  type EntryStage,
  initialEntryState,
  reduceEntry,
  selectProgressIndex,
  stageDepth,
} from "@/features/entry/flow";
import {
  type GpsChoice,
  inferSegmentTravel,
  listGpsChoices,
  listLineTapChoices,
  listSegmentTravels,
  listStationPairChoices,
  resolveSegmentTravel,
  type SegmentTravel,
} from "@/features/entry/gps-candidates";
import { inferEntryRoutes, listTrainLines } from "@/features/entry/infer-route";
import {
  buildSectionGlow,
  buildSegmentPath,
  computeMidpoint,
  computePathMidpoint,
  findNearestSegment,
  isOnRoute,
  listLinePicks,
  listLineStops,
  listRouteStops,
  listSegmentWindow,
  mergeRouteCandidates,
  pickLineAt,
  pickLineTap,
  placeDirectionTag,
  selectAwaySide,
  selectRailTapOutcome,
  selectStopDirection,
} from "@/features/entry/map-pick";
import { buildRouteGlow, planEntrySpans } from "@/features/entry/route-glow";
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
import { type MapInsets, preloadMapLibre } from "@/features/map/MapPanel";
import { findFocusArea } from "@/features/map/station-guide";
import {
  type CauseAnswer,
  isAskedKind,
  resolveCauseIncidentType,
  resolveIncidentCause,
  toCauseChoiceId,
} from "@/features/situation/cause-categories";
import { findElapsedOption, listResumeTimeOptions } from "@/features/situation/plain-questions";
import {
  buildProtectionObservations,
  resolveProtectionBroadcast,
} from "@/features/situation/protection-broadcast";
import { type TicketAnswer, toTicketAnswer, toTicketType } from "@/features/situation/ticket";
import {
  findNearestChoices,
  type NearestStationChoice,
  type StationChoice,
} from "@/features/stations/catalog";
import { describePlace, pickStationName } from "@/features/stations/describe";
import { useCurrentLocation } from "@/features/stations/use-current-location";
import { desktopMediaQuery, useMediaQuery } from "@/lib/use-media-query";
import { computeHeaderShift, useSafeArea } from "@/lib/use-safe-area";

// 判断の画面が最初に寄せる大阪駅のまわりの拡大率に近い値
const handoffZoom = 15.8;
// PC 幅の右パネルの幅と余白
const panelInset = 400 + 32;
// PC 幅の関西の段で、左に重ねる列（上部の帯・問いかけ・デモの札）の幅と余白
const leftColumnInset = 560 + 32;
// 路線の札と一緒に地図へ出す行き先の札の範囲（m）。路線の札が読める寄せ方に保つ
const lineViewMeters = 4000;
// 路線を押した点から通称を決めるときに見る、方面の先の駅の数
const linePathStops = 4;
// 路線の札から、行き先の札を出さない範囲（m）
const lineGapMeters = 700;
// 路線の駅を両方向とも出す段で、駅を収める余白（px）
const lineStopMargin = { x: 72, y: 36 };

// 高さを測って地図の余白に使う
const introDismissedKey = "michiakari:intro-dismissed";

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

// 東西に並ぶ札は上に、南北に並ぶ札は右に出す。方面の札は文字が長いので、向きに合わせて上か下に出す
function sideOfLabel(from: Position, position: Position, long = false): MapStop["side"] {
  const dx = (position[0] - from[0]) * Math.cos((from[1] * Math.PI) / 180);
  const dy = position[1] - from[1];
  if (long) return dy < 0 && Math.abs(dy) > Math.abs(dx) ? "bottom" : "top";
  return Math.abs(dx) > Math.abs(dy) ? "top" : "right";
}

function useEntryData(): { geo: MapGeoData | null; data: EntryData | null } {
  const [geo, setGeo] = useState<MapGeoData | null>(null);
  useEffect(() => {
    let cancelled = false;
    preloadMapLibre();
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
// 様子を聞く段。地図で選ぶものが無いので、スマートフォンでは地図を出さない
const situationStages = new Set<EntryStage>([
  "cause",
  "causeKind",
  "protection",
  "elapsed",
  "resume",
  "input",
]);

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
    state: judgment,
    startJudgment,
    ticketType,
  } = session;
  const { geo, data } = useEntryData();
  const [nearest, setNearest] = useState<NearestStationChoice[]>([]);
  const mapStations = useMemo(() => (data ? listMapStations(data) : []), [data]);
  const hubs = useMemo(() => (data ? listEntryHubs(data) : []), [data]);
  const [entry, dispatch] = useReducer(reduceEntry, initialEntryState);
  // 様子を聞く段に入ったら判断の画面を JS まで先に読み、答えた後の切り替えを待たせない
  // PrefetchKind は公開されていないので、Link の prefetch={true} と同じ "full" を型だけ借りて渡す
  const askingSituation = situationStages.has(entry.stage);
  useEffect(() => {
    if (askingSituation) router.prefetch("/judgment", { kind: "full" as PrefetchKind });
  }, [askingSituation, router]);
  const [note, setNote] = useState<string | null>(null);
  const [handingOff, setHandingOff] = useState(false);
  const mapApi = useRef<EntryMapApi | null>(null);
  const desktop = useMediaQuery(desktopMediaQuery);
  const headerShift = computeHeaderShift(useSafeArea());
  const narrow = useMediaQuery("(max-width: 639px)");
  const [promptRef, promptHeight] = useElementHeight<HTMLDivElement>();
  const [dockRef, dockHeight] = useElementHeight<HTMLDivElement>();
  const [sheetHeight, setSheetHeight] = useState(0);
  // 価値の 3 行。閉じたらこの端末では次から出さない。読み込むまでは出さない
  const [introOpen, setIntroOpen] = useState(false);
  useEffect(() => {
    setIntroOpen(window.localStorage.getItem(introDismissedKey) !== "1");
  }, []);
  const closeIntro = useCallback(() => {
    window.localStorage.setItem(introDismissedKey, "1");
    setIntroOpen(false);
  }, []);
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
  // 再開見込みの問いの上で聞く乗車券の種類。入口に戻ったときは前の答えから始める
  const [ticket, setTicket] = useState<TicketAnswer>(() => toTicketAnswer(ticketType));
  // 車内の駅の間の段で選んでいる駅の間。地図の点線と一覧の選択が同じものを指す
  const [segmentIndex, setSegmentIndex] = useState<number | null>(null);
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
  // 駅にいる人が先に路線を選んだ方面の段。路線の駅を両方向とも地図に出し、押せば行き先にする
  const lineStopMode =
    entry.stage === "direction" &&
    entry.routeFirst &&
    entry.location === "station" &&
    !entry.segment &&
    entry.line !== null;
  const routeLineStops = useMemo(
    () => (lineStopMode ? listLineStops(directions) : []),
    [lineStopMode, directions],
  );
  // 路線の駅を方面ごとにまとめる。上りと下りの駅を混ぜずに見せる
  const lineStopGroups = useMemo(
    () => (lineStopMode ? groupLineStops(directions) : []),
    [lineStopMode, directions],
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
    if (["position", "between", "kansai", "area"].includes(entry.stage)) {
      setOrigin(null);
      setOriginLine(null);
      setTrainPosition(null);
      setNearStop(null);
    }
  }, [entry.stage, restored, setOrigin, setOriginLine, setTrainPosition]);

  // 共有の路線を、いま答えている路線とそろえる。戻ったあとに別の路線で進んでも、判断は画面と同じ路線を見る
  useEffect(() => {
    if (!restored || !entry.line) return;
    if (originLine?.key === entry.line.key && originLine.stationName === entry.line.stationName)
      return;
    setOriginLine(entry.line);
  }, [restored, entry.line, originLine, setOriginLine]);

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

  // 最初の段と駅の間の段で線を押したときの駅の間の候補。現在地の読み取りと同じ部品で確かめる
  const [mapPick, setMapPick] = useState<{ point: Position; choices: GpsChoice[] } | null>(null);
  // 候補の一覧で指を置くかフォーカスしている候補。地図でその区間をいちばん強く光らせる
  const [focusedChoiceKey, setFocusedChoiceKey] = useState<string | null>(null);
  // 確定した駅の間。確定した後も、その駅の間を選んでいる間は光らせたまま残す
  const [pickedSection, setPickedSection] = useState<GpsChoice | null>(null);
  // 前に確定した駅の間の中ほど。駅の間の段へ戻ったら、地図をここへ寄せる
  const [lastBetween, setLastBetween] = useState<Position | null>(null);
  const nearestStation = nearest[0]?.station;
  const betweenFocus: Position | null =
    lastBetween ?? (nearestStation ? [nearestStation.lon, nearestStation.lat] : null);
  // biome-ignore lint/correctness/useExhaustiveDependencies: 段が変わったら候補を閉じる
  useEffect(() => {
    setMapPick(null);
  }, [entry.stage]);
  function locateGps() {
    setMapPick(null);
    gps.locate();
  }
  const positionGps = mapPick
    ? {
        status: {
          kind: "located" as const,
          point: { lon: mapPick.point[0], lat: mapPick.point[1], accuracy: 0 },
        },
        choices: mapPick.choices,
        onLocate: locateGps,
        onConfirm: confirmGpsChoice,
        onDismiss: () => setMapPick(null),
        onFocusChoice: setFocusedChoiceKey,
      }
    : {
        status: gps.status,
        choices: gpsChoices,
        onLocate: locateGps,
        onConfirm: confirmGpsChoice,
        onDismiss: gps.reset,
      };

  function confirmGpsChoice(choice: GpsChoice) {
    if (!data || !betweenPickStages.has(entry.stage)) return;
    if (choice.kind === "station") {
      if (entry.stage !== "position") return;
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
    setPickedSection(choice);
    setLastBetween(
      computeMidpoint([choice.from.lon, choice.from.lat], [choice.to.lon, choice.to.lat]),
    );
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
      ? t("start.locating")
      : locateStatus === "failed"
        ? t("start.locateFailed")
        : locateStatus === "unsupported"
          ? t("start.locateUnsupported")
          : note && entry.stage === "kansai"
            ? note
            : null;

  function handleTap(point: Position, reachMeters: number) {
    if (!data) return;
    if (lineStopMode) {
      // 線の外は、印を出した駅の近くを押したときだけ、その駅を行き先にする
      tapLine(point, reachMeters, false);
      return;
    }
    if (entry.stage === "position" || entry.stage === "kansai") {
      const area = findAreaAt(data, point, reachMeters);
      if (area) dispatch({ type: "openArea", area });
    } else if (entry.stage === "destination" && !onTrain) {
      // 検索や近くの駅から来た人はエリアの段を通っていないので、地図の段へ戻す。無ければ留まる
      const mapDepth = Math.max(getDepth("area"), getDepth("kansai"));
      if (mapDepth >= 0) goToDepth(mapDepth);
    }
  }

  // 地図の駅を押したとき。選んだ駅の丸を押しても、ここまでの答えは捨てない。電車の中なら近い駅の答えにする
  function pickMapPlace(place: EntryPlace) {
    if (place.key === entry.place?.key && entry.stage !== "area" && entry.stage !== "kansai") {
      const here = nearby.find((s) => s.choice.id === entry.line?.stationName);
      if (entry.stage === "trainPosition" && onTrain && here) chooseNearStop(here);
      return;
    }
    const area = data ? findAreaAt(data, place.position) : null;
    if (area) selectPlace(area, place);
  }

  // 最初の段と駅の間の段で線を押したら、その駅の間の車内にいるか確かめる
  // 駅の間が無いとき、札を押していればその駅を選び、そうでなければ、そのあたりへ寄る
  function handleRailTap(
    lineIds: string[],
    point: Position,
    reachMeters: number,
    label: EntryPlace | null,
  ) {
    if (!data || !geo || !betweenPickStages.has(entry.stage)) return;
    const choices = listLineTapChoices(
      data,
      geo.nodes,
      { lon: point[0], lat: point[1] },
      reachMeters,
      lineIds,
      geo.trackShapes,
    );
    const outcome = selectRailTapOutcome(choices.length, label);
    if (outcome.kind === "station") {
      pickMapPlace(outcome.place);
      return;
    }
    if (outcome.kind === "tap") {
      handleTap(point, reachMeters);
      return;
    }
    gps.reset();
    setFocusedChoiceKey(null);
    setMapPick({ point, choices });
    // 価値の 3 行は地図の上を覆うので、地図で線を押したら閉じ、候補の区間を見せる
    if (introOpen) closeIntro();
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

  // 駅にいる人が、行き先の段で先に路線を選ぶ。方面が 1 つなら方面も決めて行き先へ戻る
  function pickRouteLine(line: EntryLine) {
    rememberStationName(line.stationName, line.stationNameEn);
    setOrigin({ kind: "station", name: line.stationName });
    setOriginNearest(null);
    setOriginLine(line);
    const lineDirections = data ? listEntryDirections(data, line) : [];
    dispatch({
      type: "pickRoute",
      line,
      autoDirection: lineDirections.length === 1 ? (lineDirections[0]?.key ?? null) : null,
    });
  }

  // 路線を選んだ直後の地図を押したとき。印を出した駅の近くならその駅を行き先にし、
  // 描いた線の上なら押した点に向かう方面を選ぶ
  function tapLine(point: Position, reachMeters: number, onLine: boolean) {
    if (!data || !entry.place || !entry.line) return;
    const tap = pickLineTap({
      origin: entry.place.position,
      directions,
      stops: routeLineStops,
      loop: isLoopAt(data, entry.line),
      point,
      reachMeters,
      onLine,
    });
    if (tap?.stop) chooseLineStop(tap.stop);
    else if (tap) chooseDirection(tap.direction);
  }

  // 先に選んだ路線の駅を行き先にする。方面は出発の駅からの駅の数が少ない向きにする
  // 方面のまとまりから押したときは、そのまとまりの方面にする。駅の数の少ない向きと同じ方面になる
  function chooseLineStop(stop: DirectionStop, via?: EntryDirection) {
    const chosen = via ?? selectStopDirection(directions, stop.choice.id);
    if (!chosen) return;
    rememberStationName(stop.choice.name, stop.choice.nameEn);
    setDestination({ kind: "station", name: stop.choice.name });
    setDestinationBasis("chosen");
    dispatch({ type: "chooseLineStop", direction: chosen.key });
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

  // via は方面のまとまりから押したときの、そのまとまりの方面
  function chooseDestination(
    target: StationChoice | string,
    basis: TripContext["destinationBasis"] = "chosen",
    via?: EntryDirection,
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
    // 先に選んだ方面の先の駅なら、選んだ路線と方面をそのまま使う
    if (
      !onTrain &&
      entry.routeFirst &&
      entry.line &&
      targetChoice &&
      isOnRoute(direction, targetChoice.id)
    ) {
      dispatch({ type: "chooseDestination", onRoute: true });
      return;
    }
    // 現在地から読み取った駅の間は、行き先から進む向きを決める。決まらなければ方面を聞く
    if (onTrain && entry.segment) {
      if (segmentTravels.length === 0) {
        abandonSegment();
        return;
      }
      // 行き先から向きが決まらないときだけ、押した駅のまとまりの方面を使う
      const travel = targetChoice
        ? (inferSegmentTravel(segmentTravels, targetChoice) ??
          (via ? resolveSegmentTravel(segmentTravels, via) : null))
        : null;
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
  // 車内で受信の放送を聞いたと答えたら、その放送を観測として足す
  async function submit(
    input: RawInput | null,
    answers: {
      elapsedMinutes: number | null;
      causeUnknown: boolean;
      statedResumeTime: string | null;
      cause: IncidentCause | null;
    } | null = null,
  ) {
    if (!entry.line || !direction || origin === null) return;
    const now = new Date();
    const elapsedMinutes = answers?.elapsedMinutes ?? null;
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
    startJudgment(
      input,
      [
        buildLineObservation(entry.line, now, elapsedMinutes, answers?.statedResumeTime ?? null),
        ...buildProtectionObservations(entry.protection, now, elapsedMinutes),
      ],
      answers?.cause ?? null,
      resolveProtectionBroadcast(entry.protection),
      toTicketType(ticket),
    );
    setHandingOff(true);
    if (findFocusArea(origin)) await mapApi.current?.zoomToOrigin(handoffZoom);
    router.push("/judgment");
  }

  // 関西の段はシートを出さない。線を押して駅の間の候補が出たときだけ、候補のシートを出す
  const showSheet = entry.stage !== "kansai" || mapPick !== null;
  // 関西の段の上部の問いと戻る札。候補のシートを出している間は、地図を見せるため隠す
  const kansaiPrompt = entry.stage === "kansai" && mapPick === null;
  const introShownOnSheet = entry.stage === "position" && introOpen;
  // 端末の上の余白で帯が下がるぶん、地図の上の余白も広げる
  const mapTop = sheetTopInset + headerShift;
  const insets: MapInsets = desktop
    ? {
        top: mapTop,
        right: showSheet ? panelInset : 0,
        bottom: 0,
        left: showSheet ? 0 : leftColumnInset,
      }
    : {
        top: !showSheet || introShownOnSheet ? mapTop + promptHeight + 8 : mapTop,
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
  // 先に方面を選んだ人には、地図に出した方面の先の駅を先に並べる
  const routeStops = direction && entry.routeFirst && !onTrain ? listRouteStops(direction) : [];
  const candidates = direction
    ? mergeRouteCandidates(routeStops, listDirectionCandidates(direction))
    : mergeDirectionCandidates(suggestedDirections);
  // 駅の間にいて方面がまだ無い人には、行き先の候補を方面ごとにまとめて出す
  const destinationGroups =
    entry.stage === "destination" && onTrain && entry.segment && !direction
      ? groupDirectionCandidates(stepDirections)
      : [];
  // 地図の駅の札に、その駅のまとまりの方面の向きを添える
  const shownGroups = lineStopMode ? lineStopGroups : destinationGroups;
  const headingOf = (stationId: string) => {
    const owner = findGroupDirection(shownGroups, stationId);
    return owner ? (angles[owner.key] ?? 0) : undefined;
  };
  const routeFinder = useMemo(() => (geo ? createRouter(geo.network) : null), [geo]);
  // 行き先を選んだら、今いる所から行き先までを乗る区間ごとに光らせる
  const routeGlow = useMemo(() => {
    if (!data || !askingSituation || !entry.line || !destinationChoice)
      return buildRouteGlow([], undefined, new Map());
    const { spans, onDirection } = planEntrySpans({
      data,
      router: routeFinder,
      line: entry.line,
      direction,
      loopDirections: isLoopAt(data, entry.line) ? directions : [],
      destination: destinationChoice,
      departureTime: new Date().toISOString(),
    });
    return buildRouteGlow(
      spans,
      geo?.trackShapes,
      geo?.lineColors ?? new Map(),
      between && onDirection,
    );
  }, [
    data,
    geo,
    routeFinder,
    askingSituation,
    entry.line,
    direction,
    directions,
    destinationChoice,
    between,
  ]);
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
  const trainStops = useMemo(
    () =>
      direction && data && entry.line ? listTrainPositionStops(data, entry.line, direction) : [],
    [data, entry.line, direction],
  );
  const initialSegmentIndex = Math.max(
    0,
    trainStops.findIndex((stop) => stop.choice.name === entry.line?.stationName),
  );
  const currentSegmentIndex = segmentIndex ?? initialSegmentIndex;
  // 駅の間の段に入るか方面が変わったら、選んでいる駅の間を選んだ駅の先に戻す
  // biome-ignore lint/correctness/useExhaustiveDependencies: 段と方面が変わったときだけ戻す
  useEffect(() => {
    setSegmentIndex(null);
  }, [entry.stage, direction?.key]);
  const segmentPicks = useMemo(
    () =>
      entry.stage === "trainPosition" ? listSegmentWindow(trainStops, currentSegmentIndex) : [],
    [entry.stage, trainStops, currentSegmentIndex],
  );
  const lineColor = entry.line?.color ?? "#626264";
  // 駅の間の点線と丸は、地図で路線を描く線路の形に沿わせる
  const segmentTrack = entry.line ? geo?.trackShapes?.get(entry.line.lineId) : undefined;
  const mapSegments = useMemo<MapSegment[]>(
    () =>
      segmentPicks.map((s) => {
        const path = buildSegmentPath(segmentTrack, s.from.position, s.to.position);
        return {
          key: `${s.from.choice.id}~${s.to.choice.id}`,
          label: t("entry.segmentLabel", {
            from: pickStationName(s.from.choice, locale),
            to: pickStationName(s.to.choice, locale),
          }),
          position: computePathMidpoint(path) ?? computeMidpoint(s.from.position, s.to.position),
          path,
          color: lineColor,
          selected: s.index === currentSegmentIndex,
        };
      }),
    [segmentPicks, segmentTrack, currentSegmentIndex, lineColor, locale, t],
  );
  // 線を押して出した候補を光らせる。確定した駅の間は、その駅の間を選んでいる間だけ光らせたまま残す
  // 戻る操作で駅の間を選ぶ前の段へ戻ると、entry.segment が消えるので光りも消える
  const keptSection =
    pickedSection?.kind === "between" &&
    entry.segment?.from === pickedSection.from.name &&
    entry.segment.to === pickedSection.to.name
      ? pickedSection
      : null;
  // 行き先までの線路を光らせている間は、駅の間の光りをその光に任せる
  const routeShown = routeGlow.features.length > 0;
  const sectionGlow = useMemo(
    () =>
      buildSectionGlow(
        mapPick?.choices ?? (keptSection && !routeShown ? [keptSection] : []),
        focusedChoiceKey,
        geo?.trackShapes,
      ),
    [mapPick, keptSection, routeShown, focusedChoiceKey, geo],
  );
  // 地図の札で選べる路線。行き先の段では駅の全部の路線、路線の段では一覧と同じ路線
  const pickLines =
    !onTrain && entry.place && !entry.line
      ? entry.stage === "destination"
        ? entry.place.lines
        : entry.stage === "station"
          ? (routePlace?.lines ?? [])
          : []
      : [];
  const linePicks =
    data && entry.place && pickLines.length
      ? listLinePicks(pickLines, entry.place.position, (line) => listEntryDirections(data, line))
      : [];
  const lineFocusKey =
    entry.stage === "station" && onTrain
      ? "all"
      : entry.line
        ? `only:${entry.line.lineId}`
        : pickLines.length
          ? `focus:${[...new Set(pickLines.map((l) => l.lineId))].join(",")}`
          : "";
  const lineFocus = useMemo<LineFocus | null>(() => {
    if (!lineFocusKey) return null;
    if (lineFocusKey === "all") return { lineIds: [], mode: "all" };
    const [mode, ids = ""] = lineFocusKey.split(":") as ["focus" | "only", string];
    return { lineIds: ids.split(","), mode };
  }, [lineFocusKey]);
  const linePickable =
    lineStopMode ||
    pickLines.length > 0 ||
    (entry.stage === "station" && onTrain) ||
    entry.stage === "trainPosition";
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
  const progressIndex = selectProgressIndex(entry.stage, entry.location, entry.routeFirst);
  const tripLine =
    entry.line && destination ? (
      <TripLine
        originName={lineOriginName}
        destinationName={destinationLabel}
        line={entry.line}
        onEditDestination={() => goToDepth(getDepth("destination"))}
      />
    ) : null;
  // 方面は出発の行に出すので、行き先の行では繰り返さない
  const destinationNote =
    destinationBasis === "hub"
      ? t("entry.tripHub")
      : destinationBasis === "terminal"
        ? t("entry.tripTerminal")
        : null;

  // ここまでに答えた原因と時間のチップ。押すとその問いまで引いて選び直す
  // 種類まで答えたらその種類、そうでなければ大分類の呼び名
  function nameCause(cause: CauseAnswer): string {
    if (isAskedKind(cause.kind) && cause.kind !== "other")
      return t(`entry.causeKinds.${cause.kind}`);
    return t(`entry.causes.${toCauseChoiceId(cause) ?? "unknown"}`);
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

  // 3 問目の答えで判断を始める。原因が分からないか、種類が決まらなければ事象の無い観測で判断する
  function submitAnswers(answer: ResumeAnswer) {
    const eventType = resolveCauseIncidentType(entry.cause);
    const elapsed = entry.elapsed ? findElapsedOption(entry.elapsed) : null;
    setPendingResume(answer.time?.id ?? answer.id);
    void submit(eventType ? { type: "selection", eventType, signalIds: [] } : null, {
      elapsedMinutes: elapsed?.minutes ?? null,
      causeUnknown: eventType === null,
      statedResumeTime: answer.time?.iso ?? null,
      cause: resolveIncidentCause(entry.cause),
    });
  }

  // シートの答えと同じものを、地図の札にも置く
  function buildMapStops(): MapStop[] {
    if (!placePosition) return [];
    const lineStops: MapStop[] = linePicks.map(({ line, position }) => ({
      key: `line-${line.key}`,
      position,
      label: pickLocalized(line.name, locale),
      color: line.color,
      angle: null,
      side: sideOfLabel(placePosition, position),
      kind: "line",
    }));
    const from = placePosition;
    const color = entry.line?.color ?? entry.place?.lines[0]?.color ?? "#626264";
    const sideOf = (position: Position, long = false) => sideOfLabel(from, position, long);
    const toStop = (key: string, stop: DirectionStop): MapStop => ({
      key,
      position: stop.position,
      label: pickStationName(stop.choice, locale),
      color,
      angle: null,
      side: sideOf(stop.position),
    });
    if (entry.stage === "direction") {
      // 路線の駅を出すときは、方面の札を出した駅の先に置き、駅の印と重ねない
      const tags = stepDirections.flatMap((d, i) => {
        const stop = d.stops[Math.min(2, d.stops.length - 1)];
        const position = lineStopMode ? placeDirectionTag(from, d) : stop?.position;
        if (!stop || !position) return [];
        return [
          {
            ...toStop(`direction-${i}`, stop),
            position,
            label: nameDirection(d),
            angle: angles[d.key] ?? 0,
            side: sideOf(position, true),
          },
        ];
      });
      return [
        ...tags,
        ...routeLineStops.map((stop) => ({
          ...toStop(`pick-${stop.choice.id}`, stop),
          heading: headingOf(stop.choice.id),
          keep: true,
        })),
      ];
    }
    // 路線の段は、駅の路線の札だけを出す
    if (entry.stage === "station" && !onTrain) return lineStops;
    // 札が重ならないよう、離れた主な駅だけを地図に出す。シートには全部の候補を出す
    // 方面の呼び名に出した駅を先に置き、方面の向きが地図でも分かるようにする
    // 駅にいる人には路線の札を先に置き、路線の札が読める範囲の行き先だけを添える
    if (entry.stage === "destination" && !direction) {
      // 路線の札のすぐ近くの駅は、札がぶつかるので地図には出さない
      const nearCandidates = lineStops.length
        ? candidates.filter(
            (c) =>
              computeDistanceMeters(from, c.position) <= lineViewMeters &&
              linePicks.every((p) => computeDistanceMeters(p.position, c.position) > lineGapMeters),
          )
        : candidates;
      return [
        ...lineStops,
        ...pickSpreadStops(nearCandidates, from).map((stop) => ({
          ...toStop(`destination-${stop.choice.id}`, stop),
          heading: headingOf(stop.choice.id),
        })),
      ];
    }
    // 先に方面を選んだ人には、方面の先の駅を近い順に名前付きで出す
    if (entry.stage === "destination" && direction && routeStops.length) {
      return routeStops.map((stop) => toStop(`destination-${stop.choice.id}`, stop));
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
  // 選んだ駅の名前の札は、路線や方面の先の駅の札と反対の側に置く
  const placeSide =
    placePosition && (linePicks.length || routeStops.length)
      ? selectAwaySide(placePosition, [
          ...linePicks.map((p) => p.position),
          ...routeStops.map((s) => s.position),
        ])
      : null;

  // 地図の線を押したとき。押した点に近い通称の路線か、駅の間を選ぶ
  function selectMapLine(
    lineId: string,
    point: Position,
    reachMeters: number,
    tapReachMeters: number,
  ) {
    if (!data) return;
    // 路線を選んだ直後は、描いた線を押したことを手がかりに方面か行き先を決める
    if (lineStopMode) {
      if (lineId === entry.line?.lineId) tapLine(point, tapReachMeters, true);
      return;
    }
    if (entry.stage === "trainPosition") {
      // 出ている駅の間から押せる範囲の外なら、同じ路線の線でも決めない
      const segment =
        lineId === entry.line?.lineId ? findNearestSegment(segmentPicks, point, reachMeters) : null;
      if (segment) chooseBetween(segment.from, segment.to);
      return;
    }
    const pool = entry.stage === "station" && onTrain ? trainLines : pickLines;
    const options = pool
      .filter((line) => line.lineId === lineId)
      .map((line) => {
        const stops = listEntryDirections(data, line)[0]?.stops ?? [];
        const here = findStationChoice(data, line.stationName);
        const path = (onTrain ? stops : stops.slice(0, linePathStops)).map((s) => s.position);
        return { line, path: here ? [[here.lon, here.lat] as Position, ...path] : path };
      });
    const line = pickLineAt(options, point);
    if (!line) return;
    if (entry.stage === "destination") pickRouteLine(line);
    else if (entry.stage === "station") chooseLine(line);
  }

  function selectMapSegment(key: string) {
    const segment = segmentPicks.find((s) => `${s.from.choice.id}~${s.to.choice.id}` === key);
    if (segment) chooseBetween(segment.from, segment.to);
  }

  function selectMapStop(key: string) {
    const [kind, ...rest] = key.split("-");
    const id = rest.join("-");
    if (kind === "line") {
      const line = pickLines.find((l) => l.key === id);
      if (line && entry.stage === "destination") pickRouteLine(line);
      else if (line) chooseLine(line);
    } else if (kind === "direction") {
      const chosen = stepDirections[Number(id)];
      if (chosen) chooseDirection(chosen);
    } else if (kind === "pick") {
      const stop = routeLineStops.find((c) => c.choice.id === id);
      if (stop) chooseLineStop(stop, findGroupDirection(lineStopGroups, id) ?? undefined);
    } else if (kind === "destination") {
      const stop = candidates.find((c) => c.choice.id === id);
      const via = findGroupDirection(destinationGroups, id) ?? undefined;
      if (stop) chooseDestination(stop.choice, "chosen", via);
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
        betweenFocus={betweenFocus}
        hubs={hubs}
        area={entry.area}
        place={mapPlace}
        lineFocus={lineFocus}
        linePickable={linePickable}
        onSelectLine={selectMapLine}
        segments={mapSegments}
        sections={sectionGlow}
        tapPoint={mapPick?.point ?? null}
        onSelectSegment={selectMapSegment}
        placeSide={placeSide}
        destination={destinationMarker}
        route={routeGlow}
        stops={mapStops}
        focus={
          entry.stage === "trainPosition"
            ? segmentPicks.flatMap((s) => [s.from.position, s.to.position])
            : []
        }
        onSelectStop={selectMapStop}
        // 路線の駅を両方向とも出す段は、名前を隠せるので余白を狭くして大きく寄せる
        stopMargin={lineStopMode ? lineStopMargin : undefined}
        insets={insets}
        narrow={narrow}
        apiRef={mapApi}
        onSelectHub={(areaId) => {
          const area = data ? resolveConfiguredArea(data, areaId) : null;
          if (area) dispatch({ type: "openArea", area });
        }}
        onSelectPlace={pickMapPlace}
        // 駅の段と駅の間の段は駅を答えにしないので、駅の印や札の上も線として押させる
        placePickable={entry.stage !== "station" && entry.stage !== "between"}
        onTap={handleTap}
        onSelectRails={betweenPickStages.has(entry.stage) ? handleRailTap : undefined}
      />
      <AppHeader
        variant="map"
        // 関西の段はシートが無いので、帯のロゴの場所にいまどこの問いへ戻る札を置く
        leading={
          kansaiPrompt ? (
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
          kansaiPrompt ? (
            <>
              <div ref={promptRef} className="flex flex-col gap-2">
                {introOpen && <StartIntro onClose={closeIntro} />}
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
          ) : entry.stage === "position" && introOpen ? (
            <div ref={promptRef}>
              <StartIntro onClose={closeIntro} />
            </div>
          ) : undefined
        }
      />
      <main id="main">
        {kansaiPrompt && !desktop && <DemoDock ref={dockRef} />}
        {showSheet && (
          <EntrySheet
            stageKey={`${entry.stage}:${entry.area?.id}:${entry.place?.key}:${onTrain}`}
            // 関西の段の候補のシートは、戻ると候補を閉じて関西の地図に戻る
            onBack={entry.stage === "kansai" ? () => setMapPick(null) : handleBack}
            onHeightChange={setSheetHeight}
            compact={
              linePickable ||
              entry.stage === "direction" ||
              entry.stage === "between" ||
              routeStops.length > 0
            }
            // 様子を聞く段は地図を使わないので、地図を覆って選択肢を詰めて並べる
            fill={situationStages.has(entry.stage)}
            progress={progressIndex >= 0 ? <EntryProgress index={progressIndex} /> : null}
          >
            {(entry.stage === "kansai" || entry.stage === "area") && mapPick && (
              <MapPickStep
                choices={mapPick.choices}
                onConfirm={confirmGpsChoice}
                onDismiss={() => setMapPick(null)}
                onFocusChoice={setFocusedChoiceKey}
              />
            )}
            {entry.stage === "area" && entry.area && (
              <AreaStep
                area={entry.area}
                onSelect={(place) => entry.area && selectPlace(entry.area, place)}
              />
            )}
            {entry.stage === "position" && (
              <LocationStep
                onSelect={(location) => dispatch({ type: "chooseLocation", location })}
                gps={positionGps}
              >
                <LocationSearch onSelect={openPlace} />
              </LocationStep>
            )}
            {entry.stage === "between" && (
              <BetweenStep
                mapChoices={mapPick?.choices ?? null}
                onDismissMap={() => setMapPick(null)}
                listPairChoices={(first, second) =>
                  data && geo ? listStationPairChoices(data, geo.nodes, first, second) : []
                }
                onSearch={() => setMapPick(null)}
                onConfirm={confirmGpsChoice}
                onFocusChoice={setFocusedChoiceKey}
              />
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
                groups={lineStopGroups}
                onSelect={chooseDirection}
                onSelectStop={chooseLineStop}
              />
            )}
            {entry.stage === "destination" && (
              <DestinationStep
                originName={lineStationName}
                line={entry.line}
                direction={direction}
                candidates={candidates}
                groups={destinationGroups}
                angles={angles}
                routeLines={pickLines}
                allowUndecided={onTrain}
                onSelect={(station) => chooseDestination(station)}
                onSelectGroupStop={(stop, via) => chooseDestination(stop.choice, "chosen", via)}
                onSelectLine={pickRouteLine}
                onUndecided={chooseUndecided}
                onFreeText={(text) => chooseDestination(text)}
              />
            )}
            {entry.stage === "trainPosition" && direction && (
              <TrainPositionStep
                stops={trainStops}
                index={currentSegmentIndex}
                onIndexChange={setSegmentIndex}
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
                routeDirection={direction ? nameDirection(direction) : null}
                destinationName={destinationLabel}
                destinationNote={destinationNote}
                line={entry.line}
                onEditLine={() => dispatch({ type: "editRoute" })}
                onEditDestination={() => goToDepth(getDepth("destination"))}
              />
            )}
            {entry.stage === "cause" && (
              <CauseStep
                onSelect={(cause) => dispatch({ type: "chooseCause", cause })}
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
            {entry.stage === "protection" && entry.cause && (
              <ProtectionStep
                trip={tripLine}
                answers={answered}
                onSelect={(protection) => dispatch({ type: "chooseProtection", protection })}
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
                ticket={ticket}
                onTicket={setTicket}
                onSelect={submitAnswers}
              />
            )}
          </EntrySheet>
        )}
      </main>
    </div>
  );
}
