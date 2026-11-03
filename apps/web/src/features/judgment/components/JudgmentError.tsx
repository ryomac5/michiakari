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
      className="flex flex-col gap-2.5 rounded-[20px] bg-danger-surface p-4"
    >
      <h2 className="flex items-center gap-2.5 text-[17px] font-bold text-danger">
        <span
          aria-hidden
          className="flex size-8 items-center justify-center rounded-full bg-surface shadow-[0_1px_4px_rgb(0_0_0/0.1)]"
        >
          <CircleAlert className="size-[18px]" strokeWidth={2} />
        </span>
        {t("title")}
      </h2>
      <p className="text-[15px]">{retryable ? t("retryable") : t("fatal")}</p>
      <p className="text-[12px] break-all text-muted">{t("detail", { message })}</p>
      <Button
        data-testid={testIds.judgment.retryButton}
        onClick={onRetry}
        className="w-full rounded-full"
      >
        <RotateCcw aria-hidden />
        {t("retry")}
      </Button>
    </section>
  );
}
