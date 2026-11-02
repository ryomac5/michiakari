import { type JudgmentEvent, JudgmentEventSchema } from "@repo/schema";

// 判断イベントに連番と時刻を付け、スキーマで検証してから送る

type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;
export type JudgmentEventBody = DistributiveOmit<JudgmentEvent, "seq" | "at">;

export type EventSink = {
  emit(body: JudgmentEventBody): Promise<void>;
  emitted(): readonly JudgmentEvent[];
};

export function createEventSink(
  write: (event: JudgmentEvent) => Promise<void>,
  resolveAt: () => string,
): EventSink {
  const events: JudgmentEvent[] = [];
  return {
    async emit(body) {
      const event = JudgmentEventSchema.parse({ ...body, seq: events.length, at: resolveAt() });
      events.push(event);
      await write(event);
    },
    emitted: () => events,
  };
}
