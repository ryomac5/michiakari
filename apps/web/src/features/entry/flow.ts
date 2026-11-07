import type { OriginLine } from "@/features/judgment/session";
import type { EntryArea, EntryPlace } from "./entry-places";
import type { GpsSegment } from "./gps-candidates";

// 入口で聞くのは、いる所と行き先だけ。答え終えた段が cause で、ここに来たら判断を始める
// 原因や止まってからの分などは、判断の画面の「情報を追加する」で分かったときに足す
// 駅にいる人は いまどこ → 関西 → エリア → 駅 → 行き先 → 路線と方面 の順に進む
// 駅と駅の間の人は いまどこ → 駅の間 → 行き先 の順に進む。進む向きは行き先から決める
// 車内の人が乗る電車を選び直すときは 路線 → 方面 → 駅間 → 行き先 の順に聞く
// 現在地から駅を読み取った人は いまどこ → 行き先 へ進む
// 駅の間を読み取った人は いまどこ → 行き先 へ進み、進む向きは行き先から決める。決まらなければ方面を聞く
// 駅にいる人は、行き先の段で先に路線を選べる。そのときは 路線 → 方面 → 行き先 の順に進む
// 路線を先に選んだ人が地図で路線の駅を押したら、方面を自動で決めて判断を始める段へ進む
// history は実際に通った段の答えだけを積む。自動で決めた路線や方面は積まず、戻ると直前の段に戻る
export type EntryStage =
  | "position"
  | "between"
  | "kansai"
  | "area"
  | "station"
  | "direction"
  | "trainPosition"
  | "destination"
  // 判断を始める段。判断の画面から戻ったときは、行程を確かめて判断を出し直す
  | "cause";

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
  // 行き先より先に路線と方面を選んだか。行き先はその方面の先から選ぶ
  routeFirst: boolean;
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
  | { type: "pickRoute"; line: OriginLine; autoDirection?: string | null }
  | { type: "chooseDirection"; direction: string; line?: OriginLine }
  // 先に選んだ路線の駅を行き先にする。方面はその駅へ向かう向きで決める
  | { type: "chooseLineStop"; direction: string }
  | {
      type: "chooseDestination";
      inferred?: { line: OriginLine; direction: string };
      // 先に選んだ方面の先の駅を選んだか。路線と方面はそのまま使う
      onRoute?: boolean;
    }
  | { type: "choosePosition"; line?: OriginLine; direction?: string }
  | { type: "editRoute" }
  | { type: "restore"; state: EntryState }
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
  routeFirst: false,
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
  routeFirst = false,
): number {
  if (stage === "cause") return 3;
  if (stage === "destination") return 1;
  if (location === "station" && stage === "direction" && routeFirst) return 1;
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
// 地図の線を押して、駅の間を答えにできる段
export const betweenPickStages: ReadonlySet<EntryStage> = new Set([
  "position",
  "between",
  "kansai",
  "area",
]);

export function reduceEntry(state: EntryState, action: EntryAction): EntryState {
  switch (action.type) {
    case "chooseLocation":
      return state.stage === "position"
        ? advance(state, {
            location: action.location,
            stage: action.location === "station" ? "kansai" : "between",
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
    // 最初の段の地図と現在地のほか、駅の間の段、関西とエリアの段の地図、駅名の検索からも駅の間を確定する
    // 関西とエリアの段は駅にいる人として来ていても、線を押して駅の間を選んだら車内にいるとして扱う
    case "locateBetween":
      return betweenPickStages.has(state.stage)
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
    // 行き先の段で、地図か一覧から先に路線を選ぶ。方面が 1 つなら方面も決めて行き先へ戻る
    case "pickRoute": {
      if (state.stage !== "destination" || state.location !== "station" || state.line) return state;
      const auto = action.autoDirection ?? null;
      return advance(state, {
        stage: auto ? "destination" : "direction",
        line: action.line,
        direction: auto,
        directionAuto: auto !== null,
        routeFirst: true,
      });
    }
    case "chooseDirection":
      return state.stage === "direction" && state.line
        ? advance(state, {
            stage: state.routeFirst
              ? "destination"
              : state.location === "train" && !state.segment
                ? "trainPosition"
                : "cause",
            line: action.line ?? state.line,
            direction: action.direction,
          })
        : state;
    case "chooseLineStop":
      return state.stage === "direction" &&
        state.routeFirst &&
        state.line &&
        state.location === "station"
        ? advance(state, { stage: "cause", direction: action.direction, directionAuto: true })
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
      if (state.routeFirst && state.line && state.direction && action.onRoute)
        return advance(state, { stage: "cause" });
      return advance(
        state,
        action.inferred
          ? {
              stage: "cause",
              line: action.inferred.line,
              direction: action.inferred.direction,
              directionAuto: true,
              routeFirst: false,
            }
          : {
              stage: "station",
              line: null,
              direction: null,
              directionAuto: false,
              routeFirst: false,
            },
      );
    case "editRoute":
      return state.stage === "cause"
        ? advance(state, {
            stage: "station",
            line: null,
            segment: null,
            direction: null,
            routeEditing: true,
            routeFirst: false,
          })
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
