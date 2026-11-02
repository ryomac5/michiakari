"use client";

import type { Judgment } from "@repo/schema";
import { useTranslations } from "next-intl";

// 結論が出たり変わったりしたときに、支援技術へ短く読み上げさせる。見た目には出さない
export function ConclusionAnnouncer({ judgment }: { judgment: Judgment | null }) {
  const t = useTranslations("judgment");

  return (
    <p aria-live="polite" aria-atomic="true" className="sr-only">
      {judgment
        ? t("conclusion.live", {
            action: t(`action.${judgment.action}`),
            headline: judgment.headline,
          })
        : ""}
    </p>
  );
}
