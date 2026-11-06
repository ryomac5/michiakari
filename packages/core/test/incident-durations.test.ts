import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  DURATION_PERIODS,
  INCIDENT_GROUP_DURATIONS,
  INCIDENT_GROUP_IDS,
  INCIDENT_TYPE_DURATIONS,
  INCIDENT_TYPE_IDS,
  MIN_GROUP_COUNT,
  MIN_PERIOD_COUNT,
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

  it("時間帯の区分は p50 が p80 以下で、区分の件数の合計が止まった時刻のある事例数以内", () => {
    for (const stats of [
      ...Object.values(INCIDENT_GROUP_DURATIONS),
      ...Object.values(INCIDENT_TYPE_DURATIONS),
    ]) {
      let total = 0;
      for (const period of DURATION_PERIODS) {
        const { count, p50, p80, ownP50, ownP80 } = stats.byPeriod[period];
        total += count;
        if (count === 0) {
          expect(ownP50).toBeNull();
          expect(ownP80).toBeNull();
        } else {
          expect(ownP50 as number).toBeLessThanOrEqual(ownP80 as number);
        }
        if (p50 !== null) expect(p50).toBeLessThanOrEqual(p80 as number);
      }
      expect(total).toBeLessThanOrEqual(stats.count);
    }
  });

  it("件数が足りない区分は印が付き、まぜた値を使う", () => {
    let marked = 0;
    for (const stats of [
      ...Object.values(INCIDENT_GROUP_DURATIONS),
      ...Object.values(INCIDENT_TYPE_DURATIONS),
    ]) {
      for (const period of DURATION_PERIODS) {
        const entry = stats.byPeriod[period];
        expect(entry.reliability).toBe(
          entry.count >= MIN_PERIOD_COUNT ? "sufficient" : "use_mixed",
        );
        if (entry.reliability === "use_mixed") {
          marked += 1;
          expect(entry.p50).toBe(stats.p50);
          expect(entry.p80).toBe(stats.p80);
        } else {
          expect(entry.p50).toBe(entry.ownP50);
          expect(entry.p80).toBe(entry.ownP80);
        }
      }
    }
    expect(marked).toBeGreaterThan(0);
  });
});
