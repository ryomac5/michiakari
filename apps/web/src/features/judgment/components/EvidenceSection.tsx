"use client";

import type { AnnouncementCueId, DetectedSignal, Estimate, Observation } from "@repo/schema";
import { ChevronDown } from "lucide-react";
import { useTranslations } from "next-intl";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { buildEvidenceLines, selectEvidenceEntries } from "../evidence-text";
import { testIds } from "../testids";

// 根拠は見たい人だけが開ける。既定は閉
// 中身は最大 3 つの項目で、聞いたことを並べる。手がかりがあれば、その項目に読みを 1 行添える
export function EvidenceSection({
  estimate,
  signals,
  heardCause = null,
  cues = [],
  observations = [],
}: {
  estimate: Estimate | null;
  signals: readonly DetectedSignal[];
  // 入口で選んだ原因の呼び名。発表の引用が無いときに聞いた言葉として出す
  heardCause?: string | null;
  // 判断の結果の手がかり。引用に無い手がかりも読みにする
  cues?: readonly AnnouncementCueId[];
  // 判断に使った観測。手がかりを含む文を聞いた言葉にする
  observations?: readonly Observation[];
}) {
  const t = useTranslations("judgment.evidence");
  const entries = selectEvidenceEntries({ estimate, signals, heardCause, cues, observations });
  const lines = buildEvidenceLines(entries, (key, values) => t(key as never, values as never));

  return (
    <Collapsible
      data-testid={testIds.judgment.evidence}
      // 項目が無い間は隠す。更新中に消しても開いた状態を保つため、外さずに隠す
      hidden={lines.length === 0}
      className="group rounded-2xl bg-foreground/[0.03]"
    >
      <CollapsibleTrigger
        data-testid={testIds.judgment.evidenceToggle}
        className="flex min-h-12 w-full items-center justify-between gap-2 rounded-2xl px-4 text-left text-[15px] font-semibold"
      >
        {t("title")}
        <ChevronDown
          className="size-5 text-muted transition-transform duration-200 group-data-[state=open]:rotate-180"
          strokeWidth={1.75}
          aria-hidden
        />
      </CollapsibleTrigger>
      <CollapsibleContent className="px-4 pb-4">
        <ul className="flex flex-col gap-2">
          {lines.map((line) => (
            <li
              key={line.id}
              data-testid={testIds.judgment.evidenceItem(line.id)}
              data-signal-ids={line.signalIds.join(" ")}
              data-cue-id={line.cueId ?? ""}
              className="rounded-xl bg-surface px-3 py-2.5"
            >
              <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-[14px] leading-snug">
                {line.heard && (
                  <>
                    <dt className="pt-px text-[12px] text-muted">{t("heard")}</dt>
                    <dd data-testid={testIds.judgment.evidenceHeard} className="font-medium">
                      {line.heard}
                    </dd>
                  </>
                )}
                {line.reading && (
                  <>
                    <dt className="pt-px text-[12px] text-muted">{t("reading.label")}</dt>
                    <dd data-testid={testIds.judgment.evidenceReading}>{line.reading}</dd>
                  </>
                )}
              </dl>
            </li>
          ))}
        </ul>
      </CollapsibleContent>
    </Collapsible>
  );
}
