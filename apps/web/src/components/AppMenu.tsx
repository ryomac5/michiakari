"use client";

import { BookOpen, ChevronRight, FlaskConical, House, Info, Menu, X } from "lucide-react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { type ReactNode, useEffect, useId, useRef, useState } from "react";
import { testIds } from "@/features/judgment/testids";
import { cn } from "@/lib/utils";
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
        className="glass-strong absolute top-[calc(100%+12px)] right-0 z-40 w-72 animate-drop-in rounded-2xl p-2"
      >
        {mock && (
          <p
            data-testid={testIds.app.mockBadge}
            className="mb-1 flex items-center gap-2 rounded-xl bg-hold-surface px-2 py-2 text-[13px] font-medium text-hold"
          >
            <FlaskConical className="size-4 shrink-0" aria-hidden />
            {t("mockBadge")}
          </p>
        )}
        <div className="flex items-center justify-between gap-3 px-2 py-1.5">
          <span className="text-[13px] font-medium text-muted">{t("language")}</span>
          <LanguageSwitcher />
        </div>
        <ThemeToggle />
        <div className="my-1.5 h-px bg-border" />
        <MenuLink href="/knowledge" testId={testIds.app.knowledgeLink} icon={<BookOpen />}>
          {t("knowledge")}
        </MenuLink>
        <MenuLink href="/about" testId={testIds.app.aboutLink} icon={<Info />}>
          {t("about")}
        </MenuLink>
        <MenuLink href="/" icon={<House />}>
          {t("home")}
        </MenuLink>
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
      className={cn(
        "flex min-h-11 items-center gap-3 rounded-xl px-2 text-[15px] font-medium transition-colors hover:bg-foreground/5",
        "[&>svg:first-child]:size-5 [&>svg:first-child]:stroke-[1.75] [&>svg:first-child]:text-muted",
      )}
    >
      {icon}
      <span className="flex-1">{children}</span>
      <ChevronRight className="size-4 text-muted" aria-hidden />
    </Link>
  );
}
