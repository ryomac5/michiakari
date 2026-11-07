import { addMinutesToIso } from "@repo/core";
import type { JudgeRequest, Judgment, JudgmentEvent, Observation, TicketType } from "@repo/schema";
import { describe, expect, it } from "vitest";
import { createTestApp, postJudge } from "./helpers.ts";

// 乗車券の種類で、他社の線へ乗り換える選択肢の追加の費用が変わる
// 塚本の駅にいる人が JR 神戸線の見合わせで三ノ宮へ向かう判断で確かめる

const now = "2026-11-05T22:00:00+09:00";

function findJudgment(events: JudgmentEvent[]): Judgment {
  const ready = events.find((e) => e.type === "judgment_ready");
  if (ready?.type !== "judgment_ready") throw new Error("judgment_ready が届きません");
  return ready.judgment;
}

function buildObservation(transferServiceActive: boolean | null): Observation {
  return {
    id: "entry-line",
    observedAt: addMinutesToIso(now, -10),
    source: "selection",
    eventTypeCandidates: [],
    operator: "JR西日本",
    line: "JR神戸線",
    section: { fromStation: "大阪", toStation: "三ノ宮" },
    statedResumeTime: null,
    transferServiceActive,
    detectedSignals: [],
  };
}

function buildRequest(
  ticketType: TicketType | null,
  transferServiceActive: boolean | null = null,
): JudgeRequest {
  return {
    observations: [buildObservation(transferServiceActive)],
    newInput: { type: "selection", eventType: "person_accident", signalIds: [] },
    origin: { kind: "station", name: "塚本" },
    destination: { kind: "station", name: "三ノ宮" },
    constraints: { deadline: null, knowsAlternatives: true, mobilityNotes: null },
    language: "ja",
    now,
    ...(ticketType ? { ticketType } : {}),
  };
}

const app = createTestApp();

// 他社の線へ乗り換える選択肢の費用の印
function listFares(judgment: Judgment) {
  return judgment.options
    .filter((o) => o.kind === "transfer")
    .map((o) => o.transferFare)
    .filter((fare) => fare !== undefined);
}

describe("乗車券の種類と乗り換え先の費用", () => {
  it("定期券なら、他社の線への乗り換えは振替の対象になる", async () => {
    const judgment = findJudgment(await postJudge(app, buildRequest("commuter_pass")));
    const fares = listFares(judgment);
    expect(fares.length).toBeGreaterThan(0);
    expect(fares.every((fare) => fare === "covered")).toBe(true);
  });

  it("IC カードなら、他社の線への乗り換えに運賃がかかる", async () => {
    const judgment = findJudgment(await postJudge(app, buildRequest("ic")));
    const fares = listFares(judgment);
    expect(fares.length).toBeGreaterThan(0);
    expect(fares.every((fare) => fare === "fare_required")).toBe(true);
  });

  it("乗車券が分からなければ、費用の印を付けない", async () => {
    const judgment = findJudgment(await postJudge(app, buildRequest(null)));
    expect(listFares(judgment)).toEqual([]);
  });

  it("発表に振替輸送を行わないとあれば、定期券でも運賃がかかる", async () => {
    const judgment = findJudgment(await postJudge(app, buildRequest("commuter_pass", false)));
    const fares = listFares(judgment);
    expect(fares.length).toBeGreaterThan(0);
    expect(fares.every((fare) => fare === "fare_required")).toBe(true);
  });

  it("振替輸送の実施中なら、定期券は振替の対象で、IC カードは振替の選択肢でも運賃がかかる", async () => {
    const pass = findJudgment(await postJudge(app, buildRequest("commuter_pass", true)));
    const ic = findJudgment(await postJudge(app, buildRequest("ic", true)));
    const passPick = pass.options.find((o) => o.id === pass.recommendedOptionId);
    const icPick = ic.options.find((o) => o.id === ic.recommendedOptionId);
    expect(passPick?.isTransferService).toBe(true);
    expect(passPick?.transferFare).toBe("covered");
    expect(icPick?.isTransferService).toBe(true);
    expect(icPick?.transferFare).toBe("fare_required");
    expect(ic.headline).not.toContain("振替");
  });
});
