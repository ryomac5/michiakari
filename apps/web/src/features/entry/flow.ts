import type { OriginLine } from "@/features/judgment/session";
import type { SituationTab } from "@/features/judgment/testids";
import type { EntryArea, EntryPlace } from "./entry-places";

// 入口の段。関西 → エリア → 駅 → 行き先 → 入力の方法 → 入力 の順に進み、戻る操作で 1 段ずつ引く

export type EntryStage = "kansai" | "area" | "station" | "destination" | "method" | "input";

export type EntryState = {
  stage: EntryStage;
  area: EntryArea | null;
  place: EntryPlace | null;
  line: OriginLine | null;
  method: SituationTab | null;
};

export type EntryAction =
  | { type: "openArea"; area: EntryArea }
  | { type: "openPlace"; area: EntryArea; place: EntryPlace }
  | { type: "chooseLine"; line: OriginLine }
  | { type: "chooseDestination" }
  | { type: "chooseMethod"; method: SituationTab }
  | { type: "editLine" }
  | { type: "editDestination" }
  | { type: "back" }
  | { type: "reset" };

export const initialEntryState: EntryState = {
  stage: "kansai",
  area: null,
  place: null,
  line: null,
  method: null,
};

const previousStage: Record<EntryStage, EntryStage> = {
  kansai: "kansai",
  area: "kansai",
  station: "area",
  destination: "station",
  method: "destination",
  input: "method",
};

// 戻った段より先で選んだものは捨てる
function stepBack(state: EntryState): EntryState {
  const stage = previousStage[state.stage];
  switch (stage) {
    case "kansai":
      return initialEntryState;
    case "area":
      return { ...state, stage, place: null, line: null, method: null };
    case "station":
      return { ...state, stage, line: null, method: null };
    default:
      return { ...state, stage, method: null };
  }
}

export function reduceEntry(state: EntryState, action: EntryAction): EntryState {
  switch (action.type) {
    case "openArea":
      return { ...initialEntryState, stage: "area", area: action.area };
    case "openPlace":
      return { ...initialEntryState, stage: "station", area: action.area, place: action.place };
    case "chooseLine":
      return state.place ? { ...state, stage: "destination", line: action.line } : state;
    case "chooseDestination":
      return state.line ? { ...state, stage: "method", method: null } : state;
    case "chooseMethod":
      return state.line ? { ...state, stage: "input", method: action.method } : state;
    case "editLine":
      return state.place ? { ...state, stage: "station", line: null, method: null } : state;
    case "editDestination":
      return state.line ? { ...state, stage: "destination", method: null } : state;
    case "back":
      return stepBack(state);
    case "reset":
      return initialEntryState;
  }
}
