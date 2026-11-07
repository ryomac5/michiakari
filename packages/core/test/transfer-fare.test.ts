import type { RouteLeg, RouteOption } from "@repo/schema";
import { describe, expect, it } from "vitest";
import {
  applyTransferFares,
  chooseBestAlternative,
  decideTransferFare,
  findOperatorKeysInText,
} from "../src/index.ts";

function ride(lineId: string): RouteLeg {
  return { mode: "ride", from: "A", to: "B", minutes: 10, lineId };
}

// 振替輸送の実施が発表で分かり、振替先に阪急と阪神が書かれている
const announced = {
  transferServiceActive: true,
  transferOperators: ["hankyu", "hanshin"],
  blockedOperator: "jr-west",
} as const;

describe("decideTransferFare", () => {
  it("定期券と紙の切符は、乗り換え先が発表の振替先に含まれれば振替の対象", () => {
    for (const ticketType of ["commuter_pass", "paper"] as const) {
      expect(decideTransferFare({ ...announced, ticketType, rideOperators: ["hankyu"] })).toBe(
        "covered",
      );
    }
  });

  it("発表に振替先の事業者が書かれていなければ、振替の対象になりうるにとどめる", () => {
    expect(
      decideTransferFare({
        ...announced,
        transferOperators: [],
        ticketType: "commuter_pass",
        rideOperators: ["hankyu"],
      }),
    ).toBe("possibly_covered");
    // 止まっている会社だけが書かれているのも、振替先が書かれていないとみなす
    expect(
      decideTransferFare({
        ...announced,
        transferOperators: ["jr-west"],
        ticketType: "paper",
        rideOperators: ["hankyu"],
      }),
    ).toBe("possibly_covered");
  });

  it("乗り換え先が発表の振替先に無ければ、振替の対象と言わない", () => {
    expect(
      decideTransferFare({ ...announced, ticketType: "commuter_pass", rideOperators: ["keihan"] }),
    ).toBeNull();
  });

  it("振替輸送の実施が分からなければ、定期券と紙の切符には何も出さない", () => {
    for (const ticketType of ["commuter_pass", "paper"] as const) {
      expect(
        decideTransferFare({
          ...announced,
          transferServiceActive: null,
          ticketType,
          rideOperators: ["hankyu"],
        }),
      ).toBeNull();
    }
  });

  it("IC カードは振替輸送の対象外なので、実施が分かっても分からなくても運賃がかかる", () => {
    for (const transferServiceActive of [true, null]) {
      expect(
        decideTransferFare({
          ...announced,
          transferServiceActive,
          ticketType: "ic",
          rideOperators: ["hankyu"],
        }),
      ).toBe("fare_required");
    }
  });

  it("発表に振替輸送を行わないとあれば、乗車券の種類によらず運賃がかかる", () => {
    for (const ticketType of ["commuter_pass", "paper", "ic", null] as const) {
      expect(
        decideTransferFare({
          ...announced,
          transferServiceActive: false,
          ticketType,
          rideOperators: ["hanshin"],
        }),
      ).toBe("fare_required");
    }
  });

  it("乗車券も振替なしの発表も無ければ決めない", () => {
    expect(
      decideTransferFare({ ...announced, ticketType: null, rideOperators: ["hankyu"] }),
    ).toBeNull();
  });

  it("同じ会社の線だけに乗るなら決めない", () => {
    expect(
      decideTransferFare({ ...announced, ticketType: "ic", rideOperators: ["jr-west"] }),
    ).toBeNull();
  });

  it("調べの出典で扱いを確かめていない事業者を含むなら決めない", () => {
    expect(
      decideTransferFare({ ...announced, ticketType: "ic", rideOperators: ["hankyu", "nose"] }),
    ).toBeNull();
    expect(
      decideTransferFare({
        ...announced,
        blockedOperator: "sanyo",
        ticketType: "ic",
        rideOperators: ["hanshin"],
      }),
    ).toBeNull();
  });

  it("止まっている線の会社か、乗る線の会社が分からなければ決めない", () => {
    expect(
      decideTransferFare({
        ...announced,
        blockedOperator: null,
        ticketType: "ic",
        rideOperators: ["hankyu"],
      }),
    ).toBeNull();
    expect(
      decideTransferFare({ ...announced, ticketType: "ic", rideOperators: ["hankyu", null] }),
    ).toBeNull();
  });
});

describe("findOperatorKeysInText", () => {
  it("文に書かれた事業者名を事業者キーにする", () => {
    expect(
      findOperatorKeysInText("阪急線、阪神線、JR線で振替輸送を行っています").toSorted(),
    ).toEqual(["hankyu", "hanshin", "jr-west"]);
    expect(findOperatorKeysInText("振替輸送を行っています")).toEqual([]);
  });
});

type Option = Pick<RouteOption, "id" | "kind" | "legs" | "transferFare">;

const options: Option[] = [
  { id: "wait", kind: "wait", legs: [ride("jr-west.東海道線")] },
  { id: "other", kind: "transfer", legs: [ride("jr-west.東海道線"), ride("hankyu.神戸線")] },
  { id: "same", kind: "transfer", legs: [ride("jr-west.福知山線")] },
  { id: "taxi", kind: "taxi", legs: [{ mode: "taxi", from: "A", to: "B", minutes: 20 }] },
];

describe("applyTransferFares", () => {
  it("他社の線へ乗り換える選択肢にだけ費用の印を付ける", () => {
    const applied = applyTransferFares({
      options,
      ticketType: "ic",
      transferServiceActive: null,
      blockedLineId: "jr-west.東海道線",
    });
    expect(applied.map((o) => [o.id, o.transferFare])).toEqual([
      ["wait", undefined],
      ["other", "fare_required"],
      ["same", undefined],
      ["taxi", undefined],
    ]);
  });

  it("止まっている会社を事業者名から決め、発表の振替先の事業者名を事業者キーにそろえる", () => {
    const applied = applyTransferFares({
      options,
      ticketType: "commuter_pass",
      transferServiceActive: true,
      transferOperators: ["阪急電鉄"],
      blockedLineId: null,
      blockedOperatorName: "JR西日本",
    });
    expect(applied.find((o) => o.id === "other")?.transferFare).toBe("covered");
  });

  it("乗車券が分からず振替なしの発表も無ければ、前に付いた印も外す", () => {
    const marked = options.map((o) => ({ ...o, transferFare: "covered" as const }));
    const applied = applyTransferFares({
      options: marked,
      ticketType: null,
      transferServiceActive: null,
      blockedLineId: "jr-west.東海道線",
    });
    expect(applied.every((o) => !("transferFare" in o))).toBe(true);
  });
});

describe("chooseBestAlternative の同着", () => {
  const at = "2026-11-07T20:30:00+09:00";

  it("同着なら振替の対象の選択肢を上げる", () => {
    const choice = chooseBestAlternative([
      { id: "ic", kind: "transfer", arrivalTime: at, transferFare: "fare_required" },
      { id: "unknown", kind: "transfer", arrivalTime: at },
      { id: "covered", kind: "transfer", arrivalTime: at, transferFare: "covered" },
    ]);
    expect(choice?.alternative.id).toBe("covered");
  });

  it("振替の対象が無い同着は、費用によらず先に並んだものを勧める", () => {
    const fareFirst = chooseBestAlternative([
      { id: "ic", kind: "transfer", arrivalTime: at, transferFare: "fare_required" },
      { id: "unknown", kind: "transfer", arrivalTime: at },
    ]);
    expect(fareFirst?.alternative.id).toBe("ic");
    const possibleLater = chooseBestAlternative([
      { id: "unknown", kind: "transfer", arrivalTime: at },
      { id: "possible", kind: "transfer", arrivalTime: at, transferFare: "possibly_covered" },
    ]);
    expect(possibleLater?.alternative.id).toBe("unknown");
  });

  it("早く着くほうを費用より優先する", () => {
    const choice = chooseBestAlternative([
      { id: "covered", kind: "transfer", arrivalTime: at, transferFare: "covered" },
      {
        id: "ic",
        kind: "transfer",
        arrivalTime: "2026-11-07T20:29:00+09:00",
        transferFare: "fare_required",
      },
    ]);
    expect(choice?.alternative.id).toBe("ic");
  });
});
