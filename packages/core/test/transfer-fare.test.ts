import type { RouteLeg, RouteOption } from "@repo/schema";
import { describe, expect, it } from "vitest";
import { applyTransferFares, chooseBestAlternative, decideTransferFare } from "../src/index.ts";

function ride(lineId: string): RouteLeg {
  return { mode: "ride", from: "A", to: "B", minutes: 10, lineId };
}

const base = { transferServiceActive: null, blockedOperator: "jr-west" } as const;

describe("decideTransferFare", () => {
  it("定期券と紙の切符は、他社の線への乗り換えに追加の運賃がかからない", () => {
    for (const ticketType of ["commuter_pass", "paper"] as const) {
      expect(decideTransferFare({ ...base, ticketType, rideOperators: ["hankyu"] })).toBe(
        "covered",
      );
    }
  });

  it("IC カードは振替輸送の対象外なので運賃がかかる", () => {
    expect(decideTransferFare({ ...base, ticketType: "ic", rideOperators: ["hankyu"] })).toBe(
      "fare_required",
    );
  });

  it("発表に振替輸送を行わないとあれば、乗車券の種類によらず運賃がかかる", () => {
    expect(
      decideTransferFare({
        ...base,
        transferServiceActive: false,
        ticketType: "commuter_pass",
        rideOperators: ["hanshin"],
      }),
    ).toBe("fare_required");
  });

  it("発表で振替輸送の実施が分かっていても、IC カードは運賃がかかる", () => {
    expect(
      decideTransferFare({
        ...base,
        transferServiceActive: true,
        ticketType: "ic",
        rideOperators: ["hanshin"],
      }),
    ).toBe("fare_required");
  });

  it("乗車券が分からなければ決めない", () => {
    expect(decideTransferFare({ ...base, ticketType: null, rideOperators: ["hankyu"] })).toBeNull();
  });

  it("同じ会社の線だけに乗るなら決めない", () => {
    expect(
      decideTransferFare({ ...base, ticketType: "paper", rideOperators: ["jr-west"] }),
    ).toBeNull();
  });

  it("調べの出典で扱いを確かめていない事業者を含むなら決めない", () => {
    expect(
      decideTransferFare({ ...base, ticketType: "paper", rideOperators: ["hankyu", "nose"] }),
    ).toBeNull();
    expect(
      decideTransferFare({
        ...base,
        blockedOperator: "sanyo",
        ticketType: "paper",
        rideOperators: ["hanshin"],
      }),
    ).toBeNull();
  });

  it("止まっている線の会社か、乗る線の会社が分からなければ決めない", () => {
    expect(
      decideTransferFare({
        ...base,
        blockedOperator: null,
        ticketType: "paper",
        rideOperators: ["hankyu"],
      }),
    ).toBeNull();
    expect(
      decideTransferFare({ ...base, ticketType: "paper", rideOperators: ["hankyu", null] }),
    ).toBeNull();
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

  it("路線 ID が無ければ事業者名から止まっている会社を決める", () => {
    const applied = applyTransferFares({
      options,
      ticketType: "commuter_pass",
      transferServiceActive: true,
      blockedLineId: null,
      blockedOperatorName: "JR西日本",
    });
    expect(applied.find((o) => o.id === "other")?.transferFare).toBe("covered");
  });

  it("乗車券が分からなければ、前に付いた印も外す", () => {
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

  it("同着なら追加の運賃がかからない選択肢を勧める", () => {
    const choice = chooseBestAlternative([
      { id: "ic", kind: "transfer", arrivalTime: at, transferFare: "fare_required" },
      { id: "unknown", kind: "transfer", arrivalTime: at },
      { id: "covered", kind: "transfer", arrivalTime: at, transferFare: "covered" },
    ]);
    expect(choice?.alternative.id).toBe("covered");
  });

  it("運賃がかかる選択肢は、費用の分からない同着の選択肢より後にする", () => {
    const choice = chooseBestAlternative([
      { id: "ic", kind: "transfer", arrivalTime: at, transferFare: "fare_required" },
      { id: "unknown", kind: "transfer", arrivalTime: at },
    ]);
    expect(choice?.alternative.id).toBe("unknown");
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
