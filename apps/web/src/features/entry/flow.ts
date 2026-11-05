import type { OriginLine } from "@/features/judgment/session";
import type { ElapsedOption } from "@/features/situation/plain-questions";
import type { EntryArea, EntryPlace } from "./entry-places";
import type { GpsSegment } from "./gps-candidates";

// 入口の段。駅にいる人は いまどこ → 関西 → エリア → 駅 → 行き先 → 原因 → 経過 → 再開見込み の順に進む
// 車内の人は いまどこ → 路線 → 方面 → 駅間 → 行き先 → 原因 → 経過 → 再開見込み の順に進む
// 現在地から駅を読み取った人は いまどこ → 行き先 へ進む
// 駅の間を読み取った人は いまどこ → 行き先 へ進み、進む向きは行き先から決める。決まらなければ方面を聞く
// history は実際に通った段の答えだけを積む。自動で決めた路線や方面は積まず、戻ると直前の段に戻る
export type EntryStage =
  | "position"
  | "kansai"
  | "area"
  | "station"
  | "direction"
  | "trainPosition"
  | "destination"
  | "cause"
  | "elapsed"
  | "resume"
  | "input";
export type EntryMethod = "photo" | "paste";
export type CauseAnswer = { eventType: string | null };
type EntrySnapshot = {
  stage: EntryStage;
  location: "station" | "train" | null;
  area: EntryArea | null;
  place: EntryPlace | null;
  line: OriginLine | null;
  // 現在地から読み取った駅の間。向きを決めるまで路線の並びの順で持つ
  segment: GpsSegment | null;
  direction: string | null;
  directionAuto: boolean;
  routeEditing: boolean;
  method: EntryMethod | null;
  cause: CauseAnswer | null;
  elapsed: ElapsedOption["id"] | null;
};
export type EntryState = EntrySnapshot & { history: EntrySnapshot[] };
export type EntryAction =
  | { type: "chooseLocation"; location: "station" | "train" }
  | { type: "openArea"; area: EntryArea }
  | { type: "openPlace"; area: EntryArea; place: EntryPlace }
  | {
      type: "chooseLine";
      line: OriginLine;
      autoDirection?: string | null;
      place?: EntryPlace;
      area?: EntryArea;
    }
  | { type: "locateStation"; area: EntryArea; place: EntryPlace }
  | {
      type: "locateBetween";
      line: OriginLine;
      segment: GpsSegment;
      place?: EntryPlace;
      area?: EntryArea;
    }
  | { type: "chooseDirection"; direction: string; line?: OriginLine }
  | { type: "chooseDestination"; inferred?: { line: OriginLine; direction: string } }
  | { type: "choosePosition"; line?: OriginLine; direction?: string }
  | { type: "editRoute" }
  | { type: "restore"; state: EntryState }
  | { type: "chooseMethod"; method: EntryMethod }
  | { type: "chooseCause"; cause: CauseAnswer }
  | { type: "chooseElapsed"; elapsed: ElapsedOption["id"] }
  | { type: "back" }
  | { type: "backTo"; depth: number }
  | { type: "reset" };
export const initialEntryState: EntryState = {
  stage: "position",
  location: null,
  area: null,
  place: null,
  line: null,
  segment: null,
  direction: null,
  directionAuto: false,
  routeEditing: false,
  method: null,
  cause: null,
  elapsed: null,
  history: [],
};

// 分岐や自動推定で省略した問いは、端末の履歴にも積まない。
export function stageDepth(state: EntryState, stage?: EntryStage): number {
  if (!stage || state.stage === stage) return state.history.length;
  return state.history.findLastIndex((s) => s.stage === stage);
}

type EntryHistoryAction =
  | { type: "restore" | "travel"; depth: number }
  | { type: "write"; from: number; to: number; initialize: boolean }
  | { type: "none" };
export function selectEntryHistoryAction(
  depth: number,
  storedDepth: number | null,
  restoring: boolean,
): EntryHistoryAction {
  if (restoring && storedDepth !== null && depth > storedDepth)
    return { type: "restore", depth: storedDepth };
  if (storedDepth === null || depth > storedDepth)
    return { type: "write", from: storedDepth ?? 0, to: depth, initialize: storedDepth === null };
  if (depth < storedDepth) return { type: "travel", depth };
  return { type: "none" };
}
export const progressSteps = ["position", "destination", "route", "situation"] as const;
export function selectProgressIndex(
  stage: EntryStage,
  location: EntryState["location"] = null,
): number {
  if (["cause", "elapsed", "resume", "input"].includes(stage)) return 3;
  if (stage === "destination") return 1;
  if (location === "station" && ["station", "direction"].includes(stage)) return 2;
  return 0;
}
function advance(state: EntryState, changes: Partial<EntrySnapshot>): EntryState {
  const { history, ...snapshot } = state;
  return { ...state, ...changes, history: [...history, snapshot] };
}
function stepBack(state: EntryState): EntryState {
  const previous = state.history.at(-1);
  return previous ? { ...previous, history: state.history.slice(0, -1) } : initialEntryState;
}
export function reduceEntry(state: EntryState, action: EntryAction): EntryState {
  switch (action.type) {
    case "chooseLocation":
      return state.stage === "position"
        ? advance(state, {
            location: action.location,
            stage: action.location === "station" ? "kansai" : "station",
          })
        : state;
    case "locateStation":
      return state.stage === "position"
        ? advance(state, {
            stage: "destination",
            location: "station",
            area: action.area,
            place: action.place,
            line: null,
            segment: null,
            direction: null,
          })
        : state;
    case "locateBetween":
      return state.stage === "position"
        ? advance(state, {
            stage: "destination",
            location: "train",
            area: action.area ?? null,
            place: action.place ?? null,
            line: action.line,
            segment: action.segment,
            direction: null,
            directionAuto: false,
          })
        : state;
    // 最初の段からも、地図と検索でエリアと駅を直接選べる。選んだら駅にいる人として扱う
    case "openArea":
      return ["position", "kansai"].includes(state.stage)
        ? advance(state, { stage: "area", location: "station", area: action.area })
        : state;
    case "openPlace":
      return (state.location === "station" || state.stage === "position") &&
        ["position", "kansai", "area"].includes(state.stage)
        ? advance(state, {
            stage: "destination",
            location: "station",
            area: action.area,
            place: action.place,
            line: null,
            direction: null,
          })
        : state;
    case "chooseLine": {
      if (state.stage !== "station") return state;
      const auto = action.autoDirection ?? null;
      return advance(state, {
        stage: auto ? (state.location === "train" ? "trainPosition" : "cause") : "direction",
        line: action.line,
        place: action.place ?? state.place,
        area: action.area ?? state.area,
        direction: auto,
        directionAuto: auto !== null,
      });
    }
    case "chooseDirection":
      return state.stage === "direction" && state.line
        ? advance(state, {
            stage: state.location === "train" && !state.segment ? "trainPosition" : "cause",
            line: action.line ?? state.line,
            direction: action.direction,
          })
        : state;
    case "choosePosition":
      return state.stage === "trainPosition" && state.direction
        ? advance(state, {
            stage: "destination",
            line: action.line ?? state.line,
            direction: action.direction ?? state.direction,
          })
        : state;
    case "chooseDestination":
      if (state.stage !== "destination") return state;
      if (state.location === "train" && state.segment)
        return advance(
          state,
          action.inferred
            ? {
                stage: "cause",
                line: action.inferred.line,
                direction: action.inferred.direction,
                directionAuto: true,
              }
            : { stage: "direction" },
        );
      if (state.location === "train") return advance(state, { stage: "cause" });
      return advance(
        state,
        action.inferred
          ? {
              stage: "cause",
              line: action.inferred.line,
              direction: action.inferred.direction,
              directionAuto: true,
            }
          : { stage: "station", line: null, direction: null, directionAuto: false },
      );
    case "editRoute":
      return state.stage === "cause"
        ? advance(state, {
            stage: "station",
            line: null,
            segment: null,
            direction: null,
            routeEditing: true,
          })
        : state;
    case "chooseMethod":
      return state.stage === "cause"
        ? advance(state, { stage: "input", method: action.method })
        : state;
    case "chooseCause":
      return state.stage === "cause"
        ? advance(state, { stage: "elapsed", cause: action.cause, elapsed: null })
        : state;
    case "chooseElapsed":
      return state.stage === "elapsed" && state.cause
        ? advance(state, { stage: "resume", elapsed: action.elapsed })
        : state;
    case "back":
      return stepBack(state);
    case "backTo": {
      let next = state;
      while (stageDepth(next) > Math.max(0, action.depth)) next = stepBack(next);
      return next;
    }
    case "restore":
      return action.state;
    case "reset":
      return initialEntryState;
  }
}
