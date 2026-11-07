import type { RouteLeg, RouteOption } from "@repo/schema";
import { describe, expect, it } from "vitest";
import {
  checkProtectionIncident,
  detectAnnouncementCues,
  estimateIncidentRemaining,
  INCIDENT_BEHAVIOR,
  normalizeOperatorKey,
  rankAlternativesForProtection,
  resolveFlowOutlook,
  resolveIncidentType,
} from "../src/index.ts";

describe("否定の文の手がかり", () => {
  it("再開を打ち消す文では再開の手がかりを出さない", () => {
    expect(detectAnnouncementCues("まもなく運転を再開する見込みはありません")).toEqual([]);
    expect(detectAnnouncementCues("運転再開の見込みは立っていません")).toEqual([]);
    expect(detectAnnouncementCues("順次再開する時刻は未定です")).toEqual([]);
    expect(detectAnnouncementCues("まだ運転を再開しておりません")).toEqual([]);
    expect(detectAnnouncementCues("安全確認ができません")).toEqual([]);
  });

  it("受信を打ち消す文では防護無線の手がかりを出さない", () => {
    expect(detectAnnouncementCues("緊急停止信号を受信していません")).toEqual([]);
    expect(detectAnnouncementCues("緊急停止信号についてお知らせします")).toEqual([]);
    expect(detectAnnouncementCues("緊急停止信号を受信したため停車しました")).toEqual([
      "protection_received",
    ]);
  });

  it("否定は同じ文だけに効く", () => {
    expect(detectAnnouncementCues("再開の時刻は未定です。まもなく運転を再開します")).toEqual([
      "resume_soon",
      "track_cleared",
    ]);
  });

  it("異常が無いと確かめた文は否定に数えない", () => {
    expect(detectAnnouncementCues("駅構内を確認しましたが、異常はありません")).toEqual([
      "track_cleared",
    ]);
    expect(detectAnnouncementCues("荷物の確認ができました")).toEqual(["track_cleared"]);
  });
});

describe("線路の支障物と架線の異物", () => {
  it("線路の支障物は防護無線を必ず出す種類に寄せる", () => {
    const type = resolveIncidentType({ texts: ["線路内に支障物があったため"] });
    expect(type).toBe("track_structure_damage");
    expect(type && INCIDENT_BEHAVIOR[type].protection).toBe("always");
    expect(checkProtectionIncident({ type, cues: [] })).toBe(true);
  });

  it("架線の異物は出すかもしれない種類のまま", () => {
    const type = resolveIncidentType({ texts: ["架線に異物が付いたため"] });
    expect(type).toBe("foreign_object");
    expect(checkProtectionIncident({ type, cues: [] })).toBe(false);
  });
});

describe("不審物の短い目安", () => {
  const base = {
    type: "suspicious_object" as const,
    statedResumeTime: null,
    onsetTime: "2026-11-04T13:00:00+09:00",
    now: "2026-11-04T13:03:00+09:00",
  };

  it("確かめた手がかりが無ければ目安を使わず統計値に落とす", () => {
    const r = estimateIncidentRemaining({ ...base, cues: [] });
    expect(r.basis).toBe("statistics");
  });

  it("確かめた手がかりがあれば目安を使う", () => {
    const cues = detectAnnouncementCues("不審物を確認しましたが、異常はありませんでした");
    expect(cues).toContain("track_cleared");
    const r = estimateIncidentRemaining({ ...base, cues });
    expect(r.basis).toBe("rule");
    expect(r.untilResume).toEqual({ p50: 7, p80: 27 });
  });

  it("確かめの要らない短い事象は手がかりなしで目安を使う", () => {
    const r = estimateIncidentRemaining({ ...base, type: "track_intrusion", cues: [] });
    expect(r.basis).toBe("rule");
  });
});

describe("事業者名の正規化", () => {
  it.each([
    ["阪急電鉄", "hankyu"],
    ["阪急", "hankyu"],
    ["阪神電気鉄道", "hanshin"],
    ["京阪", "keihan"],
    ["近畿日本鉄道", "kintetsu"],
    ["南海電気鉄道", "nankai"],
    ["大阪メトロ", "osaka-metro"],
    ["Osaka Metro", "osaka-metro"],
    ["JR西日本", "jr-west"],
  ])("%s は %s", (name, key) => {
    expect(normalizeOperatorKey(name)).toBe(key);
  });

  function ride(lineId: string): RouteLeg {
    return { mode: "ride", from: "A", to: "B", minutes: 10, lineId };
  }
  const options: Pick<RouteOption, "id" | "kind" | "legs">[] = [
    { id: "hankyu", kind: "transfer", legs: [ride("hankyu.神戸線")] },
    { id: "hanshin", kind: "transfer", legs: [ride("hanshin.本線")] },
    { id: "keihan", kind: "transfer", legs: [ride("keihan.京阪本線")] },
    { id: "kintetsu", kind: "transfer", legs: [ride("kintetsu.奈良線")] },
    { id: "nankai", kind: "transfer", legs: [ride("nankai.南海本線")] },
    { id: "metro", kind: "transfer", legs: [ride("osaka-metro.御堂筋線")] },
    { id: "jr", kind: "transfer", legs: [ride("jr-west.大阪環状線")] },
  ];

  it.each([
    ["阪急電鉄", "hankyu"],
    ["阪神電気鉄道", "hanshin"],
    ["京阪電気鉄道", "keihan"],
    ["近鉄", "kintetsu"],
    ["南海", "nankai"],
    ["大阪市高速電気軌道", "metro"],
    ["西日本旅客鉄道", "jr"],
  ])("止まった会社が %s なら、その会社の線だけを下げる", (operator, sameId) => {
    const ranked = rankAlternativesForProtection({
      options,
      protection: true,
      blockedLineId: null,
      blockedOperator: operator,
    });
    const lowered = ranked.filter((r) => r.standing === "lowered").map((r) => r.option.id);
    expect(lowered).toEqual([sameId]);
    expect(ranked.at(-1)?.option.id).toBe(sameId);
  });

  it("表に無い事業者名なら並びを変えない", () => {
    const ranked = rankAlternativesForProtection({
      options,
      protection: true,
      blockedLineId: null,
      blockedOperator: "架空鉄道",
    });
    expect(ranked.every((r) => r.standing === "neutral")).toBe(true);
  });
});

describe("台風", () => {
  it("発表に台風があれば天気の事象をとても長いとする", () => {
    expect(resolveFlowOutlook("strong_wind")).toBe("long");
    expect(resolveFlowOutlook("strong_wind", ["台風の接近に伴い見合わせ"])).toBe("very_long");
    expect(resolveFlowOutlook("heavy_rain", ["台風による大雨のため"])).toBe("very_long");
    expect(resolveFlowOutlook(null, ["台風のため"])).toBe("very_long");
  });

  it("天気でない事象は台風の語で上げない", () => {
    expect(resolveFlowOutlook("medical_response", ["台風の日の急病人"])).toBe("short");
  });

  it("見込みの flowOutlook にも反映する", () => {
    const r = estimateIncidentRemaining({
      type: resolveIncidentType({ texts: ["台風のため運転を見合わせ"] }),
      cues: [],
      statedResumeTime: null,
      onsetTime: "2026-11-04T13:00:00+09:00",
      now: "2026-11-04T13:00:00+09:00",
      texts: ["台風のため運転を見合わせ"],
    });
    expect(r.flowOutlook).toBe("very_long");
    expect(r.basis).toBe("statistics");
  });
});
