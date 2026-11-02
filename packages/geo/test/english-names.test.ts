import { describe, expect, it } from "vitest";
import { formatLineName, formatRouteLabel, formatStationName } from "../src/index.ts";
import { loadGeoIndex, loadNetworkData } from "../src/node.ts";

// 英語の利用者向けの路線名・駅名

const network = loadNetworkData();
const geo = loadGeoIndex();

const findLine = (lineId: string) => {
  const line = geo.getLine(lineId);
  if (!line) throw new Error(`${lineId} が見つかりません`);
  return line;
};

const findStation = (name: string) => {
  const station = network.nodes.find((n) => n.name === name);
  if (!station) throw new Error(`${name} が見つかりません`);
  return station;
};

describe("データの英語名", () => {
  it("すべての路線が英語の路線名と事業者名を持つ", () => {
    const missing = network.lines.filter((l) => !l.nameEn || !l.operatorEn).map((l) => l.lineId);
    expect(missing).toEqual([]);
  });

  it("英語名は ASCII だけで書く", () => {
    const names = [
      ...network.lines.flatMap((l) => [l.nameEn ?? "", l.operatorEn ?? ""]),
      ...network.nodes.map((n) => n.nameEn ?? ""),
    ];
    expect(names.filter((n) => !/^[\x20-\x7e]*$/.test(n))).toEqual([]);
  });

  it("読みのある駅だけが英語名を持つ", () => {
    expect(network.nodes.filter((n) => n.nameEn && !n.reading)).toEqual([]);
    expect(network.nodes.filter((n) => n.reading && !n.nameEn)).toEqual([]);
  });
});

describe("formatLineName", () => {
  it("ja は従来の表示名", () => {
    expect(formatLineName(findLine("hankyu.神戸線"))).toBe("阪急神戸線");
    expect(formatLineName(findLine("osaka-metro.御堂筋線"), "ja")).toBe("地下鉄御堂筋線");
  });

  it("en は英語名", () => {
    expect(formatLineName(findLine("hankyu.神戸線"), "en")).toBe("Hankyu Kobe Line");
    expect(formatLineName(findLine("osaka-metro.御堂筋線"), "en")).toBe(
      "Osaka Metro Midosuji Line",
    );
    expect(formatLineName(findLine("jr-west.福知山線"), "en")).toBe("JR Takarazuka Line");
  });

  it("英語名がなければ日本語名で代用する", () => {
    const line = { ...findLine("hankyu.神戸線"), nameEn: undefined };
    expect(formatLineName(line, "en")).toBe("阪急神戸線");
  });
});

describe("formatStationName", () => {
  it("en は英語名、ja は日本語名", () => {
    expect(formatStationName(findStation("大阪梅田"), "en")).toBe("Osaka-umeda");
    expect(formatStationName(findStation("神戸三宮"), "en")).toBe("Kobe-sannomiya");
    expect(formatStationName(findStation("天王寺"), "en")).toBe("Tennoji");
    expect(formatStationName(findStation("京橋"), "en")).toBe("Kyobashi");
    expect(formatStationName(findStation("天王寺"))).toBe("天王寺");
  });

  it("英語名のない駅は日本語名で代用する", () => {
    const station = network.nodes.find((n) => !n.nameEn);
    expect(station).toBeDefined();
    if (station) expect(formatStationName(station, "en")).toBe(station.name);
  });
});

describe("formatRouteLabel", () => {
  const base = { isTransferService: false } as const;

  it("ja は経路のラベルと同じ書き方", () => {
    expect(formatRouteLabel({ ...base, kind: "wait", line: "JR神戸線" })).toBe(
      "JR神戸線の運転再開を待つ",
    );
    expect(
      formatRouteLabel({ kind: "transfer", isTransferService: true, line: "阪急神戸線" }),
    ).toBe("阪急神戸線で振替");
    expect(formatRouteLabel({ ...base, kind: "transfer", line: "阪急神戸線" })).toBe(
      "阪急神戸線経由",
    );
    expect(formatRouteLabel({ ...base, kind: "taxi", line: null })).toBe("タクシー");
  });

  it("en は英語のラベル", () => {
    expect(formatRouteLabel({ ...base, kind: "wait", line: "JR Kobe Line" }, "en")).toBe(
      "Wait for JR Kobe Line to resume",
    );
    expect(
      formatRouteLabel(
        { kind: "transfer", isTransferService: true, line: "Hankyu Kobe Line" },
        "en",
      ),
    ).toBe("Transfer service via Hankyu Kobe Line");
    expect(formatRouteLabel({ ...base, kind: "transfer", line: "Hanshin Main Line" }, "en")).toBe(
      "Via Hanshin Main Line",
    );
    expect(formatRouteLabel({ ...base, kind: "walk", line: null }, "en")).toBe("Walk");
  });
});
