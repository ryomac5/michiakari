import { describe, expect, it } from "vitest";
import { findFlowWording } from "../src/domain/flow-wording.ts";

// 事象の決まった流れと、再開までの時間の言い切りの検出。修飾の言葉、助詞、再開の言い方の揺れを含める

const modifiers = ["ふつう", "通常", "たいてい", "普段は", "だいたい", "おおむね", "多くの場合"];
const resumes = ["再開します", "運転を再開します", "動き出します", "復旧します"];

describe("findFlowWording", () => {
  it("修飾の言葉と再開の言い方の組み合わせを、時間の有無にかかわらず検出する", () => {
    for (const modifier of modifiers) {
      for (const resume of resumes) {
        for (const text of [
          `人身事故は${modifier}1時間で${resume.replace("します", "します。")}`,
          `${modifier}、約1時間ほどで${resume}。`,
          `${modifier}すぐに${resume}。`,
        ]) {
          expect(findFlowWording(text, "ja"), text).not.toBeNull();
        }
      }
    }
  });

  it("修飾の言葉が無くても、時間の長さで再開を言い切る文を検出する", () => {
    for (const text of [
      "通常1時間で再開",
      "1時間ほどで運転を再開します。",
      "約1時間で再開します。",
      "5〜10分で動き出します。",
      "1時間30分くらいで復旧します。",
      "30分程度で運転が再開されます。",
      "再開までは1時間ほどかかります。",
      "人身事故のよくある流れでは、まもなく再開します。",
    ]) {
      expect(findFlowWording(text, "ja"), text).not.toBeNull();
    }
  });

  it("英語でも、修飾の言葉と再開の言い方、時間の長さでの言い切りを検出する", () => {
    for (const text of [
      "Service usually resumes in about 1 h.",
      "Trains normally restart within 30 min.",
      "In most cases, service recovers quickly.",
      "Service generally starts moving again soon.",
      "Service restarts in about 1 h.",
      "It takes about 1 h to restart.",
      "Typical flow of the incident.",
    ]) {
      expect(findFlowWording(text, "en"), text).not.toBeNull();
    }
  });

  it("推定と分かる見込みの文と、見込みの図の幅を言う文は通す", () => {
    for (const text of [
      "再開は23時40分頃の見込みで境目より後です。",
      "23時23分を過ぎると阪急京都線が早く着きます。再開見込みは23時40分〜23時55分頃です。",
      "境目の23時23分までに動く見込みは3割です。",
      "塚本には22時13分ごろに着く見込みです。前の列車との間隔はふだんどおりと仮定しています。",
      "発表の再開が23時00分なら待つほうが早く着きます。",
      "再開見込みの幅は図で示しています。",
      "このまま待つほうが早く着きます。",
      "遅めに見ると境目より後の0時00分までに動く見込みは8割です。",
    ]) {
      expect(findFlowWording(text, "ja"), text).toBeNull();
    }
    for (const text of [
      "Restart is expected around 23:40, after the 23:23 cutoff.",
      "Chance of restart by the 23:23 cutoff: 30%.",
      "If the announced 23:00 restart holds, waiting is faster.",
      "Staying put gets you there sooner.",
    ]) {
      expect(findFlowWording(text, "en"), text).toBeNull();
    }
  });
});
