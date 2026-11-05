import type { OriginLine } from "@/features/judgment/session";
import type { ElapsedOption } from "@/features/situation/plain-questions";
import type { EntryArea, EntryPlace } from "./entry-places";

// 入口の段。関西 → エリア → 駅（路線） → 方面 → 行き先 → いまどこ → 原因 → 経過 → 再開見込み の順に進む
// 様子は原因・経過・再開見込みの 3 つの問いで聞き、最後の答えでそのまま判断を始める
// 発表文や掲示を持っている人は、原因の段から撮る・貼るの入力の段へ横に入る
// 戻る操作で 1 段ずつ引く

export type EntryStage =
  | "kansai"
  | "area"
  | "station"
  | "direction"
  | "destination"
  | "position"
  | "cause"
  | "elapsed"
  | "resume"
  | "input";

// 撮る・貼るの入力の方法
export type EntryMethod = "photo" | "paste";

// 原因の答え。eventType は知見の id。聞き取れなかったときは null
export type CauseAnswer = { eventType: string | null };

export type EntryState = {
  stage: EntryStage;
  area: EntryArea | null;
  place: EntryPlace | null;
  line: OriginLine | null;
  // 選んだ方面の key
  direction: string | null;
  // 方面が 1 つしか無く、聞かずに決めたか。戻る操作で方面の段を飛ばす
  directionAuto: boolean;
  method: EntryMethod | null;
  cause: CauseAnswer | null;
  // 止まってからの時間の答え
  elapsed: ElapsedOption["id"] | null;
};

export type EntryAction =
  | { type: "openArea"; area: EntryArea }
  | { type: "openPlace"; area: EntryArea; place: EntryPlace }
  // 方面が 1 つだけなら autoDirection にその key を渡し、方面の段を飛ばす
  | { type: "chooseLine"; line: OriginLine; autoDirection?: string | null }
  | { type: "chooseDirection"; direction: string }
  | { type: "chooseDestination" }
  | { type: "choosePosition" }
  | { type: "chooseMethod"; method: EntryMethod }
  | { type: "chooseCause"; cause: CauseAnswer }
  | { type: "chooseElapsed"; elapsed: ElapsedOption["id"] }
  | { type: "back" }
  // 端末の戻る操作や、行き先・路線の選び直しで、その深さの段まで引く
  | { type: "backTo"; depth: number }
  | { type: "reset" };

export const initialEntryState: EntryState = {
  stage: "kansai",
  area: null,
  place: null,
  line: null,
  direction: null,
  directionAuto: false,
  method: null,
  cause: null,
  elapsed: null,
};

// 段の深さ。関西が 0、再開見込みが 8。端末の履歴の深さと対応させる
// 撮る・貼るの入力は原因の段から横に入るので、経過と同じ深さにする
const stageDepths: Record<EntryStage, number> = {
  kansai: 0,
  area: 1,
  station: 2,
  direction: 3,
  destination: 4,
  position: 5,
  cause: 6,
  elapsed: 7,
  input: 7,
  resume: 8,
};

export function stageDepth(stage: EntryStage): number {
  return stageDepths[stage];
}

type EntryHistoryAction =
  | { type: "restore" | "travel"; depth: number }
  | { type: "write"; from: number; to: number; initialize: boolean }
  | { type: "none" };

// 復元中は既存の履歴を優先する。戻った先を進行とみなすと、履歴を積み直してしまう。
export function selectEntryHistoryAction(
  depth: number,
  storedDepth: number | null,
  restoring: boolean,
): EntryHistoryAction {
  if (restoring && storedDepth !== null && depth > storedDepth) {
    return { type: "restore", depth: storedDepth };
  }
  if (storedDepth === null || depth > storedDepth) {
    return { type: "write", from: storedDepth ?? 0, to: depth, initialize: storedDepth === null };
  }
  if (depth < storedDepth) return { type: "travel", depth };
  return { type: "none" };
}

// 進み具合の印。路線・方面・行き先・いまどこ・様子の 5 つ。駅より前の段は -1
export const progressSteps = ["line", "direction", "destination", "position", "situation"] as const;

export function selectProgressIndex(stage: EntryStage): number {
  return Math.min(stageDepth(stage) - stageDepth("station"), progressSteps.length - 1);
}

// 戻った段より先で選んだものは捨てる
function stepBack(state: EntryState): EntryState {
  switch (state.stage) {
    case "kansai":
    case "area":
      return initialEntryState;
    case "station":
      return { ...initialEntryState, stage: "area", area: state.area };
    case "direction":
      return { ...state, stage: "station", line: null, direction: null, directionAuto: false };
    case "destination":
      return state.directionAuto
        ? { ...state, stage: "station", line: null, direction: null, directionAuto: false }
        : { ...state, stage: "direction", direction: null };
    case "position":
      return { ...state, stage: "destination" };
    case "cause":
      return { ...state, stage: "position", method: null, cause: null, elapsed: null };
    case "input":
      return { ...state, stage: "cause", method: null };
    case "elapsed":
      return { ...state, stage: "cause", cause: null, elapsed: null };
    case "resume":
      return { ...state, stage: "elapsed", elapsed: null };
  }
}

export function reduceEntry(state: EntryState, action: EntryAction): EntryState {
  switch (action.type) {
    case "openArea":
      return { ...initialEntryState, stage: "area", area: action.area };
    case "openPlace":
      return { ...initialEntryState, stage: "station", area: action.area, place: action.place };
    case "chooseLine": {
      if (!state.place) return state;
      const auto = action.autoDirection ?? null;
      return {
        ...state,
        stage: auto ? "destination" : "direction",
        line: action.line,
        direction: auto,
        directionAuto: auto !== null,
        method: null,
        cause: null,
        elapsed: null,
      };
    }
    case "chooseDirection":
      return state.line ? { ...state, stage: "destination", direction: action.direction } : state;
    case "chooseDestination":
      return state.direction ? { ...state, stage: "position" } : state;
    case "choosePosition":
      return state.direction
        ? { ...state, stage: "cause", method: null, cause: null, elapsed: null }
        : state;
    case "chooseMethod":
      return state.stage === "cause" ? { ...state, stage: "input", method: action.method } : state;
    case "chooseCause":
      return state.stage === "cause"
        ? { ...state, stage: "elapsed", cause: action.cause, elapsed: null }
        : state;
    case "chooseElapsed":
      return state.stage === "elapsed" && state.cause
        ? { ...state, stage: "resume", elapsed: action.elapsed }
        : state;
    case "back":
      return stepBack(state);
    case "backTo": {
      let next = state;
      while (stageDepth(next.stage) > Math.max(0, action.depth)) next = stepBack(next);
      return next;
    }
    case "reset":
      return initialEntryState;
  }
}
