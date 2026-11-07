import type { RouteOption } from "@repo/schema";
import { describe, expect, it } from "vitest";
import {
  checkRouteWalks,
  chooseFocusBounds,
  READABLE_FOCUS_ZOOM,
  selectRouteGuide,
} from "./route-focus";
import type { StationGuide } from "./station-guide";

// 地図に出す印を勧める経路にしぼり、寄せる範囲を今いる位置と行き先から選ぶ

function buildStation(key: string, recommended: boolean, position: [number, number]) {
  return {
    key,
    name: key,
    shortName: key,
    operator: "",
    position,
    placement: { wide: "top", narrow: "top" },
    lines: [],
    suspended: false,
    walkMinutes: 6,
    walkSource: "estimate",
    transferService: false,
    recommended,
    starred: recommended,
    fallback: false,
    route: null,
    optionId: null,
  } as unknown as StationGuide["stations"][number];
}

const guide: StationGuide = {
  areaId: "osaka",
  optionMarks: [],
  here: { position: [135.4959, 34.7024], name: "大阪", lines: [], recommendedLineId: null },
  alight: null,
  stations: [
    buildStation("hanshin", true, [135.4986, 34.7006]),
    buildStation("hankyu", false, [135.4983, 34.7051]),
    buildStation("kitashinchi", false, [135.4949, 34.6983]),
  ],
  walkPaths: {
    type: "FeatureCollection",
    features: ["hanshin", "hankyu", "kitashinchi"].map((key) => ({
      type: "Feature" as const,
      geometry: { type: "LineString" as const, coordinates: [] },
      properties: { key, recommended: key === "hanshin" },
    })),
  },
  walkLabels: {
    type: "FeatureCollection",
    features: ["hanshin", "hankyu", "kitashinchi"].map((key) => ({
      type: "Feature" as const,
      geometry: { type: "Point" as const, coordinates: [135.49, 34.7] as [number, number] },
      properties: { key, label: "徒歩6分", recommended: key === "hanshin" },
    })),
  },
  relevantLineIds: ["a", "b", "c", "d"],
  bounds: null,
};

const kobe: [number, number] = [135.1955, 34.6946];

describe("地図に出す案内", () => {
  it("勧める経路の駅だけを残し、ほかの駅の候補と徒歩の分を消す", () => {
    const shown = selectRouteGuide(guide, ["hanshin.本線", "jr-west.東海道線"], kobe);
    expect(shown.stations.map((s) => s.key)).toEqual(["hanshin"]);
    expect(shown.walkLabels.features.map((f) => f.properties.key)).toEqual(["hanshin"]);
    expect(shown.walkPaths.features).toHaveLength(1);
    expect(shown.relevantLineIds).toEqual(["hanshin.本線", "jr-west.東海道線"]);
  });

  it("近い範囲は今いる位置と経路の駅、広い範囲は行き先まで収める", () => {
    const shown = selectRouteGuide(guide, [], kobe);
    expect(shown.bounds?.[0][0]).toBeGreaterThan(135.4);
    expect(shown.wideBounds?.[0][0]).toBeCloseTo(kobe[0], 5);
  });
});

describe("寄せる範囲", () => {
  const shown = selectRouteGuide(guide, [], kobe);

  it("今いる位置と行き先を収めても駅が読める倍率なら、行き先まで収める", () => {
    const chosen = chooseFocusBounds(shown, () => READABLE_FOCUS_ZOOM + 0.5);
    expect(chosen.includesDestination).toBe(true);
    expect(chosen.bounds).toEqual(shown.wideBounds);
  });

  it("行き先が遠すぎて駅が読めない倍率なら、今いる位置と経路の駅を優先する", () => {
    const chosen = chooseFocusBounds(shown, (b) =>
      b === shown.wideBounds ? READABLE_FOCUS_ZOOM - 2 : 15,
    );
    expect(chosen.includesDestination).toBe(false);
    expect(chosen.bounds).toEqual(shown.bounds);
  });
});

describe("徒歩の範囲の円", () => {
  const base: RouteOption = {
    id: "a",
    kind: "transfer",
    label: "",
    legs: [{ mode: "ride", from: "大阪", to: "三ノ宮", minutes: 25 }],
    arrivalTime: "2026-11-07T20:00:00+09:00",
    fareYen: null,
    walkMinutes: 0,
    isTransferService: false,
  };

  it("経路に歩きがあるときだけ出す", () => {
    expect(checkRouteWalks(base)).toBe(false);
    expect(
      checkRouteWalks({
        ...base,
        legs: [{ mode: "walk", from: "大阪", to: "大阪梅田", minutes: 6 }, ...base.legs],
      }),
    ).toBe(true);
    expect(checkRouteWalks(undefined)).toBe(false);
  });
});
