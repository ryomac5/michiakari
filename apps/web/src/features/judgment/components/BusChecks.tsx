"use client";

import type { BusCheck } from "@repo/schema";
import { Bus, ExternalLink } from "lucide-react";
import { useTranslations } from "next-intl";
import { testIds } from "../testids";

// 近くのバス停の確認候補。停留所の名前、事業者、徒歩の目安と公式の案内だけを出す
// 時刻と運行の可否は持たないので出さない。到着の比較とおすすめにも入れない
export function BusChecksSection({ busChecks }: { busChecks: readonly BusCheck[] }) {
  const t = useTranslations("judgment.busChecks");
  const year = busChecks[0]?.dataYear;

  return (
    <section
      data-testid={testIds.judgment.busChecks}
      aria-labelledby="bus-checks-title"
      className="flex flex-col gap-2"
    >
      <h2 id="bus-checks-title" className="text-[13px] font-medium text-muted">
        {t("title")}
      </h2>
      <ul className="flex flex-col gap-2">
        {busChecks.map((check) => (
          <li
            key={check.id}
            data-testid={testIds.judgment.busCheck(check.id)}
            className="flex items-start gap-3 rounded-xl border border-border px-3 py-2.5"
          >
            <Bus className="mt-0.5 size-[18px] shrink-0 text-muted" aria-hidden />
            <div className="flex min-w-0 flex-1 flex-col gap-0.5">
              <span className="text-[15px] font-semibold">{check.stopName}</span>
              <span className="text-[13px] text-muted">
                {check.operator}・{t("walk", { minutes: check.walkMinutes })}
              </span>
              {check.officialUrl && (
                <a
                  href={check.officialUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="flex min-h-11 items-center gap-1 self-start text-[13px] font-medium text-focus underline underline-offset-4"
                >
                  {t("link", { operator: check.operator })}
                  <ExternalLink className="size-4 shrink-0" aria-hidden />
                </a>
              )}
            </div>
          </li>
        ))}
      </ul>
      <p className="text-[13px] text-muted">{t("crowded")}</p>
      {year !== undefined && <p className="text-[12px] text-muted">{t("note", { year })}</p>}
    </section>
  );
}
