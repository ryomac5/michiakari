"use client";

import type {
  IncidentCause,
  Observation,
  Place,
  ProtectionBroadcast,
  RawInput,
  TicketType,
  TrainPosition,
} from "@repo/schema";
import { useLocale } from "next-intl";
import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { EntryState } from "@/features/entry/flow";
import {
  type AddedAnswers,
  applyAddedAnswers,
  buildCauseInput,
  emptyAddedAnswers,
  resolveAnswerRequestValues,
} from "@/features/situation/added-answers";
import { type CauseAnswer, resolveCauseIncidentType } from "@/features/situation/cause-categories";
import { findElapsedOption } from "@/features/situation/plain-questions";
import { applyTrainMovement } from "@/features/situation/train-movement";
import type { NearestStationLabel, StationNames } from "@/features/stations/describe";
import { JudgmentChangeContext } from "./components/JudgmentChangeCard";
import { buildJudgmentChange, selectChangeEvidence } from "./judgment-change";
import { isMockRequested, streamMockJudgment } from "./mock";
import { buildJudgeRequest } from "./request";
import {
  createJudgmentState,
  type JudgmentState,
  mergeObservations,
  reduceJudgmentState,
  startJudgmentRun,
} from "./state";
import { type JudgmentStream, streamJudgment } from "./stream";

// 画面間で共有する利用者の入力と判断の状態。サーバーには保存しない

type JudgmentSession = {
  origin: Place | null;
  destination: Place | null;
  setOrigin: (place: Place | null) => void;
  setDestination: (place: Place | null) => void;
  // 選んだ駅の英語表示名。駅名（日本語）で引く
  stationNames: StationNames;
  rememberStationName: (name: string, nameEn: string | null) => void;
  // 現在地を出発地にしたときの最寄り駅
  originNearest: NearestStationLabel | null;
  setOriginNearest: (nearest: NearestStationLabel | null) => void;
  // 入口で選んだ、止まっている路線。入口に戻ったときに選んだ状態を復元する
  originLine: OriginLine | null;
  setOriginLine: (line: OriginLine | null) => void;
  // 入口で選んだ方面と、行き先・出発の決め方。判断の画面で前提として示し、入口に戻ったときに復元する
  tripContext: TripContext | null;
  setTripContext: (context: TripContext | null) => void;
  // 車内の位置。駅と駅の間なら、次の駅・自分の種別・前の列車の並びを持つ
  trainPosition: TrainPosition | null;
  // 既定値のままか、利用者が判断の画面で直したか
  trainPositionMeta: TrainPositionMeta;
  setTrainPosition: (position: TrainPosition | null, meta?: TrainPositionMeta) => void;
  // 車内の前提を直し、同じ観測で判断を出し直す。次の駅を変えたら出発の駅も変える
  updateTrainPosition: (position: TrainPosition, meta: TrainPositionMeta) => void;
  observations: Observation[];
  state: JudgmentState;
  mockEnabled: boolean;
  submitInput: (input: RawInput | null) => void;
  // 新しい行程として判断を始める。これまでの観測は捨て、seed（利用者が選んだ路線など）から始める
  // 原因が分からないまま進んだときは input を null にし、seed だけで判断する
  // answers は入口で答えたこと。情報を追加するの札に出し、判断のたびに原因・受信の放送・乗車券を送る
  startJudgment: (input: RawInput | null, seed: Observation[], answers?: AddedAnswers) => void;
  // 入口で答えた乗車券の種類。入口に戻ったときに選んだ状態を復元する
  ticketType: TicketType | null;
  // 判断の画面で足した答え。札に出し、押せば直せる
  addedAnswers: AddedAnswers;
  // 答えを足すか直し、同じ観測で判断を出し直す
  addAnswer: (patch: Partial<AddedAnswers>) => void;
  // 地図で止まっている区間の両端を選んでいる間の状態。first は先に押した駅
  sectionPick: SectionPick | null;
  setSectionPick: (pick: SectionPick | null) => void;
  // startJudgment で預けた判断を流し始める。判断の画面が開いたときに呼ぶ
  resumeJudgment: () => void;
  retry: () => void;
};

export type SectionPick = { first: string | null };

export type OriginLine = {
  key: string;
  lineId: string;
  stationName: string;
  // 観測に入れる路線名（日本語）
  observedName: string;
  name: { ja: string; en: string };
  operator: { ja: string; en: string };
  color: string;
};

export type TripContext = {
  entryState?: EntryState;
  directionKey: string;
  // 「新大阪・千里中央」
  directionLabel: { ja: string; en: string };
  // chosen は利用者が選んだ駅。hub と terminal は方面だけで進んだときの仮の行き先
  destinationBasis: "chosen" | "hub" | "terminal";
  // 電車の中にいて、近い駅か次の駅を出発の駅とみなした
  onTrain: boolean;
  // いまどこの答え。駅にいる、駅に止まっている車内、駅と駅の間
  position: "station" | "trainAtStation" | "betweenStations";
  // 方面の先の駅。駅と駅の間なら、次の駅の候補にする
  nextStationCandidates?: { name: string; nameEn: string | null }[];
  // 方面の先の駅の名前。前の列車の既定の並びを運転パターンから推し量る手がかりにする
  directionStopNames?: string[];
  // 前の列車の既定の並びを運転パターンから推し量ったか。入口に戻ったときに復元する
  trainsAheadFromPattern?: boolean;
  // 止まってからの分。分からなければ null。情報を追加するで答えたときだけ持つ
  elapsedMinutes?: number | null;
  // 原因が分からないか、選んだ大分類で種類が決まらない。情報を追加するで答えたときだけ持つ
  causeUnknown?: boolean;
  // 情報を追加するで答えた原因
  entryAnswers?: EntryAnswers;
};

export type EntryAnswers = {
  cause: CauseAnswer | null;
};

// 車内の前提のうち、利用者が判断の画面で直した項目と、前の列車の並びの出どころ
export type TrainPositionMeta = {
  edited: { nextStation: boolean; ownTrainType: boolean; trainsAhead: boolean };
  // 前の列車の並びを運転パターンから推し量ったか
  trainsAheadFromPattern: boolean;
};

export const defaultTrainPositionMeta: TrainPositionMeta = {
  edited: { nextStation: false, ownTrainType: false, trainsAhead: false },
  trainsAheadFromPattern: false,
};

const JudgmentSessionContext = createContext<JudgmentSession | null>(null);

export function JudgmentSessionProvider({ children }: { children: ReactNode }) {
  const locale = useLocale();
  const [origin, setOrigin] = useState<Place | null>(null);
  const [destination, setDestination] = useState<Place | null>(null);
  const [stationNames, setStationNames] = useState<StationNames>({});
  const [originNearest, setOriginNearest] = useState<NearestStationLabel | null>(null);
  const [originLine, setOriginLine] = useState<OriginLine | null>(null);
  const [tripContext, setTripContext] = useState<TripContext | null>(null);
  const [trainPosition, setTrainPositionState] = useState<TrainPosition | null>(null);
  const [trainPositionMeta, setTrainPositionMeta] =
    useState<TrainPositionMeta>(defaultTrainPositionMeta);
  const [observations, setObservations] = useState<Observation[]>([]);
  const [state, setState] = useState<JudgmentState>(createJudgmentState);
  const [mockEnabled, setMockEnabled] = useState(false);
  const controllerRef = useRef<AbortController | null>(null);
  const lastInputRef = useRef<RawInput | null>(null);
  // 判断の要求は、入口で決めた直後にも出す。state の反映を待たずに読めるよう ref にも持つ
  const trainPositionRef = useRef<TrainPosition | null>(null);
  const trainPositionMetaRef = useRef(defaultTrainPositionMeta);
  // 入口で答えた原因。行程を始めるときに決め、出し直しでも同じものを送る
  const causeRef = useRef<IncidentCause | null>(null);
  const protectionBroadcastRef = useRef<ProtectionBroadcast | null>(null);
  // 入口で答えた乗車券の種類。原因と同じく、出し直しでも同じものを送る
  const ticketTypeRef = useRef<TicketType | null>(null);
  const [ticketType, setTicketType] = useState<TicketType | null>(null);
  const [addedAnswers, setAddedAnswers] = useState<AddedAnswers>(emptyAddedAnswers);
  const [sectionPick, setSectionPick] = useState<SectionPick | null>(null);

  useEffect(() => {
    setMockEnabled(isMockRequested(window.location.search));
    return () => controllerRef.current?.abort();
  }, []);

  const setTrainPosition = useCallback(
    (position: TrainPosition | null, meta: TrainPositionMeta = defaultTrainPositionMeta) => {
      trainPositionRef.current = position;
      trainPositionMetaRef.current = meta;
      setTrainPositionState(position);
      setTrainPositionMeta(meta);
    },
    [],
  );

  const runJudgment = useCallback(
    async (input: RawInput | null, known: Observation[], from: Place | null = origin) => {
      if (from === null || destination === null) return;
      controllerRef.current?.abort();
      const controller = new AbortController();
      controllerRef.current = controller;
      lastInputRef.current = input;

      const request = buildJudgeRequest({
        observations: known,
        newInput: input,
        origin: from,
        destination,
        language: locale,
        now: new Date(),
        trainPosition: trainPositionRef.current,
        cause: causeRef.current,
        protectionBroadcast: protectionBroadcastRef.current,
        ticketType: ticketTypeRef.current,
      });
      const stream: JudgmentStream = mockEnabled ? streamMockJudgment : streamJudgment;

      setState(startJudgmentRun);
      const parsed: Observation[] = [];
      for await (const event of stream(request, { signal: controller.signal })) {
        if (controller.signal.aborted) return;
        if (event.type === "observation_parsed") {
          parsed.push(event.observation);
          const position = applyTrainMovement(trainPositionRef.current, event.observation);
          if (position !== trainPositionRef.current) {
            const meta = trainPositionMetaRef.current;
            setTrainPosition(position, {
              ...meta,
              edited: { ...meta.edited, trainsAhead: true },
              trainsAheadFromPattern: false,
            });
          }
        }
        setState((prev) => reduceJudgmentState(prev, event));
      }
      // 解釈済みの観測は次の要求で返送する。途中で失敗しても読み取れた分は残す
      if (parsed.length > 0) {
        setObservations((prev) => mergeObservations(prev, parsed));
        lastInputRef.current = null;
      }
    },
    [origin, destination, locale, mockEnabled, setTrainPosition],
  );

  const submitInput = useCallback(
    (input: RawInput | null) => {
      void runJudgment(input, observations);
    },
    [runJudgment, observations],
  );

  // 入口から判断の画面へ移るあいだは流さず、判断の画面が開いてから流す
  // 移る途中で判断のイベントが続くと画面の切り替えが遅れ、推論の過程が見えないまま終わるため
  const pendingRef = useRef<{ input: RawInput | null; seed: Observation[] } | null>(null);
  const startJudgment = useCallback(
    (input: RawInput | null, seed: Observation[], answers: AddedAnswers = emptyAddedAnswers) => {
      controllerRef.current?.abort();
      const values = resolveAnswerRequestValues(answers);
      causeRef.current = values.cause;
      protectionBroadcastRef.current = values.protectionBroadcast;
      ticketTypeRef.current = values.ticketType;
      setTicketType(values.ticketType);
      setAddedAnswers(answers);
      setSectionPick(null);
      // 答えた止まってからの分、再開見込み、受信の放送を観測に映す
      const known = applyAddedAnswers(seed, answers, answers, new Date());
      setObservations(known);
      pendingRef.current = { input, seed: known };
      // 新しい行程では前の行程の判断と比べない
      setState(startJudgmentRun(createJudgmentState()));
    },
    [],
  );

  const resumeJudgment = useCallback(() => {
    const pending = pendingRef.current;
    if (!pending) return;
    pendingRef.current = null;
    void runJudgment(pending.input, pending.seed);
  }, [runJudgment]);

  // 足した答えは判断のたびに送る値に映し、観測を直してから判断を出し直す
  const addAnswer = useCallback(
    (patch: Partial<AddedAnswers>) => {
      const next = { ...addedAnswers, ...patch };
      setAddedAnswers(next);
      const values = resolveAnswerRequestValues(next);
      causeRef.current = values.cause;
      protectionBroadcastRef.current = values.protectionBroadcast;
      ticketTypeRef.current = values.ticketType;
      setTicketType(values.ticketType);
      const known = applyAddedAnswers(observations, next, patch, new Date());
      setObservations(known);
      setTripContext((prev) =>
        prev
          ? {
              ...prev,
              ...("elapsed" in patch
                ? {
                    elapsedMinutes: next.elapsed ? findElapsedOption(next.elapsed).minutes : null,
                  }
                : {}),
              ...("cause" in patch
                ? {
                    causeUnknown: resolveCauseIncidentType(next.cause) === null,
                    entryAnswers: { cause: next.cause },
                  }
                : {}),
            }
          : prev,
      );
      void runJudgment("cause" in patch ? buildCauseInput(next.cause) : null, known);
    },
    [addedAnswers, observations, runJudgment],
  );

  const retry = useCallback(() => {
    void runJudgment(lastInputRef.current, observations);
  }, [runJudgment, observations]);

  // 駅と駅の間の前提を直したら、次の駅を出発の駅にして、同じ観測で判断を出し直す
  const updateTrainPosition = useCallback(
    (position: TrainPosition, meta: TrainPositionMeta) => {
      setTrainPosition(position, meta);
      const from: Place | null =
        position.kind === "between_stations" && position.nextStation
          ? { kind: "station", name: position.nextStation }
          : origin;
      setOrigin(from);
      void runJudgment(null, observations, from);
    },
    [setTrainPosition, runJudgment, observations, origin],
  );

  const rememberStationName = useCallback((name: string, nameEn: string | null) => {
    setStationNames((prev) => (prev[name] === nameEn ? prev : { ...prev, [name]: nameEn }));
  }, []);

  const value = useMemo<JudgmentSession>(
    () => ({
      origin,
      destination,
      setOrigin,
      setDestination,
      stationNames,
      rememberStationName,
      originNearest,
      setOriginNearest,
      originLine,
      setOriginLine,
      tripContext,
      setTripContext,
      trainPosition,
      trainPositionMeta,
      setTrainPosition,
      updateTrainPosition,
      observations,
      state,
      mockEnabled,
      submitInput,
      startJudgment,
      ticketType,
      addedAnswers,
      addAnswer,
      sectionPick,
      setSectionPick,
      resumeJudgment,
      retry,
    }),
    [
      origin,
      destination,
      stationNames,
      rememberStationName,
      originNearest,
      originLine,
      tripContext,
      trainPosition,
      trainPositionMeta,
      setTrainPosition,
      updateTrainPosition,
      observations,
      state,
      mockEnabled,
      submitInput,
      startJudgment,
      ticketType,
      addedAnswers,
      addAnswer,
      sectionPick,
      resumeJudgment,
      retry,
    ],
  );

  const currentJudgment = state.status === "ready" ? state.judgment : null;
  const change = buildJudgmentChange(
    state.previousJudgment,
    currentJudgment,
    state.observations.at(-1)?.rawText ?? null,
    selectChangeEvidence({
      estimate: currentJudgment?.estimate ?? null,
      signals: state.signals,
      cues: currentJudgment?.cues,
      observations: [...observations, ...state.observations],
    }),
  );

  return (
    <JudgmentSessionContext value={value}>
      <JudgmentChangeContext value={change}>{children}</JudgmentChangeContext>
    </JudgmentSessionContext>
  );
}

export function useJudgmentSession(): JudgmentSession {
  const session = useContext(JudgmentSessionContext);
  if (session === null) throw new Error("JudgmentSessionProvider の外で使われています");
  return session;
}
