"use client";

import type { Judgment } from "@repo/schema";
import { ChevronRight, Radio, TrainFront } from "lucide-react";
import { useTranslations } from "next-intl";
import {
  checkProtectionReading,
  formatQueueWait,
  formatTrackLine,
  type QueueLines,
  type RuleTranslate,
  selectQueueLines,
  selectStopReasonLine,
  selectTrackLines,
} from "../rule-outlook";
import { testIds } from "../testids";
import { NoBreakText } from "./NoBreakText";

function useRuleTranslate(): RuleTranslate {
  const t = useTranslations("judgment.rules");
  return (key, values) => t(key as never, values as never);
}

// 防護無線の事象の 1 行の読み。見出しの下に出す
export function ProtectionReading({ judgment }: { judgment: Pick<Judgment, "protection"> }) {
  const t = useRuleTranslate();
  if (!checkProtectionReading(judgment)) return null;
  return (
    <p
      data-testid={testIds.judgment.protection}
      className="flex items-center gap-1.5 text-[14px] font-medium text-hold"
    >
      <Radio className="size-4 shrink-0" strokeWidth={2} aria-hidden />
      <NoBreakText text={t("protection")} />
    </p>
  );
}

// 電車の中の判断で、自分の列車が止まった理由のいちばん高い見込みを 1 行だけ出す
export function StopReasonLine({
  judgment,
}: {
  judgment: Pick<Judgment, "protection" | "stopReasons" | "reason">;
}) {
  const t = useRuleTranslate();
  const reason = selectStopReasonLine(judgment);
  if (!reason) return null;
  return (
    <p
      data-testid={testIds.judgment.stopReason}
      data-reason={reason}
      className="flex items-center gap-1.5 text-[14px] font-medium text-muted"
    >
      <TrainFront className="size-4 shrink-0" strokeWidth={2} aria-hidden />
      <NoBreakText text={t(`stopReason.${reason}`)} />
    </p>
  );
}

// 支障の無い線路が先に動く見込みと、再開後の詰まり。どちらも無ければ出さない
// 乗り換え先があれば、その選択肢の行へ寄せる
export function RuleOutlook({
  judgment,
  onFocusOption,
}: {
  judgment: Judgment;
  onFocusOption?: (optionId: string) => void;
}) {
  const t = useRuleTranslate();
  const trackLines = selectTrackLines(judgment.unaffectedTrack);
  const queue = selectQueueLines(judgment.resumeQueue, judgment.options);
  if (trackLines.length === 0 && queue === null) return null;

  return (
    <section data-testid={testIds.judgment.ruleOutlook} className="flex flex-col gap-2">
      {trackLines.length > 0 && (
        <dl className="flex flex-col gap-1.5 text-[14px] leading-snug">
          {trackLines.map((line) => (
            <div
              key={line.side}
              data-testid={testIds.judgment.trackLine(line.side)}
              className="flex flex-col"
            >
              {line.labeled && (
                <dt className="text-[12px] text-muted">{t(`track.${line.side}Label`)}</dt>
              )}
              <dd className="font-medium">
                <NoBreakText text={formatTrackLine(t, line)} />
              </dd>
            </div>
          ))}
        </dl>
      )}
      {queue && <QueueOutlook t={t} queue={queue} onFocusOption={onFocusOption} />}
    </section>
  );
}

function QueueOutlook({
  t,
  queue,
  onFocusOption,
}: {
  t: RuleTranslate;
  queue: QueueLines;
  onFocusOption?: (optionId: string) => void;
}) {
  const optionId = queue.alightOptionId;
  return (
    <div className="flex flex-col gap-1.5 text-[14px] leading-snug">
      {queue.wait && (
        <p data-testid={testIds.judgment.queueWait}>
          <NoBreakText text={formatQueueWait(t, queue.wait)} />
        </p>
      )}
      {queue.alight &&
        (optionId && onFocusOption ? (
          <button
            type="button"
            data-testid={testIds.judgment.queueAlight}
            data-option-id={optionId}
            onClick={() => onFocusOption(optionId)}
            className="flex min-h-11 items-center gap-1 text-left font-medium text-switch"
          >
            <NoBreakText text={t("queue.alight")} />
            <ChevronRight className="size-4 shrink-0" strokeWidth={2} aria-hidden />
          </button>
        ) : (
          <p data-testid={testIds.judgment.queueAlight} data-option-id="" className="font-medium">
            <NoBreakText text={t("queue.alight")} />
          </p>
        ))}
    </div>
  );
}
