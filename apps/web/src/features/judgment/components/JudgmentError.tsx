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
    <section
      data-testid={testIds.judgment.error}
      role="alert"
      className="flex flex-col gap-3 rounded-3xl border-2 border-danger bg-danger-surface p-4 sm:p-5"
    >
      <h2 className="flex items-center gap-2 text-2xl font-extrabold text-danger">
        <CircleAlert className="size-7" aria-hidden />
        {t("title")}
      </h2>
      <p className="text-lg">{retryable ? t("retryable") : t("fatal")}</p>
      <p className="text-sm break-all text-muted">{t("detail", { message })}</p>
      <Button
        size="lg"
        data-testid={testIds.judgment.retryButton}
        onClick={onRetry}
        className="w-full"
      >
        <RotateCcw aria-hidden />
        {t("retry")}
      </Button>
    </section>
  );
}
