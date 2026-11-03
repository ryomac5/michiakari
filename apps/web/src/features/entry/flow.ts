import type { OriginLine } from "@/features/judgment/session";
import type { SituationTab } from "@/features/judgment/testids";
import type { EntryArea, EntryPlace } from "./entry-places";

// 入口の段。関西 → エリア → 駅（路線） → 方面 → 行き先 → いまどこ → 入力の方法 → 入力 の順に進む
// 選んで答えるときは、入力の段で原因を聞き、経過の段で止まってからの時間を聞く
// 戻る操作で 1 段ずつ引く

export type EntryStage =
  | "kansai"
  | "area"
  | "station"
  | "direction"
  | "destination"
  | "position"
  | "method"
  | "input"
  | "elapsed";

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
  method: SituationTab | null;
  cause: CauseAnswer | null;
};

export type EntryAction =
  | { type: "openArea"; area: EntryArea }
  | { type: "openPlace"; area: EntryArea; place: EntryPlace }
  // 方面が 1 つだけなら autoDirection にその key を渡し、方面の段を飛ばす
  | { type: "chooseLine"; line: OriginLine; autoDirection?: string | null }
  | { type: "chooseDirection"; direction: string }
  | { type: "chooseDestination" }
  | { type: "choosePosition" }
  | { type: "chooseMethod"; method: SituationTab }
  | { type: "chooseCause"; cause: CauseAnswer }
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
};

const stageOrder: EntryStage[] = [
  "kansai",
  "area",
  "station",
  "direction",
  "destination",
  "position",
  "method",
  "input",
  "elapsed",
];

// 段の深さ。関西が 0、経過が 8。端末の履歴の深さと対応させる
export function stageDepth(stage: EntryStage): number {
  return stageOrder.indexOf(stage);
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
    case "method":
      return { ...state, stage: "position", method: null };
    case "input":
      return { ...state, stage: "method", method: null, cause: null };
    case "elapsed":
      return { ...state, stage: "input", cause: null };
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
      };
    }
    case "chooseDirection":
      return state.line ? { ...state, stage: "destination", direction: action.direction } : state;
    case "chooseDestination":
      return state.direction ? { ...state, stage: "position" } : state;
    case "choosePosition":
      return state.direction ? { ...state, stage: "method", method: null } : state;
    case "chooseMethod":
      return state.direction ? { ...state, stage: "input", method: action.method } : state;
    case "chooseCause":
      return state.stage === "input" && state.method === "select"
        ? { ...state, stage: "elapsed", cause: action.cause }
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
