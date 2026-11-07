import type { TicketType } from "@repo/schema";

// 入口で聞く乗車券の種類。分からないなら送らず、乗り換え先の費用を決めない
export const ticketAnswerIds = ["ic", "commuter_pass", "paper", "unknown"] as const;
export type TicketAnswer = (typeof ticketAnswerIds)[number];

export function toTicketType(answer: TicketAnswer): TicketType | null {
  return answer === "unknown" ? null : answer;
}

export function toTicketAnswer(ticketType: TicketType | null): TicketAnswer {
  return ticketType ?? "unknown";
}
