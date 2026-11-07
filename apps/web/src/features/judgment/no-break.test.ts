import { describe, expect, it } from "vitest";
import { splitUnbreakableRuns } from "./no-break";

function listKept(text: string): string[] {
  return splitUnbreakableRuns(text)
    .filter((run) => run.keep)
    .map((run) => run.text);
}

describe("splitUnbreakableRuns", () => {
  it("日本語の時刻と時間をひとまとまりにする", () => {
    expect(
      listKept("人身事故は、再開まで1時間ほどかかるのがふつうです。22時46分までに動きましょう。"),
    ).toEqual(["1時間ほど", "22時46分"]);
    expect(listKept("再開は23時40分頃の見込みで、あと約25分です。")).toEqual([
      "23時40分頃",
      "約25分",
    ]);
  });

  it("英語の時刻と時間をひとまとまりにする", () => {
    expect(listKept("Resumes around 22:50, about 1 hour 20 min from now.")).toEqual([
      "22:50",
      "1 hour 20 min",
    ]);
    expect(listKept("Switch by 9:05 pm. It takes 25 minutes and ¥1,200.")).toEqual([
      "9:05 pm",
      "25 minutes",
      "¥1,200",
    ]);
  });

  it("分の幅をひとまとまりにする", () => {
    expect(listKept("先へ進むまで6〜10分ほどかかる見込みです")).toEqual(["6〜10分ほど"]);
    expect(listKept("may take about 6–10 min to clear")).toEqual(["6–10 min"]);
  });

  it("元の文をそのまま並べ直せる", () => {
    const text = "阪急京都線で振替。0時14分に京都に着き、0時25分の乗り継ぎに間に合います。";
    expect(
      splitUnbreakableRuns(text)
        .map((run) => run.text)
        .join(""),
    ).toBe(text);
  });

  it("数の無い文はそのまま 1 つの区切りにする", () => {
    expect(splitUnbreakableRuns("このまま待ちましょう。")).toEqual([
      { text: "このまま待ちましょう。", keep: false },
    ]);
  });
});
