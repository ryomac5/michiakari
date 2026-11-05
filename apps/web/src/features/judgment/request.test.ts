import { JudgeRequestSchema } from "@repo/schema";
import { describe, expect, it } from "vitest";
import { buildPersonAccidentEvents } from "./fixtures/person-accident";
import { buildJudgeRequest, defaultConstraints } from "./request";

describe("buildJudgeRequest", () => {
  const observation = buildPersonAccidentEvents(
    buildJudgeRequest({
      observations: [],
      newInput: { type: "text", text: "架空の発表文" },
      origin: { kind: "station", name: "大阪" },
      destination: { kind: "station", name: "三ノ宮" },
      language: "ja",
      now: new Date(),
    }),
  ).find((e) => e.type === "observation_parsed");

  it("受け取った観測を observations に入れて返送し、now は端末の時刻にする", () => {
    if (observation?.type !== "observation_parsed") throw new Error("fixture が不正です");
    const now = new Date("2026-11-05T13:40:05Z");
    const request = buildJudgeRequest({
      observations: [observation.observation],
      newInput: null,
      origin: { kind: "coord", lat: 34.7, lon: 135.5 },
      destination: { kind: "station", name: "三ノ宮" },
      language: "en",
      now,
    });

    expect(JudgeRequestSchema.safeParse(request).success).toBe(true);
    expect(request.observations).toEqual([observation.observation]);
    expect(request.constraints).toEqual(defaultConstraints);
    expect(Date.parse(request.now)).toBe(now.getTime());
    expect(request.now).toMatch(/[+-]\d{2}:\d{2}$/);
  });

  it("スキーマに合わない地点は送る前に例外にする", () => {
    expect(() =>
      buildJudgeRequest({
        observations: [],
        newInput: null,
        origin: { kind: "station", name: "" },
        destination: { kind: "station", name: "三ノ宮" },
        language: "ja",
        now: new Date(),
      }),
    ).toThrow();
  });
});
