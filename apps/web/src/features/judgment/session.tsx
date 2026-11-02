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
import { type KnowledgeCatalog, mergeCatalogs } from "@/features/knowledge/catalog";
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
  observations: Observation[];
  state: JudgmentState;
  catalog: KnowledgeCatalog;
  mockEnabled: boolean;
  submitInput: (input: RawInput | null) => void;
  retry: () => void;
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
      observations,
      state,
      catalog: effectiveCatalog,
      mockEnabled,
      submitInput,
      retry,
    }),
    [
      origin,
      destination,
      stationNames,
      rememberStationName,
      originNearest,
      observations,
      state,
      effectiveCatalog,
      mockEnabled,
      submitInput,
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
