import { describe, expect, it } from "vitest";
import { createAmedasRainFetcher } from "../src/tools/jma-amedas.ts";

describe("createAmedasRainFetcher", () => {
  it("取得に失敗したら null を返し、位置を含まない警告を出す", async () => {
    const warnings: string[] = [];
    const fetcher = createAmedasRainFetcher(
      async () => {
        throw new Error("network down");
      },
      (message) => warnings.push(message),
    );
    const result = await fetcher({
      coord: [135.4959, 34.7025],
      now: "2026-11-05T21:00:00+09:00",
      windowMinutes: 60,
    });
    expect(result).toBeNull();
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).not.toContain("135.49");
    expect(warnings[0]).not.toContain("34.70");
  });
});
