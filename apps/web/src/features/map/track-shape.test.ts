import { describe, expect, it } from "vitest";
import { listTrackParts, sliceTrackBetween, type TrackPosition } from "./track-shape";

// 東西にのびる架空の線路。部品の向きと並びはばらばら
const west: TrackPosition[] = [
  [135.0, 34.7],
  [135.01, 34.705],
  [135.02, 34.7],
];
const middle: TrackPosition[] = [
  [135.04, 34.71],
  [135.03, 34.705],
  [135.02, 34.7],
];
const east: TrackPosition[] = [
  [135.04, 34.71],
  [135.05, 34.7],
];
const parts = [east, west, middle];

describe("sliceTrackBetween", () => {
  it("並びも向きもばらばらの部品をつなぎ、2 点の間の線路の頂点を順にたどる", () => {
    const path = sliceTrackBetween(parts, [135.0, 34.7], [135.05, 34.7]);
    expect(path).toEqual([
      [135.0, 34.7],
      [135.01, 34.705],
      [135.02, 34.7],
      [135.03, 34.705],
      [135.04, 34.71],
      [135.05, 34.7],
    ]);
  });

  it("線路から少し離れた駅の点は、線路の上へ下ろしてから切り出す", () => {
    const path = sliceTrackBetween(parts, [135.0, 34.7008], [135.0248, 34.7029]) ?? [];
    // 両端は線路の上の点で、途中は線路の頂点だけ
    expect(path[0]?.[0]).toBeCloseTo(135.0, 3);
    expect(path[0]?.[1]).toBeCloseTo(34.7, 3);
    expect(path.slice(1, -1)).toEqual([
      [135.01, 34.705],
      [135.02, 34.7],
    ]);
    expect(path.at(-1)?.[0]).toBeCloseTo(135.025, 3);
    expect(path.at(-1)?.[1]).toBeCloseTo(34.7025, 3);
  });

  it("逆向きに切り出すと同じ道筋を逆にたどる", () => {
    const forward = sliceTrackBetween(parts, [135.0, 34.7], [135.04, 34.71]);
    const backward = sliceTrackBetween(parts, [135.04, 34.71], [135.0, 34.7]);
    expect(backward).toEqual([...(forward ?? [])].reverse());
  });

  it("同じ区間の上の 2 点は、その区間の中で直接つなぐ", () => {
    const path = sliceTrackBetween([west], [135.002, 34.701], [135.008, 34.704]);
    expect(path).toHaveLength(2);
  });

  it("少しのすき間がある部品はつなぎ、大きく離れた部品はつながない", () => {
    const near: TrackPosition[][] = [
      [
        [135.0, 34.7],
        [135.01, 34.7],
      ],
      // 約 20m のすき間
      [
        [135.0102, 34.7],
        [135.02, 34.7],
      ],
    ];
    expect(sliceTrackBetween(near, [135.0, 34.7], [135.02, 34.7])).not.toBeNull();
    const far: TrackPosition[][] = [
      [
        [135.0, 34.7],
        [135.01, 34.7],
      ],
      // 約 900m のすき間
      [
        [135.02, 34.7],
        [135.03, 34.7],
      ],
    ];
    expect(sliceTrackBetween(far, [135.0, 34.7], [135.03, 34.7])).toBeNull();
  });

  it("線路から離れすぎた点では切り出さない", () => {
    expect(sliceTrackBetween(parts, [135.0, 34.75], [135.05, 34.7])).toBeNull();
  });
});

describe("listTrackParts", () => {
  it("LineString は 1 つの部品、MultiLineString は部品の並びにする", () => {
    expect(listTrackParts({ type: "LineString", coordinates: west })).toEqual([west]);
    expect(listTrackParts({ type: "MultiLineString", coordinates: [west, east] })).toEqual([
      west,
      east,
    ]);
  });
});
