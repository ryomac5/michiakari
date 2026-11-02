"use client";

import { TriangleAlert } from "lucide-react";
import { useTranslations } from "next-intl";
import { testIds } from "../testids";

// 推定である旨を結論の直下に常時表示する。判断側の注意書きが別の内容なら併記する
export function Disclaimer({ extra }: { extra: string | null }) {
  const t = useTranslations("disclaimer");
  const fixed = t("short");
  const showExtra = extra !== null && extra.trim() !== fixed;

  return (
    <div
      data-testid={testIds.judgment.disclaimer}
      className="flex items-start gap-2 px-1 text-sm text-muted"
    >
      <TriangleAlert className="mt-0.5 size-4 shrink-0" aria-hidden />
      <p>
        <span className="font-bold">{fixed}</span>
        {showExtra && <span className="block">{extra}</span>}
      </p>
    </div>
  );
}
