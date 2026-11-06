"use client";

import type { BusCheck } from "@repo/schema";
import { ExternalLink } from "lucide-react";
import { useTranslations } from "next-intl";
import { testIds } from "../testids";

// 近くのバス停の確認候補。1 件を 2 行に収め、停留所の名前と徒歩の目安、事業者と公式の案内を詰めて出す
// 時刻と運行の可否は持たないので出さない。到着の比較とおすすめにも入れない
export function BusChecksSection({ busChecks }: { busChecks: readonly BusCheck[] }) {
  const t = useTranslations("judgment.busChecks");
  const year = busChecks[0]?.dataYear;

  return (
    <section
      data-testid={testIds.judgment.busChecks}
      aria-labelledby="bus-checks-title"
      className="flex flex-col gap-1.5"
    >
      <h2 id="bus-checks-title" className="text-[13px] font-medium text-muted">
        {t("title")}
      </h2>
      <ul className="flex flex-col divide-y divide-border">
        {busChecks.map((check) => (
          <li
            key={check.id}
            data-testid={testIds.judgment.busCheck(check.id)}
            className="flex flex-col py-1.5"
          >
            <div className="flex items-baseline justify-between gap-3">
              <span className="min-w-0 truncate text-[15px] font-semibold">{check.stopName}</span>
              <span className="shrink-0 text-[13px] text-muted">
                {t("walk", { minutes: check.walkMinutes })}
              </span>
            </div>
            <div className="flex flex-wrap items-center gap-x-3 text-[13px] text-muted">
              {check.operators.map((operator) =>
                operator.officialUrl ? (
                  // 押せる高さは 44px にし、上下の負の余白で行の高さは詰めたままにする
                  <a
                    key={operator.name}
                    href={operator.officialUrl}
                    target="_blank"
                    rel="noreferrer"
                    aria-label={t("link", { operator: operator.name })}
                    className="-my-3 inline-flex min-h-11 items-center gap-0.5 font-medium text-focus underline underline-offset-4"
                  >
                    {operator.name}
                    <ExternalLink className="size-3.5 shrink-0" aria-hidden />
                  </a>
                ) : (
                  <span key={operator.name} className="py-0.5">
                    {operator.name}
                  </span>
                ),
              )}
            </div>
          </li>
        ))}
      </ul>
      <p className="text-[12px] leading-snug text-muted">
        <span className="block">{t("crowded")}</span>
        {year !== undefined && <span className="block">{t("note", { year })}</span>}
      </p>
    </section>
  );
}
