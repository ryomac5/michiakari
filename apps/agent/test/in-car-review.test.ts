import { addMinutesToIso, diffMinutes } from "@repo/core";
import type { JudgeRequest, Judgment, JudgmentEvent } from "@repo/schema";
import { describe, expect, it } from "vitest";
import { createGeoProvider } from "../src/alternatives/geo-provider.ts";
import type { AlternativesQuery } from "../src/alternatives/provider.ts";
import { createTestApp, postJudge } from "./helpers.ts";

// 駅間の車内の判断のレビューで見つかった食い違いを固定する

const provider = createGeoProvider();
const app = createTestApp();
const now = "2026-11-05T22:00:00+09:00";

function findJudgment(events: JudgmentEvent[]): Judgment {
  const ready = events.find((e) => e.type === "judgment_ready");
  if (ready?.type !== "judgment_ready") throw new Error("judgment_ready が届きません");
  return ready.judgment;
}

describe("駅間の車内の待つ側の到着", () => {
  const base: AlternativesQuery = {
    origin: { kind: "station", name: "塚本" },
    destination: { kind: "station", name: "西宮北口" },
    blockedLine: "JR神戸線",
    blockedSection: { fromStation: "大阪", toStation: "西宮北口" },
    blockedSectionFromTrain: true,
    now,
    remaining: { p50: 0, p80: 10 },
    transferServiceActive: null,
    language: "ja",
  };

  it("待つ側も、降りる駅に着く見込みの時刻を起点にする", async () => {
    const departureTime = addMinutesToIso(now, 30);
    const result = await provider.findAlternatives({ ...base, departureTime });
    const wait = result.options.find((o) => o.kind === "wait");
    const route = result.waitRouteMinutesAfterResume ?? 0;
    expect(route).toBeGreaterThan(0);
    // 再開の見込みより降りる駅に着くほうが遅いので、着く時刻から乗り続ける
    expect(diffMinutes(departureTime, wait?.arrivalTime ?? now)).toBe(route);
  });
});

describe("止まった区間の延長", () => {
  it("駅にいる人の区間は、終わりが別の路線の駅でも延ばさない。区間が無いときと同じ代替手段になる", async () => {
    const atStation: AlternativesQuery = {
      origin: { kind: "station", name: "塚本" },
      destination: { kind: "station", name: "西宮北口" },
      blockedLine: "JR神戸線",
      blockedSection: { fromStation: "大阪", toStation: "西宮北口" },
      now,
      remaining: { p50: 60, p80: 90 },
      transferServiceActive: null,
      language: "ja",
    };
    const withSection = await provider.findAlternatives(atStation);
    const withoutSection = await provider.findAlternatives({ ...atStation, blockedSection: null });
    expect(withSection.options).toEqual(withoutSection.options);
  });
});

describe("次の駅が分からない駅間の車内", () => {
  it("次の駅が分からなくても、車内で待つ形にし、選択肢を出さない", async () => {
    const request: JudgeRequest = {
      observations: [
        {
          id: "entry-line",
          observedAt: addMinutesToIso(now, -10),
          source: "selection",
          eventTypeCandidates: [],
          operator: "JR西日本",
          line: "JR神戸線",
          section: null,
          statedResumeTime: null,
          transferServiceActive: null,
          detectedSignals: [],
        },
      ],
      newInput: { type: "selection", eventType: "person_accident", signalIds: [] },
      origin: { kind: "station", name: "塚本" },
      destination: { kind: "station", name: "三ノ宮" },
      constraints: { deadline: null, knowsAlternatives: true, mobilityNotes: null },
      language: "ja",
      now,
      trainPosition: {
        kind: "between_stations",
        nextStation: null,
        previousStation: null,
        trainsAhead: null,
        trainsAheadCount: null,
        ownTrainType: null,
      },
    };
    const judgment = findJudgment(await postJudge(app, request));
    expect(judgment.action).toBe("wait");
    expect(judgment.options).toEqual([]);
    expect(judgment.breakEven).toBeNull();
    expect(judgment.headline).toBe("車内で待つ");
    expect(judgment.inCar?.alightStation).toBeNull();
    expect(judgment.inCar?.afterAlight).toBeNull();
    expect(judgment.inCar?.staffNote).toBe("長く止まったときは係員の案内に従う。");
  });
});
