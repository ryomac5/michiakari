import { ObservationSchema } from "@repo/schema";
import { describe, expect, it } from "vitest";
import { buildLineObservation } from "@/features/entry/seed";
import { buildJudgeRequest } from "@/features/judgment/request";
import {
  type AddedAnswers,
  applyAddedAnswers,
  buildCauseInput,
  emptyAddedAnswers,
  resolveAnswerRequestValues,
  sectionObservationId,
} from "./added-answers";
import { protectionObservationId } from "./protection-broadcast";

const line = {
  key: "大阪|jr-west.東海道線|JR神戸線",
  lineId: "jr-west.東海道線",
  stationName: "大阪",
  observedName: "JR神戸線",
  name: { ja: "JR神戸線", en: "JR Kobe Line" },
  operator: { ja: "JR西日本", en: "JR West" },
  color: "#0072BC",
};
const entryAt = new Date("2026-11-07T19:00:00+09:00");
const now = new Date("2026-11-07T19:05:00+09:00");
const seed = [buildLineObservation(line, entryAt)];

function apply(patch: Partial<AddedAnswers>, base = seed) {
  return applyAddedAnswers(base, { ...emptyAddedAnswers, ...patch }, patch, now);
}

describe("applyAddedAnswers", () => {
  it("止まってからの分は、路線の観測を見た時刻をその分だけ前にする", () => {
    const [observed] = apply({ elapsed: "m10" });
    expect(observed?.observedAt).toBe("2026-11-07T18:55:00+09:00");
  });

  it("ほかの答えを足しても、前に映した止まってからの分はずらさない", () => {
    const elapsed = apply({ elapsed: "m10" });
    const next = applyAddedAnswers(
      elapsed,
      { ...emptyAddedAnswers, elapsed: "m10", ticket: "ic" },
      { ticket: "ic" },
      new Date("2026-11-07T19:20:00+09:00"),
    );
    expect(next[0]?.observedAt).toBe("2026-11-07T18:55:00+09:00");
  });

  it("再開見込みの時刻は路線の観測に載せ、言っていないなら外す", () => {
    const stated = apply({ resume: { id: "stated", iso: "2026-11-07T19:30:00+09:00" } });
    expect(stated[0]?.statedResumeTime).toBe("2026-11-07T19:30:00+09:00");
    const cleared = applyAddedAnswers(
      stated,
      { ...emptyAddedAnswers, resume: { id: "unknown", iso: null } },
      { resume: { id: "unknown", iso: null } },
      now,
    );
    expect(cleared[0]?.statedResumeTime).toBeNull();
  });

  it("受信の放送を聞いたなら放送の観測を足し、なかったに直すと外す", () => {
    const heard = apply({ protection: "heard" });
    expect(heard.map((o) => o.id)).toEqual([seed[0]?.id, protectionObservationId]);
    const notHeard = applyAddedAnswers(
      heard,
      { ...emptyAddedAnswers, protection: "notHeard" },
      { protection: "notHeard" },
      now,
    );
    expect(notHeard.map((o) => o.id)).toEqual([seed[0]?.id]);
  });

  it("区間は路線の観測と同じ路線の、止まっている区間の観測にする", () => {
    const added = apply({ section: { fromStation: "大阪", toStation: "尼崎" } });
    const section = added.find((o) => o.id === sectionObservationId);
    expect(section && ObservationSchema.parse(section)).toEqual(section);
    expect(section).toMatchObject({
      source: "selection",
      line: "JR神戸線",
      operator: "JR西日本",
      section: { fromStation: "大阪", toStation: "尼崎" },
    });
  });

  it("原因を選び直すと、前に選んだ原因だけの観測を外す", () => {
    const chosen = {
      ...seed[0],
      id: "obs-1",
      eventTypeCandidates: [{ eventType: "person_collision", confidence: "high" as const }],
    } as (typeof seed)[number];
    const next = apply({ cause: { category: "vehicle", kind: null } }, [...seed, chosen]);
    expect(next.map((o) => o.id)).toEqual([seed[0]?.id]);
  });
});

describe("resolveAnswerRequestValues", () => {
  it("なかったと答えた受信の放送は not_heard として送り、放送の観測は入れない", () => {
    const answers = { ...emptyAddedAnswers, protection: "notHeard" as const };
    const values = resolveAnswerRequestValues(answers);
    const request = buildJudgeRequest({
      observations: applyAddedAnswers([], answers, { protection: "notHeard" }, now),
      newInput: null,
      origin: { kind: "station", name: "大阪" },
      destination: { kind: "station", name: "三ノ宮" },
      language: "ja",
      now,
      protectionBroadcast: values.protectionBroadcast,
    });
    expect(request.protectionBroadcast).toBe("not_heard");
    expect(request.observations).toEqual([]);
  });

  it("原因は統計の大分類と種類に、乗車券は分からないなら送らない", () => {
    expect(
      resolveAnswerRequestValues({
        ...emptyAddedAnswers,
        cause: { category: "weather", kind: "rain" },
        ticket: "unknown",
      }),
    ).toEqual({
      cause: { group: "weather", type: "heavy_rain" },
      protectionBroadcast: null,
      ticketType: null,
    });
  });
});

describe("buildCauseInput", () => {
  it("種類の決まる原因だけ、選択の入力にする", () => {
    expect(buildCauseInput({ category: "passenger", kind: "person" })).toEqual({
      type: "selection",
      eventType: "person_collision",
      signalIds: [],
    });
    expect(buildCauseInput({ category: "signaling", kind: null })).toBeNull();
  });
});
