import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  INCIDENT_GROUP_DURATIONS,
  INCIDENT_GROUP_IDS,
  INCIDENT_TYPE_DURATIONS,
  INCIDENT_TYPE_IDS,
  MIN_GROUP_COUNT,
  MIN_TYPE_COUNT,
} from "../params/incident-durations.ts";

type Taxonomy = {
  groups: { id: string }[];
  types: { id: string; group_id: string }[];
};

const taxonomy: Taxonomy = JSON.parse(
  readFileSync(
    new URL("../../../docs/research/rail-suspensions/taxonomy.json", import.meta.url),
    "utf-8",
  ),
);

describe("incident-durations", () => {
  it("taxonomy の大分類と種類をすべて含み、種類の大分類が合う", () => {
    expect([...INCIDENT_GROUP_IDS]).toEqual(taxonomy.groups.map((g) => g.id));
    expect([...INCIDENT_TYPE_IDS]).toEqual(taxonomy.types.map((t) => t.id));
    expect(Object.keys(INCIDENT_GROUP_DURATIONS).sort()).toEqual(
      taxonomy.groups.map((g) => g.id).sort(),
    );
    expect(Object.keys(INCIDENT_TYPE_DURATIONS).sort()).toEqual(
      taxonomy.types.map((t) => t.id).sort(),
    );
    for (const t of taxonomy.types) {
      expect(INCIDENT_TYPE_DURATIONS[t.id as keyof typeof INCIDENT_TYPE_DURATIONS].groupId).toBe(
        t.group_id,
      );
    }
  });

  it("大分類は件数が正で、p50 が p80 以下", () => {
    for (const stats of Object.values(INCIDENT_GROUP_DURATIONS)) {
      expect(stats.count).toBeGreaterThan(0);
      expect(stats.p50).not.toBeNull();
      expect(stats.p50 as number).toBeLessThanOrEqual(stats.p80 as number);
      expect(stats.min as number).toBeLessThanOrEqual(stats.p50 as number);
      expect(stats.p80 as number).toBeLessThanOrEqual(stats.max as number);
    }
  });

  it("種類は事例があれば件数が正で p50 が p80 以下、無ければ統計値が null", () => {
    for (const stats of Object.values(INCIDENT_TYPE_DURATIONS)) {
      if (stats.count === 0) {
        expect(stats.p50).toBeNull();
        expect(stats.p80).toBeNull();
        continue;
      }
      expect(stats.p50 as number).toBeLessThanOrEqual(stats.p80 as number);
    }
  });

  it("信頼度は件数の下限と一致する", () => {
    for (const stats of Object.values(INCIDENT_TYPE_DURATIONS)) {
      expect(stats.reliability).toBe(stats.count >= MIN_TYPE_COUNT ? "sufficient" : "use_group");
    }
    for (const stats of Object.values(INCIDENT_GROUP_DURATIONS)) {
      expect(stats.reliability).toBe(
        stats.count >= MIN_GROUP_COUNT ? "sufficient" : "insufficient",
      );
    }
  });

  it("stopScopeCounts の合計が件数と一致する", () => {
    for (const stats of [
      ...Object.values(INCIDENT_GROUP_DURATIONS),
      ...Object.values(INCIDENT_TYPE_DURATIONS),
    ]) {
      const total = Object.values(stats.stopScopeCounts).reduce((a, b) => a + b, 0);
      expect(total).toBe(stats.count);
    }
  });
});
