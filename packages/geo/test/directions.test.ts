import { describe, expect, it } from "vitest";
import { type LineInfo, listLineDirections } from "../src/index.ts";
import { loadGeoIndex } from "../src/node.ts";

// 路線の方面。選んだ駅から見た先の駅の並び

const geo = loadGeoIndex();

function findLine(lineId: string): LineInfo {
  const line = geo.getLine(lineId);
  if (!line) throw new Error(`${lineId} が見つかりません`);
  return line;
}

function listNames(lineId: string, stationName: string): string[][] {
  const line = findLine(lineId);
  const station = geo.listStationsOnLine(lineId).find((n) => n.name === stationName);
  if (!station) throw new Error(`${stationName} が ${lineId} にありません`);
  return listLineDirections(line, station.stationId).map((d) =>
    d.stationIds.map((id) => geo.getStation(id)?.name ?? id),
  );
}

describe("listLineDirections", () => {
  it("心斎橋の御堂筋線は、江坂の方面と中百舌鳥の方面の 2 つを返す", () => {
    const directions = listNames("osaka-metro.御堂筋線", "心斎橋");
    expect(directions).toHaveLength(2);
    const north = directions.find((d) => d.at(-1) === "江坂");
    const south = directions.find((d) => d.at(-1) === "中百舌鳥");
    expect(north?.slice(0, 3)).toEqual(["本町", "淀屋橋", "梅田"]);
    expect(north).toContain("新大阪");
    expect(south?.slice(0, 2)).toEqual(["難波", "大国町"]);
    expect(south).toContain("天王寺");
    // 選んだ駅は先の駅に含めない
    for (const d of directions) expect(d).not.toContain("心斎橋");
  });

  it("終点の駅では、方面は 1 つだけになる", () => {
    const directions = listNames("osaka-metro.御堂筋線", "中百舌鳥");
    expect(directions).toHaveLength(1);
    expect(directions[0]?.[0]).toBe("新金岡");
    expect(directions[0]?.at(-1)).toBe("江坂");
  });

  it("大阪の東海道線は京都の方面と神戸の方面を返し、1 駅だけの短い支線は除く", () => {
    const directions = listNames("jr-west.東海道線", "大阪");
    expect(directions).toHaveLength(2);
    expect(directions.some((d) => d[0] === "新大阪" && d.includes("京都"))).toBe(true);
    expect(directions.some((d) => d[0] === "塚本" && d.includes("三ノ宮"))).toBe(true);
    expect(directions.some((d) => d.length === 1 && d[0] === "福島")).toBe(false);
  });

  it("区間の分かれ目をまたいで、続く区間をつなぐ。新大阪から大阪を越えて神戸の方面へ続く", () => {
    const directions = listNames("jr-west.東海道線", "新大阪");
    const west = directions.find((d) => d[0] === "大阪");
    expect(west).toContain("三ノ宮");
    expect(west).not.toContain("新大阪");
  });

  it("環状線は、両回りとも一周の半分で切る", () => {
    const directions = listNames("jr-west.大阪環状線", "大阪");
    expect(directions).toHaveLength(2);
    expect(directions.map((d) => d[0]).sort()).toEqual(["天満", "福島"].sort());
    for (const d of directions) expect(d.length).toBeLessThanOrEqual(9);
  });

  it("路線に無い駅では空を返す", () => {
    expect(listLineDirections(findLine("osaka-metro.御堂筋線"), "jr-west.東海道線.大阪")).toEqual(
      [],
    );
  });
});
