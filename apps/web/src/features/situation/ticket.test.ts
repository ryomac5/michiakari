import { describe, expect, it } from "vitest";
import { ticketAnswerIds, toTicketAnswer, toTicketType } from "./ticket";

describe("乗車券の答え", () => {
  it("分からないなら送らず、ほかはそのまま送る", () => {
    expect(ticketAnswerIds.map(toTicketType)).toEqual(["ic", "commuter_pass", "paper", null]);
  });

  it("送らなかったときは、分からないとして復元する", () => {
    expect(toTicketAnswer(null)).toBe("unknown");
    expect(toTicketAnswer("paper")).toBe("paper");
  });
});
