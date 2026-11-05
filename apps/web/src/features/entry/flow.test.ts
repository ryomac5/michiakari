import { describe, expect, it } from "vitest";
import type { EntryArea, EntryLine, EntryPlace } from "./entry-places";
import {
  type EntryAction,
  type EntryState,
  initialEntryState,
  reduceEntry,
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
  { type: "openPlace", area, place },
  { type: "chooseLine", line },
  { type: "chooseDirection", direction },
  { type: "chooseDestination" },
  { type: "choosePosition" },
];

describe("reduceEntry", () => {
  it("関西からエリア・駅・方面・行き先・いまどこ・原因へ順に進み、撮る・貼るは入力の段へ横に入る", () => {
    const cause = run([{ type: "openArea", area }, ...toCause]);
    expect(cause).toMatchObject({ stage: "cause", line, place, area, direction, method: null });
    expect(reduceEntry(cause, { type: "chooseMethod", method: "paste" })).toMatchObject({
      stage: "input",
      method: "paste",
    });
  });

  it("原因・経過・再開見込みの順に進み、原因の段でなければ原因の答えを受け付けない", () => {
    const cause = run(toCause);
    const elapsed = reduceEntry(cause, { type: "chooseCause", cause: { eventType: null } });
    expect(elapsed).toMatchObject({ stage: "elapsed", cause: { eventType: null }, elapsed: null });
    expect(reduceEntry(elapsed, { type: "chooseElapsed", elapsed: "m10" })).toMatchObject({
      stage: "resume",
      elapsed: "m10",
    });
    const paste = reduceEntry(cause, { type: "chooseMethod", method: "paste" });
    expect(reduceEntry(paste, { type: "chooseCause", cause: { eventType: null } })).toBe(paste);
    expect(reduceEntry(cause, { type: "chooseElapsed", elapsed: "now" })).toBe(cause);
  });

  it("戻る操作で 1 段ずつ引き、引いた段より先の選択は捨てる", () => {
    const filled = run([
      ...toCause,
      { type: "chooseCause", cause: { eventType: "person_accident" } },
      { type: "chooseElapsed", elapsed: "m30" },
    ]);
    const stages = [];
    let state = filled;
    for (let i = 0; i < 8; i++) {
      state = reduceEntry(state, { type: "back" });
      stages.push(state.stage);
    }
    expect(stages).toEqual([
      "elapsed",
      "cause",
      "position",
      "destination",
      "direction",
      "station",
      "area",
      "kansai",
    ]);
    expect(state).toEqual(initialEntryState);
    expect(run([{ type: "back" }], filled)).toMatchObject({
      cause: { eventType: "person_accident" },
      elapsed: null,
    });
    expect(run([{ type: "back" }, { type: "back" }], filled).cause).toBeNull();
    // 撮る・貼るの入力から戻ると原因の段に戻る
    const paste = run([...toCause, { type: "chooseMethod", method: "photo" }]);
    expect(reduceEntry(paste, { type: "back" })).toMatchObject({ stage: "cause", method: null });
  });

  it("方面が 1 つだけなら方面の段を飛ばし、戻るときも駅の段まで引く", () => {
    const state = run([
      { type: "openPlace", area, place },
      { type: "chooseLine", line, autoDirection: direction },
    ]);
    expect(state).toMatchObject({ stage: "destination", direction, directionAuto: true });
    expect(reduceEntry(state, { type: "back" })).toMatchObject({
      stage: "station",
      line: null,
      direction: null,
    });
    // 端末の履歴は方面の深さも積むので、その深さまで引いても駅の段に戻る
    expect(reduceEntry(state, { type: "backTo", depth: stageDepth("direction") }).stage).toBe(
      "station",
    );
  });

  it("駅を選ぶ前に路線や行き先を選んでも進まない", () => {
    expect(run([{ type: "chooseLine", line }]).stage).toBe("kansai");
    expect(run([{ type: "openArea", area }, { type: "chooseDestination" }]).stage).toBe("area");
    expect(
      run([
        { type: "openPlace", area, place },
        { type: "chooseLine", line },
        { type: "chooseDestination" },
      ]).stage,
    ).toBe("direction");
  });

  it("指定した深さまで一度に引ける。路線は駅の段、行き先は行き先の段まで引いて選び直す", () => {
    const filled = run([...toCause, { type: "chooseMethod", method: "paste" }]);
    expect(stageDepth(filled.stage)).toBe(7);
    expect(reduceEntry(filled, { type: "backTo", depth: stageDepth("station") })).toMatchObject({
      stage: "station",
      line: null,
      direction: null,
      method: null,
    });
    expect(reduceEntry(filled, { type: "backTo", depth: stageDepth("destination") })).toMatchObject(
      { stage: "destination", line, direction, method: null },
    );
    expect(reduceEntry(filled, { type: "backTo", depth: 12 })).toBe(filled);
    expect(reduceEntry(filled, { type: "backTo", depth: -1 })).toEqual(initialEntryState);
    // 再開見込みの段から経過の深さまで引くと経過の段、原因の深さまで引くと原因の段に戻る
    const resume = run([
      ...toCause,
      { type: "chooseCause", cause: { eventType: null } },
      { type: "chooseElapsed", elapsed: "unknown" },
    ]);
    expect(stageDepth(resume.stage)).toBe(8);
    expect(reduceEntry(resume, { type: "backTo", depth: stageDepth("elapsed") }).stage).toBe(
      "elapsed",
    );
    expect(reduceEntry(resume, { type: "backTo", depth: stageDepth("cause") })).toMatchObject({
      stage: "cause",
      cause: null,
      elapsed: null,
    });
  });
});

describe("selectProgressIndex", () => {
  it("路線から様子までを 5 つの印に割り当てる", () => {
    expect(
      (
        [
          "station",
          "direction",
          "destination",
          "position",
          "cause",
          "input",
          "elapsed",
          "resume",
        ] as const
      ).map(selectProgressIndex),
    ).toEqual([0, 1, 2, 3, 4, 4, 4, 4]);
    expect(selectProgressIndex("area")).toBeLessThan(0);
  });
});
