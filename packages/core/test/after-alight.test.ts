import type { RouteLeg, RouteOption } from "@repo/schema";
import { describe, expect, it } from "vitest";
import {
  checkStaysOnToDestination,
  resolveStopScope,
  selectAfterAlightStep,
} from "../src/index.ts";

// 駅間の車内の人が次の駅に着いた後の一手と、止まり方の区別

const STOPPED = "jr.kobe";

function buildOption(
  id: string,
  kind: RouteOption["kind"],
  arrivalTime: string,
  legs: RouteLeg[],
): RouteOption {
  return {
    id,
    kind,
    label: id,
    legs,
    arrivalTime,
    fareYen: kind === "taxi" ? 9000 : null,
    walkMinutes: 0,
    isTransferService: false,
  };
}

const waitLeg: RouteLeg = { mode: "wait", from: "塚本", to: "塚本", minutes: 60, lineId: STOPPED };
const ride = (from: string, to: string, lineId: string, line = lineId): RouteLeg => ({
  mode: "ride",
  from,
  to,
  minutes: 10,
  lineId,
  line,
});

// 乗ったままでは行き先に着けない待つ経路。止まっている路線で尼崎まで行き、別の路線に乗り換える
const waitWithTransfer = buildOption("wait", "wait", "2026-11-05T23:30:00+09:00", [
  waitLeg,
  ride("塚本", "尼崎", STOPPED),
  ride("尼崎", "御幣島", "jr.tozai"),
]);
const waitStaysOn = buildOption("wait", "wait", "2026-11-05T23:30:00+09:00", [
  waitLeg,
  ride("塚本", "三ノ宮", STOPPED),
]);
const hankyu = buildOption("transfer_1", "transfer", "2026-11-05T23:00:00+09:00", [
  { mode: "walk", from: "塚本", to: "十三", minutes: 20 },
  ride("十三", "西宮北口", "hankyu.kobe", "阪急神戸線"),
]);
const sameLine = buildOption("transfer_2", "transfer", "2026-11-05T22:40:00+09:00", [
  ride("塚本", "尼崎", STOPPED),
]);
const taxi = buildOption("taxi", "taxi", "2026-11-05T22:50:00+09:00", [
  { mode: "taxi", from: "塚本", to: "西宮北口", minutes: 40 },
]);

const base = {
  alightStation: "塚本",
  departureStation: "塚本",
  destinationStation: "西宮北口",
};

describe("checkStaysOnToDestination", () => {
  it("止まっている路線だけに乗る待つ経路なら、乗ったままで着ける", () => {
    expect(checkStaysOnToDestination(waitStaysOn)).toBe(true);
    expect(checkStaysOnToDestination(waitWithTransfer)).toBe(false);
  });
});

describe("selectAfterAlightStep", () => {
  it("着いた後のほうが早い鉄道の手段があれば、それを選ぶ。止まっている路線に乗る経路とタクシーは選ばない", () => {
    const step = selectAfterAlightStep({
      ...base,
      waitOption: waitWithTransfer,
      options: [waitWithTransfer, sameLine, taxi, hankyu],
    });
    expect(step?.id).toBe("transfer_1");
  });

  it("鉄道の手段が無ければタクシーを選ぶ", () => {
    const step = selectAfterAlightStep({
      ...base,
      waitOption: waitWithTransfer,
      options: [waitWithTransfer, sameLine, taxi],
    });
    expect(step?.id).toBe("taxi");
  });

  it("乗ったままのほうが早ければ出さない", () => {
    const slow = { ...hankyu, arrivalTime: "2026-11-05T23:45:00+09:00" };
    expect(
      selectAfterAlightStep({ ...base, waitOption: waitWithTransfer, options: [slow] }),
    ).toBeNull();
  });

  it("行き先が降りる駅か、乗ったままで行き先に着けるなら出さない", () => {
    expect(
      selectAfterAlightStep({
        ...base,
        destinationStation: "塚本駅",
        waitOption: waitWithTransfer,
        options: [hankyu],
      }),
    ).toBeNull();
    expect(
      selectAfterAlightStep({ ...base, waitOption: waitStaysOn, options: [hankyu] }),
    ).toBeNull();
  });

  it("代替手段の起点が降りる駅と違えば、降りた駅から乗れないので出さない", () => {
    expect(
      selectAfterAlightStep({
        ...base,
        alightStation: "尼崎",
        waitOption: waitWithTransfer,
        options: [hankyu],
      }),
    ).toBeNull();
  });
});

describe("resolveStopScope", () => {
  it("車内の対応はその列車だけが止まり、人身事故や分からない原因は区間を止める", () => {
    expect(resolveStopScope("in_car_response")).toBe("train");
    expect(resolveStopScope("person_accident")).toBe("section");
    expect(resolveStopScope("heavy_rain")).toBe("section");
    expect(resolveStopScope(null)).toBe("section");
  });
});
