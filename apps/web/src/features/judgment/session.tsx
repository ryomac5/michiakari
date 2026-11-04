"use client";

import type { Observation, Place, RawInput } from "@repo/schema";
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
import type { CauseAnswer, EntryMethod } from "@/features/entry/flow";
import { type KnowledgeCatalog, mergeCatalogs } from "@/features/knowledge/catalog";
import type { ElapsedOption } from "@/features/situation/plain-questions";
import type { NearestStationLabel, StationNames } from "@/features/stations/describe";
import { personAccidentCatalog } from "./fixtures/person-accident";
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
  observations: Observation[];
  state: JudgmentState;
  catalog: KnowledgeCatalog;
  mockEnabled: boolean;
  submitInput: (input: RawInput | null) => void;
  // 新しい行程として判断を始める。これまでの観測は捨て、seed（利用者が選んだ路線など）から始める
  // 原因が分からないまま進んだときは input を null にし、seed だけで判断する
  startJudgment: (input: RawInput | null, seed: Observation[]) => void;
  // startJudgment で預けた判断を流し始める。判断の画面が開いたときに呼ぶ
  resumeJudgment: () => void;
  retry: () => void;
};

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
  directionKey: string;
  // 「新大阪・千里中央」
  directionLabel: { ja: string; en: string };
  // chosen は利用者が選んだ駅。hub と terminal は方面だけで進んだときの仮の行き先
  destinationBasis: "chosen" | "hub" | "terminal";
  // 電車の中にいて、近い駅を出発の駅とみなした
  onTrain: boolean;
  // 止まってからの分。分からなければ null。選んで答えたときだけ持つ
  elapsedMinutes?: number | null;
  // 原因を聞き取れなかった。選んで答えたときだけ持つ
  causeUnknown?: boolean;
  // 様子の段で答えたこと。入口に戻ったとき、最後に答えた問いから再開する
  entryAnswers?: EntryAnswers;
};

export type EntryAnswers = {
  method: EntryMethod | null;
  cause: CauseAnswer | null;
  elapsed: ElapsedOption["id"] | null;
};

const JudgmentSessionContext = createContext<JudgmentSession | null>(null);

export function JudgmentSessionProvider({
  catalog,
  children,
}: {
  catalog: KnowledgeCatalog;
  children: ReactNode;
}) {
  const locale = useLocale();
  const [origin, setOrigin] = useState<Place | null>(null);
  const [destination, setDestination] = useState<Place | null>(null);
  const [stationNames, setStationNames] = useState<StationNames>({});
  const [originNearest, setOriginNearest] = useState<NearestStationLabel | null>(null);
  const [originLine, setOriginLine] = useState<OriginLine | null>(null);
  const [tripContext, setTripContext] = useState<TripContext | null>(null);
  const [observations, setObservations] = useState<Observation[]>([]);
  const [state, setState] = useState<JudgmentState>(createJudgmentState);
  const [mockEnabled, setMockEnabled] = useState(false);
  const controllerRef = useRef<AbortController | null>(null);
  const lastInputRef = useRef<RawInput | null>(null);

  useEffect(() => {
    setMockEnabled(isMockRequested(window.location.search));
    return () => controllerRef.current?.abort();
  }, []);

  const runJudgment = useCallback(
    async (input: RawInput | null, known: Observation[]) => {
      if (origin === null || destination === null) return;
      controllerRef.current?.abort();
      const controller = new AbortController();
      controllerRef.current = controller;
      lastInputRef.current = input;

      const request = buildJudgeRequest({
        observations: known,
        newInput: input,
        origin,
        destination,
        language: locale,
        now: new Date(),
      });
      const stream: JudgmentStream = mockEnabled ? streamMockJudgment : streamJudgment;

      setState(startJudgmentRun);
      const parsed: Observation[] = [];
      for await (const event of stream(request, { signal: controller.signal })) {
        if (controller.signal.aborted) return;
        if (event.type === "observation_parsed") parsed.push(event.observation);
        setState((prev) => reduceJudgmentState(prev, event));
      }
      // 解釈済みの観測は次の要求で返送する。途中で失敗しても読み取れた分は残す
      if (parsed.length > 0) {
        setObservations((prev) => mergeObservations(prev, parsed));
        lastInputRef.current = null;
      }
    },
    [origin, destination, locale, mockEnabled],
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
  const startJudgment = useCallback((input: RawInput | null, seed: Observation[]) => {
    controllerRef.current?.abort();
    setObservations(seed);
    pendingRef.current = { input, seed };
    setState(startJudgmentRun);
  }, []);

  const resumeJudgment = useCallback(() => {
    const pending = pendingRef.current;
    if (!pending) return;
    pendingRef.current = null;
    void runJudgment(pending.input, pending.seed);
  }, [runJudgment]);

  const retry = useCallback(() => {
    void runJudgment(lastInputRef.current, observations);
  }, [runJudgment, observations]);

  const rememberStationName = useCallback((name: string, nameEn: string | null) => {
    setStationNames((prev) => (prev[name] === nameEn ? prev : { ...prev, [name]: nameEn }));
  }, []);

  const effectiveCatalog = useMemo(
    // モックのイベントはモック用の段階 id を使うので、モックの抜粋を優先する
    () => (mockEnabled ? mergeCatalogs(personAccidentCatalog, catalog) : catalog),
    [catalog, mockEnabled],
  );

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
      observations,
      state,
      catalog: effectiveCatalog,
      mockEnabled,
      submitInput,
      startJudgment,
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
      observations,
      state,
      effectiveCatalog,
      mockEnabled,
      submitInput,
      startJudgment,
      resumeJudgment,
      retry,
    ],
  );

  return <JudgmentSessionContext value={value}>{children}</JudgmentSessionContext>;
}

export function useJudgmentSession(): JudgmentSession {
  const session = useContext(JudgmentSessionContext);
  if (session === null) throw new Error("JudgmentSessionProvider の外で使われています");
  return session;
}
