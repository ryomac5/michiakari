"use client";

import type { Action } from "@repo/schema";
import { useTranslations } from "next-intl";
import { cn } from "@/lib/utils";
import { actionStyles } from "../action-style";

// 判断の種類のピル。アイコン・色・ラベルを必ず併せて出す
export function ActionPill({ action, className }: { action: Action; className?: string }) {
  const t = useTranslations("judgment");
  const style = actionStyles[action];
  const Icon = style.icon;

  return (
    <span
      className={cn(
        "inline-flex h-7 shrink-0 items-center gap-1.5 rounded-full pr-3 pl-2 text-[13px] font-semibold",
        style.surface,
        style.text,
        className,
      )}
    >
      <Icon className="size-4" strokeWidth={2.25} aria-hidden />
      <span className="sr-only">{t("conclusion.label")}: </span>
      {t(`action.${action}`)}
    </span>
  );
}
