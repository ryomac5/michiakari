"use client";

import { ArrowLeft } from "lucide-react";

// 上部の帯の左端に置く「戻る」。リプレイと判断の画面で同じ見た目にする。押せる大きさは 44px
export function HeaderBackButton({
  label,
  testId,
  onClick,
}: {
  label: string;
  testId: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      data-testid={testId}
      aria-label={label}
      title={label}
      onClick={onClick}
      className="inline-flex size-11 shrink-0 items-center justify-center rounded-xl transition-colors hover:bg-foreground/5"
    >
      <ArrowLeft className="size-5" strokeWidth={1.75} aria-hidden />
    </button>
  );
}
