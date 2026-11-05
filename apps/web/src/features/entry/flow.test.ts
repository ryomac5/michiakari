import { describe, expect, it } from "vitest";
import type { EntryArea, EntryLine, EntryPlace } from "./entry-places";
import {
  type EntryAction,
  type EntryState,
  initialEntryState,
  reduceEntry,
  selectEntryHistoryAction,
  selectProgressIndex,
  stageDepth,
} from "./flow";

const line: EntryLine = {
  key: "大阪|jr-west.東海道線|JR神戸線",
  lineId: "jr-west.東海道線",
  stationName: "大阪",
  stationNameEn: "Osaka",
  observedName: "JR神戸線",
  name: { ja: "JR神戸線", en: "JR Kobe Line" },
  operator: { ja: "JR西日本", en: "JR West" },
  color: "#0072BC",
};
const place: EntryPlace = {
  key: "osaka",
  name: { ja: "大阪", en: "Osaka" },
  position: [135.4959, 34.7024],
  side: { wide: "left", narrow: "left" },
  lines: [line],
};
const area: EntryArea = {
  id: "umeda",
  name: { ja: "梅田・大阪", en: "Umeda & Osaka" },
  center: place.position,
  places: [place],
};

function run(actions: EntryAction[], from: EntryState = initialEntryState): EntryState {
  return actions.reduce(reduceEntry, from);
}

const direction = "大阪|jr-west.東海道線|JR神戸線>jr-west.東海道線.神戸";

const toCause: EntryAction[] = [
  { type: "chooseLocation", location: "station" },
  { type: "openArea", area },
  { type: "openPlace", area, place },
  { type: "chooseDestination", inferred: { line, direction } },
];
const toTrainDestination: EntryAction[] = [
  { type: "chooseLocation", location: "train" },
  { type: "chooseLine", line },
  { type: "chooseDirection", direction },
  { type: "choosePosition" },
];

describe("reduceEntry", () => {
  it("いまどこ・行き先・様子の順に進み、撮る・貼るは原因から入力へ入る", () => {
    const cause = run(toCause);
    expect(cause).toMatchObject({ stage: "cause", line, place, area, direction });
    expect(reduceEntry(cause, { type: "chooseMethod", method: "paste" })).toMatchObject({
      stage: "input",
      method: "paste",
    });
  });
  it("原因・経過・再開見込みの順に進み、段の外では回答を受け付けない", () => {
    const cause = run(toCause);
    const elapsed = reduceEntry(cause, { type: "chooseCause", cause: { eventType: null } });
    expect(elapsed.stage).toBe("elapsed");
    expect(reduceEntry(elapsed, { type: "chooseElapsed", elapsed: "m10" })).toMatchObject({
      stage: "resume",
      elapsed: "m10",
    });
    const paste = reduceEntry(cause, { type: "chooseMethod", method: "paste" });
    expect(reduceEntry(paste, { type: "chooseCause", cause: { eventType: null } })).toBe(paste);
    expect(reduceEntry(cause, { type: "chooseElapsed", elapsed: "now" })).toBe(cause);
  });
  it("駅にいる人は推定で省略した路線・方面には戻らない", () => {
    let state = run([
      ...toCause,
      { type: "chooseCause", cause: { eventType: "person_accident" } },
      { type: "chooseElapsed", elapsed: "m30" },
    ]);
    const stages = [];
    while (state.history.length) {
      state = reduceEntry(state, { type: "back" });
      stages.push(state.stage);
    }
    expect(stages).toEqual(["elapsed", "cause", "destination", "area", "kansai", "position"]);
    expect(state).toEqual(initialEntryState);
    const paste = run([...toCause, { type: "chooseMethod", method: "photo" }]);
    expect(reduceEntry(paste, { type: "back" })).toMatchObject({ stage: "cause", method: null });
  });
  it("方面が一つなら問いを省略し、戻ると路線へ戻る", () => {
    const state = run([
      { type: "chooseLocation", location: "train" },
      { type: "chooseLine", line, autoDirection: direction },
    ]);
    expect(state).toMatchObject({ stage: "trainPosition", directionAuto: true });
    expect(reduceEntry(state, { type: "back" })).toMatchObject({
      stage: "station",
      line: null,
      direction: null,
    });
    expect(reduceEntry(state, { type: "backTo", depth: 1 }).stage).toBe("station");
  });
  it("駅を選ぶ前や段の外では路線・行き先を選べない", () => {
    expect(run([{ type: "chooseLine", line }])).toEqual(initialEntryState);
    expect(run([{ type: "chooseDestination" }])).toEqual(initialEntryState);
    const state = run([
      { type: "chooseLocation", location: "train" },
      { type: "chooseLine", line },
    ]);
    expect(reduceEntry(state, { type: "chooseDestination" })).toBe(state);
  });
  it("実際に通った深さへ引き、先の回答を捨てる", () => {
    const filled = run([...toCause, { type: "chooseMethod", method: "paste" }]);
    expect(stageDepth(filled)).toBe(5);
    expect(
      reduceEntry(filled, { type: "backTo", depth: stageDepth(filled, "destination") }),
    ).toMatchObject({ stage: "destination", line: null, method: null });
    expect(reduceEntry(filled, { type: "backTo", depth: 12 })).toBe(filled);
    expect(reduceEntry(filled, { type: "backTo", depth: -1 })).toEqual(initialEntryState);
    const resume = run([
      ...toCause,
      { type: "chooseCause", cause: { eventType: null } },
      { type: "chooseElapsed", elapsed: "unknown" },
    ]);
    expect(
      reduceEntry(resume, { type: "backTo", depth: stageDepth(resume, "cause") }),
    ).toMatchObject({ stage: "cause", cause: null, elapsed: null });
  });
  it("車内では路線・方面・駅間を答えてから行き先へ進む", () => {
    let state = run(toTrainDestination);
    expect(state.stage).toBe("destination");
    state = reduceEntry(state, { type: "chooseDestination" });
    const stages = [];
    while (state.history.length) {
      state = reduceEntry(state, { type: "back" });
      stages.push(state.stage);
    }
    expect(stages).toEqual(["destination", "trainPosition", "direction", "station", "position"]);
  });
  it("複数候補や共通路線なしでは行き先の後で路線を聞く", () => {
    const state = run([...toCause.slice(0, -1), { type: "chooseDestination" }]);
    expect(state.stage).toBe("station");
    const cause = run(
      [
        { type: "chooseLine", line },
        { type: "chooseDirection", direction },
      ],
      state,
    );
    expect(cause.stage).toBe("cause");
    expect(reduceEntry(cause, { type: "back" }).stage).toBe("direction");
  });
  it("推定した電車を変更でき、戻ると元の推定を復元する", () => {
    const cause = run(toCause);
    const edit = reduceEntry(cause, { type: "editRoute" });
    expect(edit.stage).toBe("station");
    expect(reduceEntry(edit, { type: "back" })).toEqual(cause);
    expect(reduceEntry(initialEntryState, { type: "restore", state: cause })).toEqual(cause);
  });
});
describe("selectProgressIndex", () => {
  it("いまどこ・行き先・乗る電車・様子の順に印を出す", () => {
    expect(
      (
        [
          "position",
          "kansai",
          "area",
          "destination",
          "station",
          "direction",
          "cause",
          "input",
          "elapsed",
          "resume",
        ] as const
      ).map((stage) => selectProgressIndex(stage, "station")),
    ).toEqual([0, 0, 0, 1, 2, 2, 3, 3, 3, 3]);
    expect(selectProgressIndex("station", "train")).toBe(0);
    expect(selectProgressIndex("direction", "train")).toBe(0);
    expect(selectProgressIndex("trainPosition", "train")).toBe(0);
  });
});

describe("selectEntryHistoryAction", () => {
  const resumeDepth = 6;
  const elapsedDepth = 5;

  it("判断から戻った履歴が最後の段なら、入口の履歴を積み直さない", () => {
    expect(selectEntryHistoryAction(resumeDepth, resumeDepth, true)).toEqual({ type: "none" });
    expect(selectEntryHistoryAction(resumeDepth, resumeDepth, false)).toEqual({ type: "none" });
  });

  it("復元した答えより履歴が浅ければ段を戻し、更新後も履歴を積まない", () => {
    const restored = run([
      ...toCause,
      { type: "chooseCause", cause: { eventType: "person_accident" } },
      { type: "chooseElapsed", elapsed: "m10" },
    ]);
    const action = selectEntryHistoryAction(stageDepth(restored), elapsedDepth, true);
    expect(action).toEqual({ type: "restore", depth: elapsedDepth });
    // 段の更新前に再実行されても、復元を進行として扱わない。
    expect(selectEntryHistoryAction(stageDepth(restored), elapsedDepth, true)).toEqual(action);
    if (action.type !== "restore") throw new Error("履歴の深さへの復元が必要");
    const next = reduceEntry(restored, { type: "backTo", depth: action.depth });
    expect(next.stage).toBe("elapsed");
    expect(selectEntryHistoryAction(stageDepth(next), elapsedDepth, true)).toEqual({
      type: "none",
    });
    expect(selectEntryHistoryAction(stageDepth(next), elapsedDepth, false)).toEqual({
      type: "none",
    });
  });

  it("通常の回答では次の段だけを積む", () => {
    expect(selectEntryHistoryAction(resumeDepth, elapsedDepth, false)).toEqual({
      type: "write",
      from: elapsedDepth,
      to: resumeDepth,
      initialize: false,
    });
  });

  it("初回は深さ 0 を記録し、履歴に印がない復元では必要な段を積む", () => {
    expect(selectEntryHistoryAction(0, null, true)).toEqual({
      type: "write",
      from: 0,
      to: 0,
      initialize: true,
    });
    expect(selectEntryHistoryAction(resumeDepth, null, true)).toEqual({
      type: "write",
      from: 0,
      to: resumeDepth,
      initialize: true,
    });
  });

  it("選び直しで段が浅くなったときは既存の履歴を引く", () => {
    expect(selectEntryHistoryAction(elapsedDepth, resumeDepth, false)).toEqual({
      type: "travel",
      depth: elapsedDepth,
    });
  });
});
