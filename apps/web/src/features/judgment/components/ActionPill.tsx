"use client";

import type { Action } from "@repo/schema";
import { useTranslations } from "next-intl";
import { cn } from "@/lib/utils";
import { actionStyles } from "../action-style";
import { testIds } from "../testids";

// 判断の種類のピル。アイコン・色・ラベルを必ず併せて出す
// 線路に降りる案内が出たときは、行動の札を「待つ」と出さず「案内に従う」にする。schema の action は変えない
export function ActionPill({
  action,
  followStaff = false,
  className,
}: {
  action: Action;
  followStaff?: boolean;
  className?: string;
}) {
  const t = useTranslations("judgment");
  const style = actionStyles[action];
  const Icon = style.icon;

  return (
    <span
      data-testid={testIds.judgment.actionPill}
      data-label={followStaff ? "followStaff" : action}
      className={cn(
        "inline-flex h-7 shrink-0 items-center gap-1.5 rounded-full pr-3 pl-2 text-[13px] font-semibold",
        style.surface,
        style.text,
        className,
      )}
    >
      <Icon className="size-4" strokeWidth={2.25} aria-hidden />
      <span className="sr-only">{t("conclusion.label")}: </span>
      {followStaff ? t("action.followStaff") : t(`action.${action}`)}
    </span>
  );
}
