import { describe, expect, it } from "vitest";
import { parseTransferOperators, parseTransferServiceActive } from "../src/interpret/parse-text.ts";

// 発表文から振替輸送の実施と振替先の事業者を拾う。打ち消しを肯定より先に見る

describe("parseTransferServiceActive", () => {
  it("打ち消しの書き方は、実施していないと読む", () => {
    for (const text of [
      "振替輸送は行っておりません。",
      "振替輸送は実施しておりません。",
      "振替輸送は行っていません。",
      "振替輸送は実施していません。",
      "振替輸送は行いません。",
      "振替輸送を行わない予定です。",
      "振替輸送は終了しました。",
    ]) {
      expect(parseTransferServiceActive(text), text).toBe(false);
    }
  });

  it("実施の書き方は、実施していると読む", () => {
    for (const text of [
      "振替輸送を行っています。",
      "振替輸送を実施しております。",
      "阪急線で振替輸送を実施中です。",
    ]) {
      expect(parseTransferServiceActive(text), text).toBe(true);
    }
  });

  it("振替輸送が書かれていなければ分からない", () => {
    expect(parseTransferServiceActive("運転を見合わせています。")).toBeNull();
  });
});

describe("parseTransferOperators", () => {
  it("振替輸送の文に書かれた事業者だけを拾う", () => {
    const text = "JR神戸線は運転を見合わせています。阪急線、阪神線で振替輸送を行っています。";
    expect(parseTransferOperators(text).toSorted()).toEqual(["hankyu", "hanshin"]);
  });

  it("振替先が書かれていなければ空", () => {
    expect(parseTransferOperators("振替輸送を行っています。")).toEqual([]);
  });
});
