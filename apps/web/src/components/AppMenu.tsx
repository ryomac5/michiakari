"use client";

import { ChevronRight, FlaskConical, Info, Map as MapIcon, Menu, X } from "lucide-react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { type ReactNode, useEffect, useId, useRef, useState } from "react";
import { testIds } from "@/features/judgment/testids";
import { LanguageSwitcher } from "./LanguageSwitcher";
import { ThemeToggle } from "./ThemeToggle";

// 言語・テーマ・情報をまとめたメニュー。上部の帯の右端に置く
// mock のときは、デモ用の架空データで表示していることをメニューの中で示し、ボタンに小さな印を付ける
export function AppMenu({ mock = false }: { mock?: boolean }) {
  const t = useTranslations("app");
  const [open, setOpen] = useState(false);
  const panelId = useId();
  const rootRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  // 開いたら最初の操作部品へ、Esc で閉じたらボタンへフォーカスを戻す
  useEffect(() => {
    if (!open) return;
    panelRef.current?.querySelector<HTMLElement>("button, a")?.focus();
    function handleKey(e: KeyboardEvent) {
      if (e.key !== "Escape") return;
      setOpen(false);
      buttonRef.current?.focus();
    }
    function handlePointer(e: PointerEvent) {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("keydown", handleKey);
    document.addEventListener("pointerdown", handlePointer);
    return () => {
      document.removeEventListener("keydown", handleKey);
      document.removeEventListener("pointerdown", handlePointer);
    };
  }, [open]);

  return (
    <div ref={rootRef} className="relative shrink-0">
      <button
        ref={buttonRef}
        type="button"
        data-testid={testIds.app.menuButton}
        aria-expanded={open}
        aria-controls={panelId}
        aria-label={t("menu.label")}
        title={t("menu.label")}
        onClick={() => setOpen((v) => !v)}
        className="relative inline-flex size-11 items-center justify-center rounded-xl text-foreground transition-colors hover:bg-foreground/5"
      >
        {mock && (
          <span aria-hidden className="absolute top-2 right-2 size-2 rounded-full bg-hold-border" />
        )}
        {open ? (
          <X className="size-5" strokeWidth={1.75} aria-hidden />
        ) : (
          <Menu className="size-5" strokeWidth={1.75} aria-hidden />
        )}
      </button>
      <div
        ref={panelRef}
        id={panelId}
        data-testid={testIds.app.menu}
        hidden={!open}
        className="glass-strong absolute top-[calc(100%+12px)] right-0 z-40 flex w-[min(300px,calc(100vw-24px))] animate-drop-in flex-col gap-2 rounded-[24px] p-2"
      >
        {/* 表示の設定。言語とテーマを 1 枚の面にまとめる */}
        <div className="flex flex-col rounded-[18px] bg-foreground/[0.04] p-1">
          <div className="flex min-h-11 items-center justify-between gap-3 pr-1 pl-2.5">
            <span className="text-[14px] font-medium">{t("language")}</span>
            <LanguageSwitcher />
          </div>
          <ThemeToggle />
        </div>
        <nav aria-label={t("menu.label")} className="flex flex-col">
          <MenuLink href="/" icon={<MapIcon />}>
            {t("home")}
          </MenuLink>
          <MenuLink href="/about" testId={testIds.app.aboutLink} icon={<Info />}>
            {t("about")}
          </MenuLink>
        </nav>
        {mock && (
          <p
            data-testid={testIds.app.mockBadge}
            className="flex items-center gap-2 rounded-[14px] bg-hold-surface px-3 py-2 text-[12px] font-medium text-hold"
          >
            <FlaskConical className="size-4 shrink-0" aria-hidden />
            {t("mockBadge")}
          </p>
        )}
      </div>
    </div>
  );
}

function MenuLink({
  href,
  testId,
  icon,
  children,
}: {
  href: string;
  testId?: string;
  icon: ReactNode;
  children: ReactNode;
}) {
  return (
    <Link
      href={href}
      data-testid={testId}
      className="flex min-h-12 items-center gap-3 rounded-[16px] px-1.5 text-[15px] font-medium transition-[transform,background-color] duration-150 hover:bg-foreground/5 active:scale-[0.98]"
    >
      <span
        aria-hidden
        className="flex size-9 shrink-0 items-center justify-center rounded-full bg-foreground/[0.06] text-muted [&>svg]:size-[18px] [&>svg]:stroke-[1.75]"
      >
        {icon}
      </span>
      <span className="flex-1">{children}</span>
      <ChevronRight className="size-4 text-muted" aria-hidden />
    </Link>
  );
}
