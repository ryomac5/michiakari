import type { Judgment, RouteOption } from "@repo/schema";
import { describe, expect, it } from "vitest";
import { selectSwitchStep } from "./switch-step";

const waitOption: RouteOption = {
  id: "wait_resume",
  kind: "wait",
  label: "JR京都線の再開を待つ",
  legs: [{ mode: "wait", from: "大阪", to: "大阪", minutes: 60 }],
  arrivalTime: "2026-11-06T00:40:00+09:00",
  fareYen: null,
  walkMinutes: 0,
  isTransferService: false,
};

const hankyuOption: RouteOption = {
  id: "transfer_hankyu",
  kind: "transfer",
  label: "阪急京都線で振替",
  legs: [
    { mode: "walk", from: "大阪", to: "大阪梅田", minutes: 9 },
    { mode: "wait", from: "大阪梅田", to: "大阪梅田", minutes: 4 },
    { mode: "ride", from: "大阪梅田", to: "京都河原町", minutes: 44, line: "阪急京都線" },
    { mode: "walk", from: "京都河原町", to: "京都", minutes: 20 },
  ],
  arrivalTime: "2026-11-06T00:14:00+09:00",
  fareYen: null,
  walkMinutes: 29,
  isTransferService: true,
};

const taxiOption: RouteOption = {
  id: "taxi",
  kind: "taxi",
  label: "タクシー",
  legs: [{ mode: "taxi", from: "大阪", to: "京都", minutes: 60 }],
  arrivalTime: "2026-11-05T23:50:00+09:00",
  fareYen: 15000,
  walkMinutes: 0,
  isTransferService: false,
};

function buildJudgment(overrides: Partial<Judgment>): Judgment {
  return {
    action: "switch",
    headline: "いま阪急京都線に切り替えてください。",
    breakEven: { time: "2026-11-05T22:46:00+09:00", explanation: "22時46分までに再開しなければ" },
    estimate: {
      eventType: "person_accident",
      phaseId: null,
      elapsedMinutes: 0,
      remaining: null,
      confidence: "medium",
    },
    options: [waitOption, hankyuOption, taxiOption],
    recommendedOptionId: "transfer_hankyu",
    evidence: [],
    disclaimer: "推定です。",
    ...overrides,
  };
}

describe("selectSwitchStep", () => {
  it("切り替えでは、最初に乗る路線と駅、そこまでの徒歩、到着を推奨の選択肢から取る", () => {
    expect(selectSwitchStep(buildJudgment({}))).toEqual({
      optionId: "transfer_hankyu",
      kind: "transfer",
      line: "阪急京都線",
      station: "大阪梅田",
      walkMinutes: 9,
      arrivalTime: "2026-11-06T00:14:00+09:00",
    });
  });

  it("タクシーでは路線と駅を持たない", () => {
    expect(selectSwitchStep(buildJudgment({ recommendedOptionId: "taxi" }))).toMatchObject({
      kind: "taxi",
      line: null,
      station: null,
      arrivalTime: "2026-11-05T23:50:00+09:00",
    });
  });

  it("待つときと、時刻まで待ってから切り替えるときは出さない", () => {
    expect(selectSwitchStep(buildJudgment({ action: "wait" }))).toBeNull();
    expect(selectSwitchStep(buildJudgment({ action: "hold" }))).toBeNull();
    expect(selectSwitchStep(null)).toBeNull();
  });

  it("推奨が待つ選択肢なら出さない", () => {
    expect(selectSwitchStep(buildJudgment({ recommendedOptionId: "wait_resume" }))).toBeNull();
  });
});
