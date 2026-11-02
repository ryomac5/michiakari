"use client";

import type { Lang } from "@repo/schema";
import { useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { useTransition } from "react";
import { testIds } from "@/features/judgment/testids";
import { saveLocale } from "@/i18n/actions";
import { locales } from "@/i18n/config";
import { cn } from "@/lib/utils";

const labels: Record<Lang, string> = { ja: "JA", en: "EN" };
const names: Record<Lang, string> = { ja: "日本語", en: "English" };

export function LanguageSwitcher() {
  const t = useTranslations("app");
  const locale = useLocale();
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  function changeLocale(next: Lang) {
    if (next === locale) return;
    startTransition(async () => {
      await saveLocale(next);
      router.refresh();
    });
  }

  return (
    <fieldset
      data-testid={testIds.app.languageSwitch}
      aria-label={t("language")}
      disabled={isPending}
      className="flex shrink-0 rounded-xl border border-border bg-surface-raised"
    >
      {locales.map((l) => (
        <button
          key={l}
          type="button"
          lang={l}
          data-testid={testIds.app.language(l)}
          aria-pressed={l === locale}
          aria-label={names[l]}
          title={names[l]}
          onClick={() => changeLocale(l)}
          className={cn(
            "h-11 w-11 rounded-[11px] text-sm font-bold whitespace-nowrap text-muted",
            l === locale && "bg-foreground text-background",
          )}
        >
          {labels[l]}
        </button>
      ))}
    </fieldset>
  );
}
