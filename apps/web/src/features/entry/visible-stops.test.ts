import { describe, expect, it } from "vitest";
import type { Position } from "./entry-places";
import {
  buildStopLabelRect,
  computeStopHitRadii,
  keepStopsIfSame,
  type StopLabel,
  selectVisibleStops,
} from "./visible-stops";

// 経度と緯度をそのまま画面の座標として扱う
const project = (position: Position) => ({ x: position[0], y: position[1] });
function stop(key: string, x: number, y: number, angle: number | null = null): StopLabel {
  return { key, position: [x, y], label: key, side: "top", angle };
}

describe("selectVisibleStops", () => {
  it("札が重なる後の駅は別の側へ回し、離れた駅はそのまま残す", () => {
    const stops = [stop("三ノ宮", 100, 100), stop("高槻", 110, 102), stop("京都", 300, 100)];
    const placed = selectVisibleStops({ stops, project, blockers: [] });
    expect(placed.map((s) => `${s.key}:${s.side}`)).toEqual([
      "三ノ宮:top",
      expect.stringMatching(/^高槻:(right|bottom|left)$/),
      "京都:top",
    ]);
  });
  it("先に置いてある札と重なる駅は、丸の別の側へ回す", () => {
    const here = buildStopLabelRect({ x: 100, y: 100 }, "いま大阪", "top");
    const stops = [stop("尼崎", 120, 104), stop("京都", 300, 100)];
    const placed = selectVisibleStops({ stops, project, blockers: [here] });
    expect(placed.map((s) => s.key)).toEqual(["尼崎", "京都"]);
    expect(placed[0]?.side).not.toBe("top");
  });
  it("どの側にも収まらない駅は落とす", () => {
    const blockers = (["top", "right", "bottom", "left"] as const).map((side) =>
      buildStopLabelRect({ x: 100, y: 100 }, "いま大阪", side),
    );
    const stops = [stop("梅田", 100, 100), stop("京都", 400, 100)];
    expect(selectVisibleStops({ stops, project, blockers }).map((s) => s.key)).toEqual(["京都"]);
  });
  it("方面の札は重なっても落とさない", () => {
    const stops = [stop("北", 100, 100, 0), stop("南", 104, 104, 180)];
    expect(selectVisibleStops({ stops, project, blockers: [] })).toHaveLength(2);
  });
});

describe("keepStopsIfSame", () => {
  it("キーと配置と札の文字が同じなら、前の配列をそのまま返す", () => {
    const prev = [stop("三ノ宮", 100, 100)];
    expect(keepStopsIfSame(prev, [stop("三ノ宮", 100, 100)])).toBe(prev);
  });
  it("文字だけが変わったら、新しい配列を返す", () => {
    const prev = [stop("三ノ宮", 100, 100)];
    const next = [{ ...stop("三ノ宮", 100, 100), label: "Sannomiya" }];
    expect(keepStopsIfSame(prev, next)).toBe(next);
  });
  it("配置が変わったら、新しい配列を返す", () => {
    const prev = [stop("三ノ宮", 100, 100)];
    const next = [{ ...stop("三ノ宮", 100, 100), side: "right" as const }];
    expect(keepStopsIfSame(prev, next)).toBe(next);
  });
});

describe("路線の札", () => {
  it("路線の札は路線色の印のぶん幅を広く見積もる", () => {
    const point = { x: 100, y: 100 };
    const plain = buildStopLabelRect(point, "JR環状線", "right");
    const line = buildStopLabelRect(point, "JR環状線", "right", true);
    expect(line.right - line.left).toBeGreaterThan(plain.right - plain.left);
  });
});

describe("computeStopHitRadii", () => {
  it("押せる丸は隣の印との中ほどまでにし、離れていれば 24px にする", () => {
    const radii = computeStopHitRadii([
      { x: 0, y: 0 },
      { x: 30, y: 0 },
      { x: 200, y: 0 },
    ]);
    expect(radii).toEqual([15, 15, 24]);
    expect(computeStopHitRadii([{ x: 0, y: 0 }], [{ x: 10, y: 0 }])).toEqual([5]);
  });
});

describe("computeStopHitRadii の重なり", () => {
  it("16px より近い印どうしでも、押せる丸を中点の内側に収める", () => {
    const points = [
      { x: 0, y: 0 },
      { x: 10, y: 0 },
    ];
    const [a = 0, b = 0] = computeStopHitRadii(points);
    expect(a + b).toBeLessThanOrEqual(10);
    const [c = 0] = computeStopHitRadii([{ x: 0, y: 0 }], [{ x: 6, y: 0 }]);
    expect(c).toBeLessThanOrEqual(3);
  });
});
