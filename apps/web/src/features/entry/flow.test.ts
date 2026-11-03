import { describe, expect, it } from "vitest";
import type { EntryArea, EntryLine, EntryPlace } from "./entry-places";
import {
  type EntryAction,
  type EntryState,
  initialEntryState,
  reduceEntry,
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

describe("reduceEntry", () => {
  it("関西からエリア・駅・行き先・入力の方法へ順に進む", () => {
    const state = run([
      { type: "openArea", area },
      { type: "openPlace", area, place },
      { type: "chooseLine", line },
      { type: "chooseDestination" },
      { type: "chooseMethod", method: "paste" },
    ]);
    expect(state).toMatchObject({ stage: "input", method: "paste", line, place, area });
  });

  it("戻る操作で 1 段ずつ引き、引いた段より先の選択は捨てる", () => {
    const filled = run([
      { type: "openPlace", area, place },
      { type: "chooseLine", line },
      { type: "chooseDestination" },
      { type: "chooseMethod", method: "photo" },
    ]);
    const stages = [];
    let state = filled;
    for (let i = 0; i < 5; i++) {
      state = reduceEntry(state, { type: "back" });
      stages.push(state.stage);
    }
    expect(stages).toEqual(["method", "destination", "station", "area", "kansai"]);
    expect(state).toEqual(initialEntryState);
    expect(run([{ type: "back" }, { type: "back" }, { type: "back" }], filled).line).toBeNull();
  });

  it("駅を選ぶ前に路線や行き先を選んでも進まない", () => {
    expect(run([{ type: "chooseLine", line }]).stage).toBe("kansai");
    expect(run([{ type: "openArea", area }, { type: "chooseDestination" }]).stage).toBe("area");
  });

  it("指定した深さまで一度に引ける。路線は駅の段、行き先は行き先の段まで引いて選び直す", () => {
    const filled = run([
      { type: "openPlace", area, place },
      { type: "chooseLine", line },
      { type: "chooseDestination" },
      { type: "chooseMethod", method: "paste" },
    ]);
    expect(stageDepth(filled.stage)).toBe(5);
    expect(reduceEntry(filled, { type: "backTo", depth: stageDepth("station") })).toMatchObject({
      stage: "station",
      line: null,
      method: null,
    });
    expect(reduceEntry(filled, { type: "backTo", depth: stageDepth("destination") })).toMatchObject(
      { stage: "destination", line, method: null },
    );
    expect(reduceEntry(filled, { type: "backTo", depth: 9 })).toBe(filled);
    expect(reduceEntry(filled, { type: "backTo", depth: -1 })).toEqual(initialEntryState);
  });
});
