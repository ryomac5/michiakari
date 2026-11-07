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
const segment = { from: "塚本", to: "尼崎" };
// 駅と駅の間で止まっている人が、行き先まで答えてから乗る電車を選び直す。路線の段から聞き直す
const toTrainLine: EntryAction[] = [
  { type: "chooseLocation", location: "train" },
  { type: "locateBetween", line, segment, place, area },
  { type: "chooseDestination", inferred: { line, direction } },
  { type: "editRoute" },
];
const toTrainDestination: EntryAction[] = [
  ...toTrainLine,
  { type: "chooseLine", line },
  { type: "chooseDirection", direction },
  { type: "choosePosition" },
];

describe("reduceEntry", () => {
  it("関西とエリアの段で線を押して駅の間を選ぶと、車内にいるとして行き先へ進み、戻るとその段に戻る", () => {
    const kansai = run([{ type: "chooseLocation", location: "station" }]);
    const opened = run(toCause.slice(0, 2));
    for (const from of [kansai, opened]) {
      const located = reduceEntry(from, { type: "locateBetween", line, segment, place, area });
      expect(located).toMatchObject({ stage: "destination", location: "train", line, segment });
      expect(reduceEntry(located, { type: "back" })).toMatchObject({ stage: from.stage });
    }
  });
  it("駅を選んで行き先や路線を選ぶ段では、駅の間を答えにしない", () => {
    const station = run(toCause.slice(0, 3));
    expect(reduceEntry(station, { type: "locateBetween", line, segment, place, area })).toBe(
      station,
    );
  });
  it("いる所と行き先を答えると判断を始める段へ進み、様子は入口で聞かない", () => {
    const cause = run(toCause);
    expect(cause).toMatchObject({ stage: "cause", line, place, area, direction });
    expect(Object.keys(cause)).not.toContain("elapsed");
    expect(Object.keys(cause)).not.toContain("protection");
    const train = run([
      { type: "chooseLocation", location: "train" },
      { type: "locateBetween", line, segment, place, area },
      { type: "chooseDestination", inferred: { line, direction } },
    ]);
    expect(train).toMatchObject({ stage: "cause", location: "train", line, direction });
    expect(selectProgressIndex(train.stage)).toBe(3);
  });
  it("駅にいる人は推定で省略した路線・方面には戻らない", () => {
    let state = run(toCause);
    const stages = [];
    while (state.history.length) {
      state = reduceEntry(state, { type: "back" });
      stages.push(state.stage);
    }
    expect(stages).toEqual(["destination", "area", "kansai", "position"]);
    expect(state).toEqual(initialEntryState);
  });
  it("方面が一つなら問いを省略し、戻ると路線へ戻る", () => {
    const state = run([...toTrainLine, { type: "chooseLine", line, autoDirection: direction }]);
    expect(state).toMatchObject({ stage: "trainPosition", directionAuto: true });
    expect(reduceEntry(state, { type: "back" })).toMatchObject({
      stage: "station",
      line: null,
      direction: null,
    });
    expect(reduceEntry(state, { type: "backTo", depth: toTrainLine.length }).stage).toBe("station");
  });
  it("駅を選ぶ前や段の外では路線・行き先を選べない", () => {
    expect(run([{ type: "chooseLine", line }])).toEqual(initialEntryState);
    expect(run([{ type: "chooseDestination" }])).toEqual(initialEntryState);
    const state = run([...toTrainLine, { type: "chooseLine", line }]);
    expect(reduceEntry(state, { type: "chooseDestination" })).toBe(state);
  });
  it("実際に通った深さへ引き、先の回答を捨てる", () => {
    const filled = run(toCause);
    expect(stageDepth(filled)).toBe(4);
    expect(
      reduceEntry(filled, { type: "backTo", depth: stageDepth(filled, "destination") }),
    ).toMatchObject({ stage: "destination", line: null, direction: null });
    expect(reduceEntry(filled, { type: "backTo", depth: 12 })).toBe(filled);
    expect(reduceEntry(filled, { type: "backTo", depth: -1 })).toEqual(initialEntryState);
  });
  it("駅と駅の間を選ぶと、路線と方面の段を飛ばして駅の間の段へ進み、確定すると行き先へ進む", () => {
    const between = run([{ type: "chooseLocation", location: "train" }]);
    expect(between).toMatchObject({ stage: "between", location: "train", line: null });
    const destination = reduceEntry(between, {
      type: "locateBetween",
      line,
      segment,
      place,
      area,
    });
    expect(destination).toMatchObject({
      stage: "destination",
      location: "train",
      line,
      segment,
      direction: null,
    });
    let state = reduceEntry(destination, {
      type: "chooseDestination",
      inferred: { line, direction },
    });
    expect(state).toMatchObject({ stage: "cause", direction, directionAuto: true });
    const stages = [];
    while (state.history.length) {
      state = reduceEntry(state, { type: "back" });
      stages.push(state.stage);
    }
    expect(stages).toEqual(["destination", "between", "position"]);
  });
  it("乗る電車を選び直すときは、路線・方面・駅間を答えてから行き先へ進む", () => {
    let state = run(toTrainDestination);
    expect(state.stage).toBe("destination");
    state = reduceEntry(state, { type: "chooseDestination" });
    const stages = [];
    while (state.history.length) {
      state = reduceEntry(state, { type: "back" });
      stages.push(state.stage);
    }
    expect(stages).toEqual([
      "destination",
      "trainPosition",
      "direction",
      "station",
      "cause",
      "destination",
      "between",
      "position",
    ]);
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
describe("現在地から読み取った位置", () => {
  const locateBetween: EntryAction = { type: "locateBetween", line, segment, place, area };
  it("駅を読み取ると駅にいる人として行き先へ進み、戻るといまどこへ戻る", () => {
    const state = run([{ type: "locateStation", area, place }]);
    expect(state).toMatchObject({ stage: "destination", location: "station", place, area });
    expect(reduceEntry(state, { type: "back" })).toEqual(initialEntryState);
  });
  it("駅の間を読み取ると路線と駅間を飛ばして行き先へ進み、向きが決まれば様子へ進む", () => {
    const destination = run([locateBetween]);
    expect(destination).toMatchObject({
      stage: "destination",
      location: "train",
      line,
      segment,
      direction: null,
    });
    const cause = reduceEntry(destination, {
      type: "chooseDestination",
      inferred: { line, direction },
    });
    expect(cause).toMatchObject({ stage: "cause", direction, directionAuto: true });
    const stages = [];
    let state = cause;
    while (state.history.length) {
      state = reduceEntry(state, { type: "back" });
      stages.push(state.stage);
    }
    expect(stages).toEqual(["destination", "position"]);
  });
  it("行き先から向きが決まらなければ方面を聞き、答えると様子へ進む", () => {
    const asked = run([locateBetween, { type: "chooseDestination" }]);
    expect(asked.stage).toBe("direction");
    const moved = { ...line, stationName: "尼崎" };
    const cause = reduceEntry(asked, { type: "chooseDirection", direction, line: moved });
    expect(cause).toMatchObject({ stage: "cause", line: moved, direction });
    expect(reduceEntry(cause, { type: "back" }).stage).toBe("direction");
  });
  it("駅を選んだ後の段では読み取った位置を受け付けず、電車を変えると駅間を捨てる", () => {
    const station = run(toCause.slice(0, 3));
    expect(reduceEntry(station, locateBetween)).toBe(station);
    const cause = run([
      locateBetween,
      { type: "chooseDestination", inferred: { line, direction } },
    ]);
    expect(reduceEntry(cause, { type: "editRoute" })).toMatchObject({
      stage: "station",
      segment: null,
    });
  });
});
describe("selectProgressIndex", () => {
  it("いまどこ・行き先・乗る電車・様子の順に印を出す", () => {
    expect(
      (["position", "kansai", "area", "destination", "station", "direction", "cause"] as const).map(
        (stage) => selectProgressIndex(stage, "station"),
      ),
    ).toEqual([0, 0, 0, 1, 2, 2, 3]);
    expect(selectProgressIndex("station", "train")).toBe(0);
    expect(selectProgressIndex("direction", "train")).toBe(0);
    expect(selectProgressIndex("trainPosition", "train")).toBe(0);
    expect(selectProgressIndex("between", "train")).toBe(0);
  });
});

describe("selectEntryHistoryAction", () => {
  const causeDepth = 4;
  const destinationDepth = 3;

  it("判断から戻った履歴が最後の段なら、入口の履歴を積み直さない", () => {
    expect(selectEntryHistoryAction(causeDepth, causeDepth, true)).toEqual({ type: "none" });
    expect(selectEntryHistoryAction(causeDepth, causeDepth, false)).toEqual({ type: "none" });
  });

  it("復元した答えより履歴が浅ければ段を戻し、更新後も履歴を積まない", () => {
    const restored = run(toCause);
    const action = selectEntryHistoryAction(stageDepth(restored), destinationDepth, true);
    expect(action).toEqual({ type: "restore", depth: destinationDepth });
    // 段の更新前に再実行されても、復元を進行として扱わない。
    expect(selectEntryHistoryAction(stageDepth(restored), destinationDepth, true)).toEqual(action);
    if (action.type !== "restore") throw new Error("履歴の深さへの復元が必要");
    const next = reduceEntry(restored, { type: "backTo", depth: action.depth });
    expect(next.stage).toBe("destination");
    expect(selectEntryHistoryAction(stageDepth(next), destinationDepth, true)).toEqual({
      type: "none",
    });
    expect(selectEntryHistoryAction(stageDepth(next), destinationDepth, false)).toEqual({
      type: "none",
    });
  });

  it("通常の回答では次の段だけを積む", () => {
    expect(selectEntryHistoryAction(causeDepth, destinationDepth, false)).toEqual({
      type: "write",
      from: destinationDepth,
      to: causeDepth,
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
    expect(selectEntryHistoryAction(causeDepth, null, true)).toEqual({
      type: "write",
      from: 0,
      to: causeDepth,
      initialize: true,
    });
  });

  it("選び直しで段が浅くなったときは既存の履歴を引く", () => {
    expect(selectEntryHistoryAction(destinationDepth, causeDepth, false)).toEqual({
      type: "travel",
      depth: destinationDepth,
    });
  });
});

describe("最初の段からの駅の選択", () => {
  it("駅にいるを先に選ばず駅を確定し、戻ると最初の段へ戻る", () => {
    const state = reduceEntry(initialEntryState, { type: "openPlace", area, place });
    expect(state).toMatchObject({ stage: "destination", location: "station", place });
    expect(state.history).toHaveLength(1);
    expect(reduceEntry(state, { type: "back" })).toEqual(initialEntryState);
  });

  it("最初の地図のエリアから駅を選べる", () => {
    const state = run([
      { type: "openArea", area },
      { type: "openPlace", area, place },
    ]);
    expect(state).toMatchObject({ stage: "destination", location: "station", place });
    expect(state.history.map((item) => item.stage)).toEqual(["position", "area"]);
  });

  it("車内と答えたあとは、エリアも駅も開かない", () => {
    const onTrain = run([{ type: "chooseLocation", location: "train" }]);
    expect(reduceEntry(onTrain, { type: "openArea", area })).toBe(onTrain);
    expect(reduceEntry(onTrain, { type: "openPlace", area, place })).toBe(onTrain);
  });
});

describe("行き先の段で先に路線を選ぶ", () => {
  const loop: EntryLine = {
    ...line,
    key: "大阪|jr-west.大阪環状線|JR環状線",
    lineId: "jr-west.大阪環状線",
    observedName: "JR環状線",
    name: { ja: "JR環状線", en: "JR Osaka Loop Line" },
  };
  const loopDirection = "大阪|jr-west.大阪環状線|JR環状線>jr-west.大阪環状線.天王寺";
  const toDestination: EntryAction[] = [
    { type: "chooseLocation", location: "station" },
    { type: "openArea", area },
    { type: "openPlace", area, place },
  ];

  it("路線、方面、行き先の順に進み、先の方面の駅なら路線と方面をそのまま使う", () => {
    const picked = run([...toDestination, { type: "pickRoute", line: loop }]);
    expect(picked).toMatchObject({ stage: "direction", line: loop, routeFirst: true });
    expect(selectProgressIndex(picked.stage, picked.location, picked.routeFirst)).toBe(1);
    const directed = reduceEntry(picked, { type: "chooseDirection", direction: loopDirection });
    expect(directed).toMatchObject({ stage: "destination", line: loop, direction: loopDirection });
    const cause = reduceEntry(directed, { type: "chooseDestination", onRoute: true });
    expect(cause).toMatchObject({
      stage: "cause",
      line: loop,
      direction: loopDirection,
      directionAuto: false,
    });
  });

  it("戻ると方面、路線の順に 1 段ずつ引く", () => {
    const cause = run([
      ...toDestination,
      { type: "pickRoute", line: loop },
      { type: "chooseDirection", direction: loopDirection },
      { type: "chooseDestination", onRoute: true },
    ]);
    const destination = reduceEntry(cause, { type: "back" });
    expect(destination).toMatchObject({ stage: "destination", direction: loopDirection });
    const direction = reduceEntry(destination, { type: "back" });
    expect(direction).toMatchObject({ stage: "direction", line: loop, direction: null });
    const first = reduceEntry(direction, { type: "back" });
    expect(first).toMatchObject({ stage: "destination", line: null, routeFirst: false });
  });

  it("路線の駅を地図で押すと、方面の段を飛ばして様子へ進み、戻ると方面の段に戻る", () => {
    const picked = run([...toDestination, { type: "pickRoute", line: loop }]);
    const cause = reduceEntry(picked, { type: "chooseLineStop", direction: loopDirection });
    expect(cause).toMatchObject({
      stage: "cause",
      line: loop,
      direction: loopDirection,
      directionAuto: true,
    });
    expect(reduceEntry(cause, { type: "back" })).toMatchObject({
      stage: "direction",
      line: loop,
      direction: null,
    });
  });

  it("路線を先に選んでいない方面の段では、駅を押しても進まない", () => {
    const onTrain = run([...toTrainLine, { type: "chooseLine", line: loop }]);
    expect(onTrain.stage).toBe("direction");
    expect(reduceEntry(onTrain, { type: "chooseLineStop", direction: loopDirection })).toBe(
      onTrain,
    );
  });

  it("方面が 1 つなら方面を聞かず、行き先の段に方面を決めて戻る", () => {
    const picked = run([...toDestination, { type: "pickRoute", line, autoDirection: direction }]);
    expect(picked).toMatchObject({
      stage: "destination",
      line,
      direction,
      directionAuto: true,
      routeFirst: true,
    });
  });

  it("方面の外の駅を選んだら、今どおり行き先から路線と方面を決め直す", () => {
    const directed = run([
      ...toDestination,
      { type: "pickRoute", line: loop },
      { type: "chooseDirection", direction: loopDirection },
    ]);
    expect(
      reduceEntry(directed, { type: "chooseDestination", inferred: { line, direction } }),
    ).toMatchObject({ stage: "cause", line, direction, routeFirst: false });
    expect(reduceEntry(directed, { type: "chooseDestination" })).toMatchObject({
      stage: "station",
      line: null,
      routeFirst: false,
    });
  });

  it("路線を選んだあとや車内では、先に路線を選べない", () => {
    const picked = run([...toDestination, { type: "pickRoute", line: loop }]);
    expect(reduceEntry(picked, { type: "pickRoute", line })).toBe(picked);
    const train = run(toTrainDestination);
    expect(reduceEntry(train, { type: "pickRoute", line: loop })).toBe(train);
  });

  it("選び直しで路線の段に入ると、先に選んだ路線の流れを外す", () => {
    const cause = run([
      ...toDestination,
      { type: "pickRoute", line: loop },
      { type: "chooseDirection", direction: loopDirection },
      { type: "chooseDestination", onRoute: true },
    ]);
    const editing = reduceEntry(cause, { type: "editRoute" });
    expect(editing).toMatchObject({ stage: "station", routeFirst: false });
    const chosen = run(
      [
        { type: "chooseLine", line: loop },
        { type: "chooseDirection", direction: loopDirection },
      ],
      editing,
    );
    expect(chosen.stage).toBe("cause");
  });
});
