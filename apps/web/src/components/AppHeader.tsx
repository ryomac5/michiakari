"use client";

import { FlaskConical } from "lucide-react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import type { ReactNode } from "react";
import { useJudgmentSession } from "@/features/judgment/session";
import { testIds } from "@/features/judgment/testids";
import { cn } from "@/lib/utils";
import { AppMenu } from "./AppMenu";
import { LogoMark } from "./LogoMark";

// 画面の上に浮かせる細い帯。左にロゴ、中央に画面ごとの中身、右端にメニュー
// map は地図の画面。PC 幅では左上に寄せ、右側のパネルと重ならないようにする
// float は判断の画面。帯を出さず、戻るボタンとメニューだけを地図の上の左右に浮かせる
export function AppHeader({
  children,
  leading,
  below,
  variant = "page",
}: {
  children?: ReactNode;
  // 帯の下に重ねる部品（リプレイの再生バーと発表）
  below?: ReactNode;
  // ロゴの代わりに置く部品（リプレイの「戻る」など）
  leading?: ReactNode;
  variant?: "page" | "map" | "float";
}) {
  const t = useTranslations("app");
  const { mockEnabled } = useJudgmentSession();
  const compact = children !== undefined;

  return (
    <>
      <header
        data-testid={testIds.app.header}
        className={cn(
          "pointer-events-none fixed inset-x-0 top-0 z-30 flex flex-col items-center gap-2 pt-[max(12px,env(safe-area-inset-top))] pr-[max(12px,env(safe-area-inset-right))] pl-[max(12px,env(safe-area-inset-left))]",
          variant === "map" && "lg:right-auto lg:items-start lg:px-4 lg:pt-4",
          variant === "float" && "items-stretch lg:right-[432px] lg:px-4 lg:pt-4",
        )}
      >
        <a
          href="#main"
          className="pointer-events-auto sr-only focus:not-sr-only focus:absolute focus:top-2 focus:left-2 focus:z-50 focus:rounded-xl focus:bg-primary focus:px-4 focus:py-3 focus:font-bold focus:text-primary-foreground"
        >
          {t("skipToContent")}
        </a>
        {variant === "float" ? (
          <div className="flex w-full items-start justify-between">
            <div className="glass pointer-events-auto flex size-12 items-center justify-center rounded-full">
              {leading}
            </div>
            <div className="glass pointer-events-auto flex size-12 items-center justify-center rounded-full">
              <AppMenu mock={mockEnabled} />
            </div>
          </div>
        ) : (
          <div
            className={cn(
              "glass pointer-events-auto relative flex h-14 w-full items-center gap-1 rounded-2xl pr-1 pl-1.5",
              variant === "page" ? "max-w-2xl" : "lg:w-[min(560px,calc(100vw-464px))]",
            )}
          >
            {leading ?? (
              <Link
                href="/"
                data-testid={testIds.app.homeLink}
                aria-label={`${t("name")} — ${t("home")}`}
                className={cn(
                  "flex min-h-11 min-w-11 shrink-0 items-center justify-center gap-2 rounded-xl px-1.5",
                  // 地図の画面のスマートフォン幅では帯を経路と状況に譲る。ホームへはメニューから戻れる
                  compact && "max-sm:hidden",
                )}
              >
                <LogoMark className="size-7" />
                <span
                  className={cn(
                    "text-[15px] font-bold tracking-tight whitespace-nowrap",
                    compact && "sr-only",
                  )}
                >
                  {t("name")}
                </span>
              </Link>
            )}
            <div className="flex min-w-0 flex-1 items-center gap-1">{children}</div>
            <AppMenu mock={mockEnabled && variant === "map"} />
          </div>
        )}
        {below && (
          <div
            className={cn(
              "flex w-full flex-col gap-2",
              variant === "page" ? "max-w-2xl" : "lg:w-[min(560px,calc(100vw-464px))]",
            )}
          >
            {below}
          </div>
        )}
      </header>
      {/* 地図以外の画面では下端に小さく出す。地図の画面ではメニューの中で示す */}
      {mockEnabled && variant === "page" && (
        <p
          data-testid={testIds.app.mockBadge}
          className="glass fixed bottom-[max(28px,calc(env(safe-area-inset-bottom)+20px))] left-1/2 z-10 flex -translate-x-1/2 items-center gap-1.5 rounded-full px-3 py-1 text-[12px] font-medium whitespace-nowrap text-hold"
        >
          <FlaskConical className="size-3.5" aria-hidden />
          {t("mockBadge")}
        </p>
      )}
    </>
  );
}
