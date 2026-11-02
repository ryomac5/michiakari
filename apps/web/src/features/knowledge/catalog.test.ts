import { describe, expect, it } from "vitest";
import { personAccidentCatalog } from "@/features/judgment/fixtures/person-accident";
import { findCatalogSignal, mergeCatalogs, pickLocalized } from "./catalog";

describe("mergeCatalogs", () => {
  it("同じ id は先に並んだ方を残す", () => {
    const primary = [{ id: "person_accident", name: { ja: "本物" }, phases: [] }];
    const merged = mergeCatalogs(primary, personAccidentCatalog);
    expect(merged).toHaveLength(1);
    expect(merged[0]?.name.ja).toBe("本物");
    expect(mergeCatalogs([], personAccidentCatalog)).toEqual(personAccidentCatalog);
  });
});

describe("findCatalogSignal", () => {
  it("事象種別と兆候 id から兆候の説明を引く", () => {
    expect(
      findCatalogSignal(personAccidentCatalog, "person_accident", "transfer_started")?.description,
    ).toBe("振替輸送の実施が案内される");
    expect(
      findCatalogSignal(personAccidentCatalog, "heavy_rain", "transfer_started"),
    ).toBeUndefined();
  });
});

describe("pickLocalized", () => {
  it("英語が無ければ日本語を返す", () => {
    expect(pickLocalized({ ja: "人身事故", en: "Accident" }, "en")).toBe("Accident");
    expect(pickLocalized({ ja: "人身事故" }, "en")).toBe("人身事故");
  });
});
