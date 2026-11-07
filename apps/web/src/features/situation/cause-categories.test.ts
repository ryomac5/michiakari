import { readFileSync } from "node:fs";
import { join } from "node:path";
import { INCIDENT_GROUP_IDS, INCIDENT_TYPE_IDS, resolveIncidentDuration } from "@repo/core";
import { findRepoRoot } from "@repo/schema/loaders";
import { describe, expect, it } from "vitest";
import {
  type CauseCategoryId,
  type CauseChoiceId,
  type CauseKindId,
  causeCategoryIds,
  causeChoiceIds,
  listCauseKinds,
  needsCauseKind,
  resolveCauseIncidentType,
  resolveIncidentCause,
  toCauseAnswer,
  toCauseChoiceId,
} from "./cause-categories";

const root = findRepoRoot();

const taxonomy = JSON.parse(
  readFileSync(join(root, "docs/research/rail-suspensions/taxonomy.json"), "utf8"),
) as { groups: { id: string }[]; types: { group_id: string }[] };

describe("causeCategoryIds", () => {
  it("調査の分類の 8 大分類と同じ id を持つ", () => {
    expect([...causeCategoryIds].sort()).toEqual(taxonomy.groups.map((g) => g.id).sort());
  });
});

describe("resolveCauseIncidentType", () => {
  const expected: Record<Exclude<CauseCategoryId, "passenger" | "weather">, string | null> = {
    vehicle: "vehicle_failure",
    signaling: null,
    power: null,
    obstruction: null,
    infrastructure: null,
    major_accident: null,
  };
  for (const [category, incidentType] of Object.entries(expected)) {
    it(`${category} は ${incidentType ?? "種類なし"} に対応する`, () => {
      const id = category as CauseCategoryId;
      expect(needsCauseKind(id)).toBe(false);
      expect(resolveCauseIncidentType({ category: id, kind: null })).toBe(incidentType);
    });
  }

  it("人身事故と車内の急病人は別の選択肢で、それぞれの種類に対応し、種類を続けて聞かない", () => {
    expect(causeChoiceIds.slice(0, 2)).toEqual(["person", "inCar"]);
    expect(needsCauseKind("passenger")).toBe(false);
    const resolve = (choice: CauseChoiceId) => resolveCauseIncidentType(toCauseAnswer(choice));
    expect(resolve("person")).toBe("person_collision");
    expect(resolve("inCar")).toBe("medical_response");
    expect(toCauseAnswer("person")).toEqual({ category: "passenger", kind: "person" });
    expect(toCauseAnswer("inCar")).toEqual({ category: "passenger", kind: "inCar" });
    // 選択肢に無い人・旅客対応は、分からないと同じ種類なしになる
    expect(resolveCauseIncidentType({ category: "passenger", kind: "other" })).toBeNull();
    expect(resolveCauseIncidentType({ category: "passenger", kind: null })).toBeNull();
  });

  it("選択肢と答えは行き来でき、選択肢は人・旅客対応を除く大分類をすべて含む", () => {
    for (const choice of causeChoiceIds) {
      expect(toCauseChoiceId(toCauseAnswer(choice))).toBe(choice);
    }
    expect(toCauseChoiceId({ category: null, kind: null })).toBeNull();
    const categories = causeChoiceIds.map((c) => toCauseAnswer(c).category);
    expect(new Set(categories)).toEqual(new Set(causeCategoryIds));
  });

  it("気象・自然は種類を聞き、その他を除く種類がそれぞれの種類に対応する", () => {
    expect(needsCauseKind("weather")).toBe(true);
    const kinds = listCauseKinds("weather");
    expect(kinds).toEqual(["rain", "wind", "snow", "lightning", "earthquake", "other"]);
    // その他を除く種類は、調査の分類の気象・自然の種類と同じ数にする
    expect(kinds.length - 1).toBe(taxonomy.types.filter((t) => t.group_id === "weather").length);
    const resolve = (kind: CauseKindId) => resolveCauseIncidentType({ category: "weather", kind });
    expect(resolve("rain")).toBe("heavy_rain");
    expect(resolve("wind")).toBe("strong_wind");
    expect(resolve("snow")).toBe("snow_ice");
    expect(resolve("lightning")).toBe("lightning");
    expect(resolve("earthquake")).toBe("earthquake");
    expect(resolve("other")).toBeNull();
  });

  it("分からないは種類なしになる", () => {
    expect(resolveCauseIncidentType(null)).toBeNull();
    expect(resolveCauseIncidentType({ category: null, kind: null })).toBeNull();
  });

  it("返す種類は、すべて統計値にある id", () => {
    for (const choice of causeChoiceIds) {
      const type = resolveCauseIncidentType(toCauseAnswer(choice));
      if (type) expect(INCIDENT_TYPE_IDS).toContain(type);
    }
  });
});

describe("resolveIncidentCause", () => {
  it("選択肢を統計値の大分類と種類にする。種類を聞かない大分類は種類を null にする", () => {
    const resolve = (choice: CauseChoiceId) => resolveIncidentCause(toCauseAnswer(choice));
    expect(resolve("person")).toEqual({ group: "passenger", type: "person_collision" });
    expect(resolve("inCar")).toEqual({ group: "passenger", type: "medical_response" });
    expect(resolve("signaling")).toEqual({ group: "signaling", type: null });
    expect(resolveIncidentCause({ category: "weather", kind: "wind" })).toEqual({
      group: "weather",
      type: "strong_wind",
    });
    expect(resolveIncidentCause({ category: "weather", kind: "other" })).toEqual({
      group: "weather",
      type: null,
    });
    expect(resolveIncidentCause(null)).toBeNull();
    expect(resolveIncidentCause({ category: null, kind: null })).toBeNull();
  });

  it("送る大分類と種類は、すべて統計値にある id", () => {
    const answers = [
      ...causeChoiceIds.map(toCauseAnswer),
      ...listCauseKinds("weather").map((kind) => ({ category: "weather" as const, kind })),
    ];
    for (const answer of answers) {
      const cause = resolveIncidentCause(answer);
      expect(INCIDENT_GROUP_IDS).toContain(cause?.group);
      if (cause?.type) expect(INCIDENT_TYPE_IDS).toContain(cause.type);
    }
  });

  // 見込みの出どころは、種類が決まれば規則、無ければ統計値、統計値も無ければなし
  it("種類の決まる答えは規則、ほかの大分類は統計値、分からないはなし", () => {
    const stoppedAt = "2026-11-06T12:00:00+09:00";
    const decideSource = (answer: Parameters<typeof resolveIncidentCause>[0]) => {
      if (resolveCauseIncidentType(answer)) return "rule";
      const cause = resolveIncidentCause(answer);
      return cause && resolveIncidentDuration(cause, stoppedAt) ? "statistics" : "none";
    };
    const sources = Object.fromEntries(
      causeChoiceIds.map((choice) => [choice, decideSource(toCauseAnswer(choice))]),
    );
    expect(sources).toEqual({
      person: "rule",
      inCar: "rule",
      vehicle: "rule",
      signaling: "statistics",
      power: "statistics",
      obstruction: "statistics",
      infrastructure: "statistics",
      weather: "statistics",
      major_accident: "statistics",
    });
    expect(decideSource({ category: "weather", kind: "rain" })).toBe("rule");
    expect(decideSource({ category: "weather", kind: "other" })).toBe("statistics");
    expect(decideSource(null)).toBe("none");
  });
});
