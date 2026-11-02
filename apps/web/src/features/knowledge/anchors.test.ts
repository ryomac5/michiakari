import { describe, expect, it } from "vitest";
import { personAccidentCatalog } from "@/features/judgment/fixtures/person-accident";
import { buildEvidenceHref, buildSignalHref } from "./anchors";

describe("buildEvidenceHref", () => {
  it("兆候は #signal-<id> に飛ぶ", () => {
    expect(buildSignalHref("pa_resumed")).toBe("/knowledge#signal-pa_resumed");
    expect(
      buildEvidenceHref(
        { kind: "signal", id: "transfer_started", description: "" },
        "person_accident",
        personAccidentCatalog,
      ),
    ).toBe("/knowledge#signal-transfer_started");
  });

  it("事象と段階の知見は、それぞれの見出しに飛ぶ", () => {
    const href = (id: string) =>
      buildEvidenceHref(
        { kind: "knowledge", id, description: "" },
        "person_accident",
        personAccidentCatalog,
      );
    expect(href("person_accident")).toBe("/knowledge#event-person_accident");
    expect(href("on_site")).toBe("/knowledge#phase-person_accident-on_site");
    expect(href("unknown_phase")).toBeNull();
  });

  it("計算や、知見に無い兆候にはリンクを付けない", () => {
    const computation = { kind: "computation", id: "compute_break_even", description: "" } as const;
    expect(buildEvidenceHref(computation, "person_accident", personAccidentCatalog)).toBeNull();
    expect(
      buildEvidenceHref(
        { kind: "signal", id: "not_in_catalog", description: "" },
        "person_accident",
        personAccidentCatalog,
      ),
    ).toBeNull();
    expect(
      buildEvidenceHref(
        { kind: "signal", id: "transfer_started", description: "" },
        null,
        personAccidentCatalog,
      ),
    ).toBeNull();
  });
});
