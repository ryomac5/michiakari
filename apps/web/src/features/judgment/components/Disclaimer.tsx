"use client";

import { Info } from "lucide-react";
import { useTranslations } from "next-intl";
import { cn } from "@/lib/utils";
import { testIds } from "../testids";

// 推定である旨を結論の近くに常時表示する。判断側の詳しい注意書きは根拠の欄に回す
export function Disclaimer({ className }: { className?: string }) {
  const t = useTranslations("disclaimer");

  return (
    <p
      data-testid={testIds.judgment.disclaimer}
      className={cn("flex items-center gap-1.5 text-[12px] leading-snug text-muted", className)}
    >
      <Info className="size-3.5 shrink-0" strokeWidth={1.75} aria-hidden />
      {t("short")}
    </p>
  );
}
