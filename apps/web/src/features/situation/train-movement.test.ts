import type { Observation, TrainPosition } from "@repo/schema";
import { describe, expect, it } from "vitest";
import { applyTrainMovement } from "./train-movement";

const position: TrainPosition = {
  kind: "between_stations",
  nextStation: "塚本",
  previousStation: "大阪",
  ownTrainType: "local",
  trainsAhead: ["local", "local", "local"],
  trainsAheadCount: null,
  trainsAheadHeadwayMinutes: 7.5,
};
const observation: Observation = {
  id: "photo",
  observedAt: "2026-11-05T22:00:00+09:00",
  source: "photo",
  kind: "train_movement",
  rawText: "",
  eventTypeCandidates: [],
  operator: null,
  line: null,
  section: null,
  statedResumeTime: null,
  transferServiceActive: null,
  detectedSignals: [],
};

describe("走行位置の読み取りの保持", () => {
  it.each([
    { trainsAhead: ["rapid", "local"] },
    { trainsAhead: ["unknown"] },
    { trainsAhead: [] },
  ] as const)("読み取った並び %j を反映し、既定の本数と間隔を外す", ({ trainsAhead: types }) => {
    const trainsAhead = [...types];
    const updated = applyTrainMovement(position, { ...observation, trainsAhead });
    expect(updated).toEqual({
      ...position,
      trainsAhead,
      trainsAheadCount: null,
      trainsAheadHeadwayMinutes: null,
    });
    expect(applyTrainMovement(updated, observation)).toBe(updated);
    expect(position.trainsAheadHeadwayMinutes).toBe(7.5);
  });

  it("種別のない観測では手直しした並びを変えない", () => {
    expect(applyTrainMovement(position, observation)).toBe(position);
  });

  it("駅にいる人の位置と、未設定の位置は変えない", () => {
    const atStation = { ...position, kind: "at_station" as const };
    const photo = { ...observation, trainsAhead: ["rapid" as const] };
    expect(applyTrainMovement(atStation, photo)).toBe(atStation);
    expect(applyTrainMovement(null, photo)).toBeNull();
  });
});
