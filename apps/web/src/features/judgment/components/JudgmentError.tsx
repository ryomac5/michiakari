"use client";

import { CircleAlert, RotateCcw } from "lucide-react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { testIds } from "../testids";

export function JudgmentError({
  message,
  retryable,
  onRetry,
}: {
  message: string;
  retryable: boolean;
  onRetry: () => void;
}) {
  const t = useTranslations("judgment.error");

  return (
    <section data-testid={testIds.judgment.error} role="alert" className="flex flex-col gap-2.5">
      <h2 className="flex items-center gap-2 text-[17px] font-semibold text-danger">
        <CircleAlert className="size-5" strokeWidth={1.75} aria-hidden />
        {t("title")}
      </h2>
      <p className="text-[15px]">{retryable ? t("retryable") : t("fatal")}</p>
      <p className="text-[12px] break-all text-muted">{t("detail", { message })}</p>
      <Button data-testid={testIds.judgment.retryButton} onClick={onRetry} className="w-full">
        <RotateCcw aria-hidden />
        {t("retry")}
      </Button>
    </section>
  );
}
