import { describe, expect, it } from "vitest";
import { splitAroundClock } from "./break-even-text";
import {
  chooseHeadlineSize,
  headlineSizesRem,
  measureHeadlineWeight,
  pickInitialHeadlineSize,
  splitHeadline,
} from "./headline";

describe("splitHeadline", () => {
  it("2 文以上なら最初の 1 文を見出しにし、残りを分ける", () => {
    expect(
      splitHeadline("阪急京都線に切り替えましょう。再開して乗れる見込みでは遅く着きます。"),
    ).toEqual({
      lead: "阪急京都線に切り替えましょう。",
      rest: "再開して乗れる見込みでは遅く着きます。",
    });
    expect(splitHeadline("Switch to Hankyu. The break-even time has passed.")).toEqual({
      lead: "Switch to Hankyu.",
      rest: "The break-even time has passed.",
    });
  });

  it("1 文だけならそのまま見出しにする", () => {
    expect(splitHeadline("あと14分は待てます")).toEqual({ lead: "あと14分は待てます", rest: null });
    expect(splitHeadline("You can wait about 14 more minutes")).toEqual({
      lead: "You can wait about 14 more minutes",
      rest: null,
    });
  });

  it("英語の小数や時刻の点では切らない", () => {
    expect(splitHeadline("Wait until 21.40 for now").rest).toBeNull();
  });
});

describe("chooseHeadlineSize", () => {
  it("2 行に収まる最大の大きさを優先し、無理なら行数を許して小さくする", () => {
    expect(chooseHeadlineSize([2, 2, 1, 1, 1, 1])).toBe(0);
    expect(chooseHeadlineSize([3, 2, 2, 2, 1, 1])).toBe(1);
    expect(chooseHeadlineSize([4, 3, 3, 2, 2, 2])).toBe(3);
    expect(chooseHeadlineSize([4, 4, 3, 3, 3, 2])).toBe(2);
    expect(chooseHeadlineSize([6, 5, 5, 5, 4, 3])).toBe(4);
  });

  it("最小の大きさでも収まらなければ最小を使う", () => {
    expect(chooseHeadlineSize([9, 8, 7, 6, 6, 5])).toBe(headlineSizesRem.length - 1);
  });
});

describe("pickInitialHeadlineSize", () => {
  it("短い見出しは最大、長い見出しほど小さい段を選ぶ", () => {
    expect(pickInitialHeadlineSize("あと14分は待てます")).toBe(0);
    const long = pickInitialHeadlineSize("あ".repeat(60));
    expect(long).toBeGreaterThan(0);
    expect(long).toBeLessThan(headlineSizesRem.length);
  });

  it("英数字は和文より幅を小さく数える", () => {
    expect(measureHeadlineWeight("abcd")).toBeLessThan(measureHeadlineWeight("あいうえ"));
  });
});

describe("splitAroundClock", () => {
  const time = "2026-11-05T21:40:00+09:00";

  it("説明文の時刻を見つけ、表記を HH:MM にそろえる", () => {
    expect(
      splitAroundClock("21時40分までに再開しなければ、阪急のほうが早く着きます。", time, "ja"),
    ).toEqual({
      before: "",
      clock: "21:40",
      after: "までに再開しなければ、阪急のほうが早く着きます。",
    });
    expect(
      splitAroundClock("If service has not resumed by 21:40, Hankyu is faster.", time, "en"),
    ).toEqual({
      before: "If service has not resumed by ",
      clock: "21:40",
      after: ", Hankyu is faster.",
    });
  });

  it("時刻が無ければ null", () => {
    expect(splitAroundClock("分岐点を計算しました", time, "ja")).toBeNull();
  });
});
