import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { findRepoRoot } from "@repo/schema/loaders";
import { describe, expect, it } from "vitest";
import type { KnowledgeCatalog } from "@/features/knowledge/catalog";
import {
  type CauseCategoryId,
  type CauseChoiceId,
  type CauseKindId,
  causeCategoryIds,
  causeChoiceIds,
  listCauseKinds,
  needsCauseKind,
  resolveCauseEventType,
  toCauseAnswer,
  toCauseChoiceId,
} from "./cause-categories";

// 大分類と知見の事象の対応を、ダミー知見の 4 事象で確かめる（読むだけで変更しない）
const root = findRepoRoot();
const devKnowledgeDir = join(root, "packages/schema/test/fixtures/dev-content/knowledge");
const devCatalog: KnowledgeCatalog = readdirSync(devKnowledgeDir)
  .filter((f) => f.endsWith(".yaml"))
  .map((f) => ({ id: f.replace(/\.yaml$/, ""), name: { ja: f }, phases: [] }));

const taxonomy = JSON.parse(
  readFileSync(join(root, "docs/research/rail-suspensions/taxonomy.json"), "utf8"),
) as { groups: { id: string }[]; types: { group_id: string }[] };

describe("causeCategoryIds", () => {
  it("調査の分類の 8 大分類と同じ id を持つ", () => {
    expect([...causeCategoryIds].sort()).toEqual(taxonomy.groups.map((g) => g.id).sort());
  });
});

describe("resolveCauseEventType", () => {
  it("ダミー知見は人身事故、大雨、車両故障、車内対応の 4 事象", () => {
    expect(devCatalog.map((e) => e.id).sort()).toEqual([
      "heavy_rain",
      "in_car_response",
      "person_accident",
      "vehicle_failure",
    ]);
  });

  const expected: Record<Exclude<CauseCategoryId, "passenger" | "weather">, string | null> = {
    vehicle: "vehicle_failure",
    signaling: null,
    power: null,
    obstruction: null,
    infrastructure: null,
    major_accident: null,
  };
  for (const [category, eventType] of Object.entries(expected)) {
    it(`${category} は ${eventType ?? "知見なし"} に対応する`, () => {
      const id = category as CauseCategoryId;
      expect(needsCauseKind(id)).toBe(false);
      expect(resolveCauseEventType({ category: id, kind: null }, devCatalog)).toBe(eventType);
    });
  }

  it("人身事故と車内の急病人は別の選択肢で、それぞれの知見に対応し、種類を続けて聞かない", () => {
    expect(causeChoiceIds.slice(0, 2)).toEqual(["person", "inCar"]);
    expect(needsCauseKind("passenger")).toBe(false);
    const resolve = (choice: CauseChoiceId) =>
      resolveCauseEventType(toCauseAnswer(choice), devCatalog);
    expect(resolve("person")).toBe("person_accident");
    expect(resolve("inCar")).toBe("in_car_response");
    expect(toCauseAnswer("person")).toEqual({ category: "passenger", kind: "person" });
    expect(toCauseAnswer("inCar")).toEqual({ category: "passenger", kind: "inCar" });
    // 選択肢に無い人・旅客対応は、分からないと同じ知見なしになる
    expect(resolveCauseEventType({ category: "passenger", kind: "other" }, devCatalog)).toBeNull();
    expect(resolveCauseEventType({ category: "passenger", kind: null }, devCatalog)).toBeNull();
  });

  it("選択肢と答えは行き来でき、選択肢は人・旅客対応を除く大分類をすべて含む", () => {
    for (const choice of causeChoiceIds) {
      expect(toCauseChoiceId(toCauseAnswer(choice))).toBe(choice);
    }
    expect(toCauseChoiceId({ category: null, kind: null })).toBeNull();
    const categories = causeChoiceIds.map((c) => toCauseAnswer(c).category);
    expect(new Set(categories)).toEqual(new Set(causeCategoryIds));
  });

  it("気象・自然は種類を聞き、雨だけが大雨の事象に対応する", () => {
    expect(needsCauseKind("weather")).toBe(true);
    const kinds = listCauseKinds("weather");
    expect(kinds).toEqual(["rain", "wind", "snow", "lightning", "earthquake", "other"]);
    // その他を除く種類は、調査の分類の気象・自然の種類と同じ数にする
    expect(kinds.length - 1).toBe(taxonomy.types.filter((t) => t.group_id === "weather").length);
    const resolve = (kind: CauseKindId) =>
      resolveCauseEventType({ category: "weather", kind }, devCatalog);
    expect(resolve("rain")).toBe("heavy_rain");
    for (const kind of ["wind", "snow", "lightning", "earthquake", "other"] as const) {
      expect(resolve(kind)).toBeNull();
    }
  });

  it("分からないと、知見に無い事象は知見なしになる", () => {
    expect(resolveCauseEventType(null, devCatalog)).toBeNull();
    expect(resolveCauseEventType({ category: null, kind: null }, devCatalog)).toBeNull();
    expect(resolveCauseEventType({ category: "vehicle", kind: null }, [])).toBeNull();
  });
});
