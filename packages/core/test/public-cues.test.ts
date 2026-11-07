import type { Observation } from "@repo/schema";
import { describe, expect, it } from "vitest";
import { FIRST_TRAIN_WAIT_BY_STOP_KIND } from "../params/incident-behavior.ts";
import {
  checkInspectionPending,
  checkResumeAfterInspection,
  checkTrackEvacuation,
  detectAnnouncementCues,
  estimateIncidentRemaining,
  estimateTrainQueueArrival,
  filterCuesDuringInspection,
  resolveEvacuationCues,
  resolveFirstTrainWait,
  resolveStationPlatform,
  resolveTrainQueueParams,
} from "../src/index.ts";
import { addMinutesToIso } from "../src/time.ts";

// 公開資料の調べから足した手がかり。docs/research/rail-operations/proposals.md の案 2、3、5、8
// 文はすべて架空の言い回しで、実際の発表文は写さない

describe("線路への降車の手がかり", () => {
  it("線路に降りる、最寄り駅まで歩く、降車誘導の文で拾う", () => {
    expect(detectAnnouncementCues("これから線路に降りていただきます")).toContain(
      "evacuation_on_track",
    );
    expect(detectAnnouncementCues("係員の誘導で最寄り駅まで歩いて移動します")).toContain(
      "evacuation_on_track",
    );
    expect(detectAnnouncementCues("ただいまより降車誘導を行います")).toContain(
      "evacuation_on_track",
    );
    expect(detectAnnouncementCues("Staff will guide you to walk along the tracks")).toContain(
      "evacuation_on_track",
    );
  });

  it("降りないよう求める文と、打ち消しの文では拾わない", () => {
    expect(detectAnnouncementCues("危ないので線路には降りないでください")).not.toContain(
      "evacuation_on_track",
    );
    expect(detectAnnouncementCues("線路に降りるのは危険です")).not.toContain("evacuation_on_track");
    expect(detectAnnouncementCues("降車誘導は行っておりません")).not.toContain(
      "evacuation_on_track",
    );
    expect(detectAnnouncementCues("Do not step down onto the tracks")).not.toContain(
      "evacuation_on_track",
    );
  });

  it("案内が聞こえたら、発表の時刻があっても見込みの数字を出さない", () => {
    const r = estimateIncidentRemaining({
      type: "person_collision",
      cues: ["evacuation_on_track"],
      statedResumeTime: "2026-11-04T14:00:00+09:00",
      onsetTime: "2026-11-04T13:00:00+09:00",
      now: "2026-11-04T13:30:00+09:00",
    });
    expect(r).toMatchObject({ basis: null, remaining: null, withholdNumbers: true });
    expect(checkTrackEvacuation(["evacuation_on_track"])).toBe(true);
    expect(checkTrackEvacuation(["rescue"])).toBe(false);
  });
});

describe("運転整理の放送の手がかり", () => {
  const cases = [
    {
      id: "turnback",
      yes: ["京橋と天王寺の間で折り返し運転を行っています", "尼崎駅で折返し運転です"],
      no: ["折り返し運転は行っておりません"],
    },
    {
      id: "service_cancelled",
      yes: ["この列車は当駅で運転を取りやめます", "この電車は運転を打ち切ります"],
      no: ["運転を取りやめてはいません"],
    },
    {
      id: "through_service_suspended",
      yes: ["阪神線との直通運転を中止しています", "直通運転は見合わせております"],
      no: ["直通運転の中止はありません"],
    },
    {
      id: "slow_running",
      yes: ["この先、徐行運転を行います", "強い風のため徐行しております"],
      no: ["徐行運転は行っていません"],
    },
    {
      id: "held_at_station",
      yes: ["この駅でしばらく停車いたします", "当駅で発車を見合わせております"],
      no: ["当駅での停車はできません", "前の列車がつかえているため、しばらく停車いたします"],
    },
  ] as const;

  for (const c of cases) {
    it(`${c.id} を肯定の文で拾い、否定の文では拾わない`, () => {
      for (const text of c.yes) expect(detectAnnouncementCues(text), text).toContain(c.id);
      for (const text of c.no) expect(detectAnnouncementCues(text), text).not.toContain(c.id);
    });
  }

  it("お詫びの文は否定に数えない", () => {
    expect(
      detectAnnouncementCues("ご迷惑をおかけして申し訳ありませんが、折り返し運転を行っています"),
    ).toContain("turnback");
  });

  it("折り返し運転なら、区間が止まっているので初列車待ちを区間の値にする", () => {
    expect(resolveFirstTrainWait("medical_response")).toEqual(
      FIRST_TRAIN_WAIT_BY_STOP_KIND.train_only,
    );
    expect(resolveFirstTrainWait("medical_response", ["turnback"])).toEqual(
      FIRST_TRAIN_WAIT_BY_STOP_KIND.section,
    );
    const r = estimateIncidentRemaining({
      type: "vehicle_failure",
      cues: ["turnback"],
      statedResumeTime: "2026-11-04T13:40:00+09:00",
      onsetTime: "2026-11-04T13:00:00+09:00",
      now: "2026-11-04T13:10:00+09:00",
    });
    expect(r.firstTrainWait).toEqual(FIRST_TRAIN_WAIT_BY_STOP_KIND.section);
  });
});

function buildObservation(at: string, rawText: string): Observation {
  return {
    id: at,
    observedAt: at,
    source: "text",
    eventTypeCandidates: [],
    operator: null,
    line: null,
    section: null,
    statedResumeTime: null,
    transferServiceActive: null,
    detectedSignals: [],
    rawText,
  };
}

describe("天気の事象の点検", () => {
  it("点検や安全確認が続く文で拾い、終わった文では拾わない", () => {
    expect(detectAnnouncementCues("雨は弱まりましたが、線路の点検を行っております")).toContain(
      "inspection_ongoing",
    );
    expect(detectAnnouncementCues("現在、安全確認中です")).toContain("inspection_ongoing");
    expect(detectAnnouncementCues("点検が終わりました")).not.toContain("inspection_ongoing");
    expect(detectAnnouncementCues("点検は行っておりません")).not.toContain("inspection_ongoing");
  });

  it("規制の解除だけでは再開に向けた手がかりにしない", () => {
    expect(detectAnnouncementCues("雨量の規制が解除されました")).toEqual([]);
    expect(detectAnnouncementCues("風速の規制を解除しました")).toEqual([]);
  });

  it("点検が続く間は、まもなく再開の手がかりを数えない", () => {
    const pending = [
      buildObservation(
        "2026-11-05T08:00:00+09:00",
        "規制は解除されました。線路の点検を行っております。まもなく再開する見込みです。",
      ),
    ];
    expect(checkInspectionPending(pending)).toBe(true);
    expect(filterCuesDuringInspection(["resume_soon", "track_cleared", "rescue"], true)).toEqual([
      "rescue",
    ]);
    expect(filterCuesDuringInspection(["resumed", "inspection_ongoing"], true)).toEqual([
      "resumed",
      "inspection_ongoing",
    ]);
  });

  it("後の観測で点検が終わったと分かれば、再開の手がかりを残す", () => {
    const observations = [
      buildObservation("2026-11-05T08:00:00+09:00", "線路の点検を行っております"),
      buildObservation("2026-11-05T08:30:00+09:00", "点検が終わりました。まもなく運転を再開します"),
    ];
    expect(checkInspectionPending(observations)).toBe(false);
    expect(filterCuesDuringInspection(["resume_soon"], false)).toEqual(["resume_soon"]);
  });

  it("点検を待つのは大雨、強風、地震の種類", () => {
    expect(checkResumeAfterInspection("heavy_rain")).toBe(true);
    expect(checkResumeAfterInspection("strong_wind")).toBe(true);
    expect(checkResumeAfterInspection("earthquake")).toBe(true);
    expect(checkResumeAfterInspection("vehicle_failure")).toBe(false);
    expect(checkResumeAfterInspection(null)).toBe(false);
  });
});

describe("地震の後に次の駅へ進む案内", () => {
  it("安全を確認した区間、最寄り駅まで徐行の文で拾う", () => {
    expect(
      detectAnnouncementCues("安全を確認した区間から、最寄り駅まで徐行で運転します"),
    ).toContain("proceed_to_station");
    expect(detectAnnouncementCues("次の駅まで徐行して進みます")).toContain("proceed_to_station");
    expect(detectAnnouncementCues("This train will proceed slowly to the next station")).toContain(
      "proceed_to_station",
    );
  });

  it("否定の文では拾わない。安全を確認した区間の文は線路の確かめの手がかりにしない", () => {
    expect(detectAnnouncementCues("次の駅まで進むことはできません")).not.toContain(
      "proceed_to_station",
    );
    expect(detectAnnouncementCues("安全を確認できた区間から運転します")).not.toContain(
      "track_cleared",
    );
  });

  it("詰めない事業者でも、案内があれば再開の前に次の駅に着く", () => {
    const now = "2026-11-05T08:00:00+09:00";
    const line = "jr-west.東海道線";
    const input = {
      now,
      untilResume: { p50: 60, p80: 120 },
      ownTrainType: "local" as const,
      trainsAhead: [],
      trainsAheadCount: null,
      trainsAheadHeadwayMinutes: null,
      stationsAhead: [
        {
          name: "塚本",
          rideMinutesFromPrevious: 3,
          platform: resolveStationPlatform(line, "塚本"),
        },
      ],
      params: resolveTrainQueueParams("阪急電鉄"),
      closeUpCleared: false,
    };
    expect(estimateTrainQueueArrival(input).beforeResume).toBe(false);
    const proceed = estimateTrainQueueArrival({ ...input, proceedToStation: true });
    expect(proceed.beforeResume).toBe(true);
    expect(proceed.arrival?.p50).toBe(addMinutesToIso(now, 3));
  });
});

describe("レビューの直し", () => {
  const at = (minute: number) => `2026-11-05T08:${String(minute).padStart(2, "0")}:00+09:00`;

  it("再開の後に降りる案内が出たら、残り時間を出さない", () => {
    const r = estimateIncidentRemaining({
      type: "person_collision",
      cues: ["resumed", "evacuation_on_track"],
      statedResumeTime: null,
      onsetTime: at(0),
      now: at(30),
    });
    expect(r).toMatchObject({ basis: null, remaining: null, withholdNumbers: true });
  });

  it("降りる案内と再開の放送は、観測の時刻が新しいほうを残す", () => {
    const evacuation = buildObservation(at(10), "これから線路に降りていただきます");
    const resumed = buildObservation(at(20), "運転を再開しました");
    const both: ("resumed" | "evacuation_on_track")[] = ["resumed", "evacuation_on_track"];
    expect(resolveEvacuationCues([evacuation, resumed], both)).toEqual(["resumed"]);
    const resumedFirst = buildObservation(at(5), "運転を再開しました");
    expect(resolveEvacuationCues([resumedFirst, evacuation], both)).toEqual([
      "evacuation_on_track",
    ]);
    // 同じ観測なら降りる案内を残す
    const same = buildObservation(at(10), "運転を再開しました。これから線路に降りていただきます");
    expect(resolveEvacuationCues([same], both)).toEqual(["evacuation_on_track"]);
    expect(resolveEvacuationCues([resumed], ["resumed"])).toEqual(["resumed"]);
  });

  it("まもなく再開、点検中、点検は終了しましたの順なら、点検中の状態を解く", () => {
    const soon = buildObservation(at(0), "まもなく再開する見込みです");
    const inspecting = buildObservation(at(10), "線路の点検を行っております");
    const done = buildObservation(at(20), "点検は終了しました");
    expect(checkInspectionPending([soon, inspecting])).toBe(true);
    expect(checkInspectionPending([soon, inspecting, done])).toBe(false);
    expect(
      checkInspectionPending([inspecting, buildObservation(at(20), "点検が終わりました")]),
    ).toBe(false);
    expect(detectAnnouncementCues("点検は終了していません")).not.toContain("track_cleared");
  });

  it("否定は手がかりの言い回しと同じ節の中だけに効く", () => {
    expect(
      detectAnnouncementCues("直通運転は中止していませんが、折り返し運転を行っています"),
    ).toEqual(["turnback"]);
    expect(detectAnnouncementCues("運転を再開しましたが、徐行運転は行っておりません")).toEqual([
      "resumed",
    ]);
    expect(detectAnnouncementCues("前の列車が詰まってはいません")).not.toContain("queue_ahead");
    expect(detectAnnouncementCues("前の列車がつかえているので、お待ちください")).toContain(
      "queue_ahead",
    );
  });

  it("はしごは、降りることを示す文の形のときだけ降車と読む", () => {
    expect(detectAnnouncementCues("はしごで線路に降りていただきます")).toContain(
      "evacuation_on_track",
    );
    expect(detectAnnouncementCues("はしごを使って順にお降りください")).toContain(
      "evacuation_on_track",
    );
    expect(detectAnnouncementCues("点検のためはしごを使用します")).not.toContain(
      "evacuation_on_track",
    );
    expect(detectAnnouncementCues("はしごを使用しないでください")).not.toContain(
      "evacuation_on_track",
    );
  });
});
