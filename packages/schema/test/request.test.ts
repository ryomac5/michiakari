import { describe, expect, it } from "vitest";
import { JudgeRequestSchema, PlaceSchema, UserConstraintsSchema } from "../src/index.ts";
import { validJudgeRequest } from "./fixtures/api.ts";

describe("PlaceSchema", () => {
  it("駅名と座標を受け入れる", () => {
    expect(PlaceSchema.safeParse({ kind: "station", name: "甲駅" }).success).toBe(true);
    expect(PlaceSchema.safeParse({ kind: "coord", lon: 135.5, lat: 34.7 }).success).toBe(true);
  });

  it.each([
    { kind: "station", name: "" },
    { kind: "coord", lon: 200, lat: 34.7 },
    { kind: "coord", lon: 135.5, lat: -91 },
    { kind: "address", text: "未対応" },
  ])("%o を拒否する", (place) => {
    expect(PlaceSchema.safeParse(place).success).toBe(false);
  });
});

describe("UserConstraintsSchema", () => {
  it("deadline に null を許す", () => {
    const value = { deadline: null, knowsAlternatives: true, mobilityNotes: "大きな荷物" };
    expect(UserConstraintsSchema.safeParse(value).success).toBe(true);
  });

  it("HH:MM 形式の deadline を拒否する", () => {
    const value = { deadline: "23:45", knowsAlternatives: true, mobilityNotes: null };
    expect(UserConstraintsSchema.safeParse(value).success).toBe(false);
  });
});

describe("JudgeRequestSchema", () => {
  it("合格例を受け入れる", () => {
    expect(JudgeRequestSchema.safeParse(validJudgeRequest).success).toBe(true);
  });

  it("newInput に null を許す", () => {
    const value = { ...validJudgeRequest, newInput: null };
    expect(JudgeRequestSchema.safeParse(value).success).toBe(true);
  });

  it("未知の言語とオフセットのない now を拒否する", () => {
    expect(JudgeRequestSchema.safeParse({ ...validJudgeRequest, language: "zh" }).success).toBe(
      false,
    );
    expect(
      JudgeRequestSchema.safeParse({ ...validJudgeRequest, now: "2026-11-05T22:55:00" }).success,
    ).toBe(false);
  });

  it("observations 内の不正な観測を拒否する", () => {
    const value = { ...validJudgeRequest, observations: [{ id: "obs_1" }] };
    expect(JudgeRequestSchema.safeParse(value).success).toBe(false);
  });
});
