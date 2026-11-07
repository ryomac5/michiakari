import type { Observation } from "@repo/schema";
import { describe, expect, it } from "vitest";
import {
  buildCueInput,
  listAddableItems,
  listAddInfoCues,
  listAnsweredItems,
  resolveKnownCause,
  selectAddInfoChoices,
  toCauseAnswerFromEventType,
} from "./add-info";
import { emptyAddedAnswers } from "./added-answers";

function buildObservation(overrides: Partial<Observation>): Observation {
  return {
    id: "o1",
    observedAt: "2026-11-07T19:00:00+09:00",
    source: "text",
    eventTypeCandidates: [],
    operator: null,
    line: null,
    section: null,
    statedResumeTime: null,
    transferServiceActive: null,
    detectedSignals: [],
    ...overrides,
  };
}

const announced = buildObservation({
  eventTypeCandidates: [{ eventType: "person_collision", confidence: "high" }],
});

describe("selectAddInfoChoices", () => {
  it("原因が決まっていなければ、原因の選択肢を最初に出す", () => {
    const known = resolveKnownCause({ answeredCause: null, observations: [] });
    expect(known).toBeNull();
    expect(selectAddInfoChoices(known, false)).toEqual({ kind: "cause" });
  });

  it("入口で答えた原因があれば、原因の代わりに放送の手がかりを出す", () => {
    const known = resolveKnownCause({
      answeredCause: { category: "passenger", kind: "person" },
      observations: [],
    });
    const choices = selectAddInfoChoices(known, false);
    expect(choices.kind).toBe("cues");
    if (choices.kind !== "cues") return;
    expect(choices.cause).toEqual({
      eventType: "person_collision",
      label: { scope: "causes", id: "person" },
    });
    expect(choices.cues).toEqual(listAddInfoCues(false));
  });

  it("発表から読み取れた原因があれば、原因の選択肢を出さない", () => {
    const known = resolveKnownCause({ answeredCause: null, observations: [announced] });
    expect(known?.label).toEqual({ scope: "causes", id: "person" });
    expect(selectAddInfoChoices(known, true).kind).toBe("cues");
  });

  it("車内では次の駅まで進むと線路に降りる案内、駅では折り返し運転を手がかりに出す", () => {
    expect(listAddInfoCues(true)).toEqual(
      expect.arrayContaining(["proceed_to_station", "evacuation_on_track"]),
    );
    expect(listAddInfoCues(true)).not.toContain("turnback");
    expect(listAddInfoCues(false)).toContain("turnback");
    expect(listAddInfoCues(false)).not.toContain("evacuation_on_track");
  });
});

describe("resolveKnownCause", () => {
  it("答えた原因を、発表から読んだ原因より先に使う", () => {
    const known = resolveKnownCause({
      answeredCause: { category: "vehicle", kind: null },
      observations: [announced],
    });
    expect(known).toEqual({
      eventType: "vehicle_failure",
      label: { scope: "causes", id: "vehicle" },
    });
  });

  it("天気は種類まで分かれば種類の名前、種類の決まらない大分類はその大分類の id を送る", () => {
    expect(
      resolveKnownCause({ answeredCause: { category: "weather", kind: "rain" }, observations: [] }),
    ).toEqual({ eventType: "heavy_rain", label: { scope: "causeKinds", id: "rain" } });
    expect(
      resolveKnownCause({ answeredCause: { category: "signaling", kind: null }, observations: [] }),
    ).toEqual({ eventType: "signaling", label: { scope: "causes", id: "signaling" } });
  });

  it("選択肢に無い種類だけが読めたときは、原因が決まっていないとみなす", () => {
    const intrusion = buildObservation({
      eventTypeCandidates: [{ eventType: "track_intrusion", confidence: "high" }],
    });
    expect(resolveKnownCause({ answeredCause: null, observations: [intrusion] })).toBeNull();
  });
});

describe("toCauseAnswerFromEventType", () => {
  it("種類の id、知見の事象の id、大分類の id を入口の答えの形にする", () => {
    expect(toCauseAnswerFromEventType("medical_response")).toEqual({
      category: "passenger",
      kind: "inCar",
    });
    expect(toCauseAnswerFromEventType("person_accident")).toEqual({
      category: "passenger",
      kind: "person",
    });
    expect(toCauseAnswerFromEventType("signal_failure")).toEqual({
      category: "signaling",
      kind: null,
    });
    expect(toCauseAnswerFromEventType("power")).toEqual({ category: "power", kind: null });
    expect(toCauseAnswerFromEventType("unknown_event")).toBeNull();
  });
});

describe("listAddableItems", () => {
  it("受信の放送は車内の人だけ、区間は路線が分かるときだけ、答えた項目は除いて並べる", () => {
    expect(listAddableItems({ answers: emptyAddedAnswers, onTrain: false, hasLine: true })).toEqual(
      ["resume", "elapsed", "section", "ticket"],
    );
    expect(listAddableItems({ answers: emptyAddedAnswers, onTrain: true, hasLine: false })).toEqual(
      ["resume", "elapsed", "protection", "ticket"],
    );
    const answers = { ...emptyAddedAnswers, elapsed: "m10" as const, ticket: "ic" as const };
    expect(listAddableItems({ answers, onTrain: false, hasLine: true })).toEqual([
      "resume",
      "section",
    ]);
    expect(listAnsweredItems(answers)).toEqual(["elapsed", "ticket"]);
  });
});

describe("buildCueInput", () => {
  it("手がかりを、決まっている原因の選択の入力にする", () => {
    expect(
      buildCueInput(
        { eventType: "person_collision", label: { scope: "causes", id: "person" } },
        "resumed",
      ),
    ).toEqual({ type: "selection", eventType: "person_collision", signalIds: ["resumed"] });
  });
});
