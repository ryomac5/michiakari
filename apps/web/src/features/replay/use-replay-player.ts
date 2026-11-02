"use client";

import type { Action, Judgment, Lang, Observation, TimelineEntry } from "@repo/schema";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  createJudgmentState,
  type JudgmentState,
  mergeObservations,
  reduceJudgmentState,
  startJudgmentRun,
} from "@/features/judgment/state";
import { streamJudgment } from "@/features/judgment/stream";
import { advanceReplayClock, computeEventGapMs } from "./clock";
import { buildReplayDecision, type ReplayDecisionRecord } from "./outcome";
import { buildReplayRequest, type ReplayScenario } from "./scenario";

// シナリオの観測を時刻順に判断エージェントへ流し、判断の変化を再生する
// 判断の生成中は時計を止め、確定してから次の観測へ進める

const tickMs = 100;

export type ReplayHistoryEntry = {
  observationId: string;
  action: Action;
  phaseId: string | null;
  evidenceIds: string[];
  breakEvenShown: boolean;
  // 結末の比較に使う、この判断の値
  decision: ReplayDecisionRecord;
};

export type ReplayStatus = "idle" | "playing" | "paused" | "judging" | "error" | "ended";

export type ReplayPlayer = {
  status: ReplayStatus;
  clockMinutes: number;
  speed: number;
  // これまでに入力した観測の数
  enteredCount: number;
  latestEntry: TimelineEntry | null;
  observations: Observation[];
  state: JudgmentState;
  history: ReplayHistoryEntry[];
  togglePlay: () => void;
  stepNext: () => void;
  restart: () => void;
  retry: () => void;
  changeSpeed: (speed: number) => void;
};

function buildHistoryEntry(
  entry: TimelineEntry,
  judgment: Judgment,
  observedAt: string,
): ReplayHistoryEntry {
  return {
    observationId: entry.id,
    action: judgment.action,
    phaseId: judgment.estimate.phaseId,
    evidenceIds: judgment.evidence.map((e) => e.id),
    breakEvenShown: judgment.breakEven !== null,
    decision: buildReplayDecision(judgment, observedAt),
  };
}

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, ms);
    signal.addEventListener(
      "abort",
      () => {
        clearTimeout(timer);
        resolve();
      },
      { once: true },
    );
  });
}

function selectStatus(params: {
  judging: boolean;
  playing: boolean;
  failed: boolean;
  nextIndex: number;
  total: number;
  enteredCount: number;
}): ReplayStatus {
  if (params.judging) return "judging";
  if (params.failed) return "error";
  if (params.nextIndex >= params.total) return "ended";
  if (params.playing) return "playing";
  return params.enteredCount === 0 ? "idle" : "paused";
}

export function useReplayPlayer(
  scenario: ReplayScenario,
  language: Lang,
  initialSpeed: number,
): ReplayPlayer {
  const timeline = scenario.timeline;
  const [clockMinutes, setClockMinutes] = useState(0);
  const [nextIndex, setNextIndex] = useState(0);
  const [enteredCount, setEnteredCount] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [judging, setJudging] = useState(false);
  const [speed, setSpeed] = useState(initialSpeed);
  const [observations, setObservations] = useState<Observation[]>([]);
  const [state, setState] = useState<JudgmentState>(createJudgmentState);
  const [history, setHistory] = useState<ReplayHistoryEntry[]>([]);

  const controllerRef = useRef<AbortController | null>(null);
  const clockRef = useRef(0);
  const observationsRef = useRef<Observation[]>([]);
  const speedRef = useRef(initialSpeed);

  useEffect(() => () => controllerRef.current?.abort(), []);

  // 観測 1 件を入力し、判断が確定するまでイベントを状態に反映する
  const inputEntry = useCallback(
    async (index: number) => {
      const entry = timeline[index];
      if (!entry) return;
      controllerRef.current?.abort();
      const controller = new AbortController();
      controllerRef.current = controller;

      clockRef.current = entry.offset_minutes;
      setClockMinutes(entry.offset_minutes);
      setEnteredCount(index + 1);
      setJudging(true);
      setState(startJudgmentRun);

      const request = buildReplayRequest(scenario, entry, observationsRef.current, language);
      const parsed: Observation[] = [];
      let judgment: Judgment | null = null;
      let lastAppliedAt = 0;
      for await (const event of streamJudgment(request, { signal: controller.signal })) {
        const wait = lastAppliedAt + computeEventGapMs(speedRef.current) - performance.now();
        if (wait > 0) await sleep(wait, controller.signal);
        if (controller.signal.aborted) return;
        lastAppliedAt = performance.now();
        if (event.type === "observation_parsed") parsed.push(event.observation);
        if (event.type === "judgment_ready") judgment = event.judgment;
        setState((prev) => reduceJudgmentState(prev, event));
      }
      if (controller.signal.aborted) return;

      const confirmed = judgment;
      if (confirmed) {
        // 判断が確定したときだけ観測を残す。失敗時は同じ観測を入れ直す
        observationsRef.current = mergeObservations(observationsRef.current, parsed);
        setObservations(observationsRef.current);
        setHistory((prev) => [
          ...prev.filter((h) => h.observationId !== entry.id),
          buildHistoryEntry(entry, confirmed, request.now),
        ]);
        setNextIndex(index + 1);
      } else {
        setPlaying(false);
      }
      setJudging(false);
    },
    [scenario, timeline, language],
  );

  // 再生中は時計を進め、次の観測の時刻が来たら入力する
  useEffect(() => {
    if (!playing || judging) return;
    let last = performance.now();
    const timer = setInterval(() => {
      const now = performance.now();
      const step = advanceReplayClock(
        timeline,
        nextIndex,
        clockRef.current,
        now - last,
        speedRef.current,
      );
      last = now;
      clockRef.current = step.clockMinutes;
      setClockMinutes(step.clockMinutes);
      if (step.kind === "input") {
        clearInterval(timer);
        void inputEntry(step.index);
      } else if (step.kind === "end") {
        clearInterval(timer);
        setPlaying(false);
      }
    }, tickMs);
    return () => clearInterval(timer);
  }, [playing, judging, nextIndex, timeline, inputEntry]);

  const restart = useCallback(() => {
    controllerRef.current?.abort();
    clockRef.current = 0;
    observationsRef.current = [];
    setClockMinutes(0);
    setNextIndex(0);
    setEnteredCount(0);
    setJudging(false);
    setObservations([]);
    setState(createJudgmentState());
    setHistory([]);
  }, []);

  const failed = !judging && state.status === "error";
  const ended = nextIndex >= timeline.length;

  const togglePlay = useCallback(() => {
    if (ended) {
      restart();
      setPlaying(true);
      return;
    }
    setPlaying((p) => !p);
  }, [ended, restart]);

  const stepNext = useCallback(() => {
    if (judging || ended) return;
    void inputEntry(nextIndex);
  }, [judging, ended, inputEntry, nextIndex]);

  const retry = useCallback(() => {
    if (judging || ended) return;
    setPlaying(true);
    void inputEntry(nextIndex);
  }, [judging, ended, inputEntry, nextIndex]);

  const changeSpeed = useCallback((value: number) => {
    speedRef.current = value;
    setSpeed(value);
  }, []);

  return {
    status: selectStatus({
      judging,
      playing,
      failed,
      nextIndex,
      total: timeline.length,
      enteredCount,
    }),
    clockMinutes,
    speed,
    enteredCount,
    latestEntry: enteredCount > 0 ? (timeline[enteredCount - 1] ?? null) : null,
    observations,
    state,
    history,
    togglePlay,
    stepNext,
    restart,
    retry,
    changeSpeed,
  };
}
