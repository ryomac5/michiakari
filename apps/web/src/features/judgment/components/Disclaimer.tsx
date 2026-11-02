"use client";

import { TriangleAlert } from "lucide-react";
import { useTranslations } from "next-intl";
import { testIds } from "../testids";

// 推定である旨を結論の直下に常時表示する。判断側の詳しい注意書きは根拠の欄に回し、ここでは同じ趣旨を重ねない
export function Disclaimer() {
  const t = useTranslations("disclaimer");

  return (
    <p
      data-testid={testIds.judgment.disclaimer}
      className="flex items-start gap-2 px-1 text-sm font-bold text-muted"
    >
      <TriangleAlert className="mt-0.5 size-4 shrink-0" aria-hidden />
      {t("short")}
    </p>
  );
}
