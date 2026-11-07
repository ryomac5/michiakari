import { ObservationSchema } from "@repo/schema";
import { describe, expect, it } from "vitest";
import {
  buildProtectionObservations,
  protectionBroadcastText,
  protectionObservationId,
  resolveProtectionBroadcast,
} from "./protection-broadcast";

const now = new Date("2026-11-03T05:00:00Z");

describe("buildProtectionObservations", () => {
  it("あったなら、聞いた放送の文を車内の放送の観測に入れる", () => {
    const [observation, ...rest] = buildProtectionObservations("heard", now);
    expect(rest).toEqual([]);
    expect(observation).toBeDefined();
    expect(ObservationSchema.parse(observation)).toEqual(observation);
    expect(observation?.id).toBe(protectionObservationId);
    expect(observation?.kind).toBe("station_broadcast");
    expect(observation?.rawText).toBe(protectionBroadcastText);
    expect(observation?.rawText).toContain("信号を受信");
  });

  it("なかったか覚えていないなら、観測を足さない", () => {
    expect(buildProtectionObservations("notHeard", now)).toEqual([]);
    expect(buildProtectionObservations("unsure", now)).toEqual([]);
    expect(buildProtectionObservations(null, now)).toEqual([]);
  });

  it("止まってからの分だけ、聞いた時刻を前にする", () => {
    const [observation] = buildProtectionObservations("heard", now, 10);
    expect(observation?.observedAt).toBe("2026-11-03T13:50:00+09:00");
  });
});

describe("resolveProtectionBroadcast", () => {
  it("答えを判断の要求の値に直し、答えていなければ null を返す", () => {
    expect(resolveProtectionBroadcast("heard")).toBe("heard");
    expect(resolveProtectionBroadcast("notHeard")).toBe("not_heard");
    expect(resolveProtectionBroadcast("unsure")).toBe("unknown");
    expect(resolveProtectionBroadcast(null)).toBeNull();
  });
});
