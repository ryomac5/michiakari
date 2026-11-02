import type {
  BreakEven,
  DetectedSignal,
  Estimate,
  Judgment,
  JudgmentEvent,
  Observation,
  RouteOption,
} from "@repo/schema";

// 判断イベントの列から画面の状態を組み立てる

export const reasoningSteps = ["reading", "signals", "phase", "options", "breakEven"] as const;
export type ReasoningStepId = (typeof reasoningSteps)[number];
export type StepStatus = "pending" | "active" | "done" | "failed";
export type JudgmentStatus = "idle" | "streaming" | "ready" | "error";

export type JudgmentState = {
  status: JudgmentStatus;
  steps: Record<ReasoningStepId, StepStatus>;
  // この回で解釈された観測
  observations: Observation[];
  signals: DetectedSignal[];
  estimate: Estimate | null;
  options: RouteOption[] | null;
  breakEvenComputed: boolean;
  breakEven: BreakEven | null;
  judgment: Judgment | null;
  error: { message: string; retryable: boolean } | null;
  lastSeq: number;
  // 更新中・失敗時に表示し続ける前回の判断
  previousJudgment: Judgment | null;
};

function buildSteps(status: StepStatus): Record<ReasoningStepId, StepStatus> {
  return { reading: status, signals: status, phase: status, options: status, breakEven: status };
}

export function createJudgmentState(): JudgmentState {
  return {
    status: "idle",
    steps: buildSteps("pending"),
    observations: [],
    signals: [],
    estimate: null,
    options: null,
    breakEvenComputed: false,
    breakEven: null,
    judgment: null,
    error: null,
    lastSeq: -1,
    previousJudgment: null,
  };
}

// 新しい判断の要求を始める。前回の判断は previousJudgment に退避する
export function startJudgmentRun(prev: JudgmentState): JudgmentState {
  return {
    ...createJudgmentState(),
    status: "streaming",
    steps: { ...buildSteps("pending"), reading: "active" },
    previousJudgment: prev.judgment ?? prev.previousJudgment,
  };
}

// doneThrough 番目までを完了にし、activeIndex 番目を進行中にする
function advanceSteps(
  steps: Record<ReasoningStepId, StepStatus>,
  doneThrough: number,
  activeIndex: number | null,
): Record<ReasoningStepId, StepStatus> {
  const next = { ...steps };
  reasoningSteps.forEach((id, i) => {
    if (i <= doneThrough) next[id] = "done";
    else if (i === activeIndex && next[id] !== "done") next[id] = "active";
  });
  return next;
}

function failActiveSteps(
  steps: Record<ReasoningStepId, StepStatus>,
): Record<ReasoningStepId, StepStatus> {
  const next = { ...steps };
  for (const id of reasoningSteps) {
    if (next[id] === "active") next[id] = "failed";
  }
  return next;
}

function appendObservation(list: Observation[], observation: Observation): Observation[] {
  return [...list.filter((o) => o.id !== observation.id), observation];
}

function appendSignal(list: DetectedSignal[], signal: DetectedSignal): DetectedSignal[] {
  const exists = list.some(
    (s) => s.eventType === signal.eventType && s.signalId === signal.signalId,
  );
  return exists ? list : [...list, signal];
}

export function reduceJudgmentState(state: JudgmentState, event: JudgmentEvent): JudgmentState {
  // 重複・逆順のイベントは捨てる
  if (event.seq <= state.lastSeq) return state;
  const base = { ...state, lastSeq: event.seq };

  switch (event.type) {
    case "observation_parsed":
      return {
        ...base,
        observations: appendObservation(state.observations, event.observation),
        steps: advanceSteps(state.steps, 0, 1),
      };
    case "signal_detected":
      return {
        ...base,
        signals: appendSignal(state.signals, event.signal),
        steps: advanceSteps(state.steps, 0, 1),
      };
    case "phase_estimated":
      return { ...base, estimate: event.estimate, steps: advanceSteps(state.steps, 2, 3) };
    case "alternatives_computed":
      return { ...base, options: event.options, steps: advanceSteps(state.steps, 3, 4) };
    case "break_even_computed":
      return {
        ...base,
        breakEvenComputed: true,
        breakEven: event.breakEven,
        steps: advanceSteps(state.steps, 4, null),
      };
    case "judgment_ready":
      return {
        ...base,
        status: "ready",
        judgment: event.judgment,
        estimate: event.judgment.estimate,
        options: event.judgment.options,
        breakEvenComputed: true,
        breakEven: event.judgment.breakEven,
        steps: buildSteps("done"),
        error: null,
      };
    case "error":
      return {
        ...base,
        status: "error",
        error: { message: event.message, retryable: event.retryable },
        steps: failActiveSteps(state.steps),
      };
  }
}

export type JudgmentDisplay = {
  judgment: Judgment | null;
  estimate: Estimate | null;
  options: RouteOption[] | null;
  optionsStale: boolean;
  breakEven: BreakEven | null;
  breakEvenKnown: boolean;
  breakEvenStale: boolean;
  recommendedOptionId: string | null;
  evidence: Judgment["evidence"];
};

// 表示に使う値を選ぶ。更新中・失敗時はまだ届いていない項目を前回の判断で補う
export function selectJudgmentDisplay(state: JudgmentState): JudgmentDisplay {
  const fallback =
    state.status === "streaming" || state.status === "error" ? state.previousJudgment : null;
  const current = state.judgment;

  const optionsStale = state.options === null && fallback !== null;
  const breakEvenStale = !state.breakEvenComputed && fallback !== null;

  return {
    judgment: current,
    estimate: state.estimate ?? fallback?.estimate ?? null,
    options: state.options ?? fallback?.options ?? null,
    optionsStale,
    breakEven: state.breakEvenComputed ? state.breakEven : (fallback?.breakEven ?? null),
    breakEvenKnown: state.breakEvenComputed || fallback !== null,
    breakEvenStale,
    recommendedOptionId:
      current?.recommendedOptionId ?? (current ? null : (fallback?.recommendedOptionId ?? null)),
    evidence: current?.evidence ?? fallback?.evidence ?? [],
  };
}

// 次の要求で返送する観測の列。id が同じものは新しい方で置き換える
export function mergeObservations(known: Observation[], added: Observation[]): Observation[] {
  return added.reduce(appendObservation, known);
}
