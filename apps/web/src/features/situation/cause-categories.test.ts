import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { findRepoRoot } from "@repo/schema/loaders";
import { describe, expect, it } from "vitest";
import type { KnowledgeCatalog } from "@/features/knowledge/catalog";
import {
  type CauseCategoryId,
  causeCategoryIds,
  listCauseKinds,
  needsCauseKind,
  resolveCauseEventType,
} from "./cause-categories";

// 大分類と知見の事象の対応を、ダミー知見の 4 事象で確かめる（読むだけで変更しない）
const root = findRepoRoot();
const devKnowledgeDir = join(root, "packages/schema/test/fixtures/dev-content/knowledge");
const devCatalog: KnowledgeCatalog = readdirSync(devKnowledgeDir)
  .filter((f) => f.endsWith(".yaml"))
  .map((f) => ({ id: f.replace(/\.yaml$/, ""), name: { ja: f }, phases: [] }));

const taxonomy = JSON.parse(
  readFileSync(join(root, "docs/research/rail-suspensions/taxonomy.json"), "utf8"),
) as { groups: { id: string }[] };

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

  const expected: Record<Exclude<CauseCategoryId, "passenger">, string | null> = {
    vehicle: "vehicle_failure",
    signaling: null,
    power: null,
    obstruction: null,
    infrastructure: null,
    weather: null,
    major_accident: null,
  };
  for (const [category, eventType] of Object.entries(expected)) {
    it(`${category} は ${eventType ?? "知見なし"} に対応する`, () => {
      const id = category as CauseCategoryId;
      expect(needsCauseKind(id)).toBe(false);
      expect(resolveCauseEventType({ category: id, kind: null }, devCatalog)).toBe(eventType);
    });
  }

  it("人・旅客対応は種類を聞き、人との接触と車内の対応で事象が分かれる", () => {
    expect(needsCauseKind("passenger")).toBe(true);
    expect(listCauseKinds("passenger")).toEqual(["person", "inCar", "other"]);
    const resolve = (kind: "person" | "inCar" | "other" | null) =>
      resolveCauseEventType({ category: "passenger", kind }, devCatalog);
    expect(resolve("person")).toBe("person_accident");
    expect(resolve("inCar")).toBe("in_car_response");
    expect(resolve("other")).toBeNull();
    expect(resolve(null)).toBeNull();
  });

  it("分からないと、知見に無い事象は知見なしになる", () => {
    expect(resolveCauseEventType(null, devCatalog)).toBeNull();
    expect(resolveCauseEventType({ category: null, kind: null }, devCatalog)).toBeNull();
    expect(resolveCauseEventType({ category: "vehicle", kind: null }, [])).toBeNull();
  });
});
