import type { Observation } from "@repo/schema";
import { describe, expect, it } from "vitest";
import { checkTrackCleared, detectAnnouncementCues, detectObservationCues } from "../src/index.ts";

function buildObservation(overrides: Partial<Observation>): Observation {
  return {
    id: "o1",
    observedAt: "2026-11-05T08:00:00+09:00",
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

describe("detectAnnouncementCues", () => {
  it("規則 2: 信号の受信の放送から防護無線の手がかりを拾う", () => {
    expect(detectAnnouncementCues("ただいま緊急停止信号を受信し、停車しております")).toContain(
      "protection_received",
    );
    expect(detectAnnouncementCues("信号を受信しましたので停車中です")).toContain(
      "protection_received",
    );
  });

  it("規則 5: 前の列車がつかえている放送から詰まりの手がかりを拾う", () => {
    expect(detectAnnouncementCues("前の列車がつかえているため、しばらく停車します")).toEqual([
      "queue_ahead",
    ]);
    expect(detectAnnouncementCues("先行列車の影響で遅れています")).toContain("queue_ahead");
  });

  it("再開、まもなく再開、救援を拾う", () => {
    expect(detectAnnouncementCues("運転を再開しました")).toEqual(["resumed"]);
    expect(detectAnnouncementCues("まもなく運転を再開します")).toEqual([
      "resume_soon",
      "track_cleared",
    ]);
    expect(detectAnnouncementCues("救援の列車が向かっています")).toEqual(["rescue"]);
  });

  it("条件付きの文では再開に向けた手がかりを数えない", () => {
    expect(detectAnnouncementCues("安全が確認でき次第、順次運転を再開します")).toEqual([]);
  });

  it("文を区切って別々に照合する", () => {
    expect(detectAnnouncementCues("確認が取れ次第お知らせします。まもなく再開します")).toEqual([
      "resume_soon",
      "track_cleared",
    ]);
  });

  it("手がかりが無ければ空", () => {
    expect(detectAnnouncementCues("ご迷惑をおかけしております")).toEqual([]);
  });
});

describe("detectObservationCues", () => {
  it("原文と兆候の引用の両方を見る", () => {
    const cues = detectObservationCues([
      buildObservation({ rawText: "救援を待っています" }),
      buildObservation({
        detectedSignals: [{ eventType: "x", signalId: "s", quote: "運転を再開しました" }],
      }),
    ]);
    expect(cues).toEqual(["resumed", "rescue"]);
  });
});

describe("checkTrackCleared", () => {
  it("再開の見込みの時刻か、再開が近いと言い切る放送で true", () => {
    expect(
      checkTrackCleared([buildObservation({ statedResumeTime: "2026-11-05T08:30:00+09:00" })]),
    ).toBe(true);
    expect(checkTrackCleared([buildObservation({ rawText: "安全が確認されました" })])).toBe(true);
  });

  it("条件付きの文と、観測が無いときは false", () => {
    expect(
      checkTrackCleared([buildObservation({ rawText: "安全が確認され次第、再開します" })]),
    ).toBe(false);
    expect(checkTrackCleared([])).toBe(false);
  });
});
