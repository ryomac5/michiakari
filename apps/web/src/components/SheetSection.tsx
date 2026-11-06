"use client";

import type { ReactNode } from "react";
import { useState } from "react";
import type { MapInsets } from "@/features/map/MapPanel";
import { desktopMediaQuery, useMediaQuery } from "@/lib/use-media-query";
import { computeHeaderShift, useSafeArea } from "@/lib/use-safe-area";
import { cn } from "@/lib/utils";
import { type SheetSnap, sheetTopInset } from "./MapSheet";

// シートの中の区切り。上に細い線を引き、見出しは小さく控えめにする
export function SheetSection({
  title,
  children,
  className,
  testId,
}: {
  title?: string;
  children: ReactNode;
  className?: string;
  testId?: string;
}) {
  return (
    <div
      data-testid={testId}
      className={cn(
        "flex flex-col gap-3 border-t border-border py-4 first:border-t-0 first:pt-1",
        className,
      )}
    >
      {title && <h2 className="text-[13px] font-medium text-muted">{title}</h2>}
      {children}
    </div>
  );
}

// PC 幅の右パネルの幅と余白
const panelInset = 400 + 32;

// 地図の画面の配置。シートの段と、地図に重なる部品の幅をまとめて持つ
// topInset は上に重なる帯の下端。リプレイは再生バーのぶん下がる
export function useMapChrome(topInset: number = sheetTopInset) {
  const [snap, setSnap] = useState<SheetSnap>("collapsed");
  const [collapsedHeight, setCollapsedHeight] = useState(200);
  const desktop = useMediaQuery(desktopMediaQuery);
  // 端末の上の余白で帯が下がるぶん、地図の上の余白も広げる
  const top = topInset + computeHeaderShift(useSafeArea());
  const insets: MapInsets = desktop
    ? { top, right: panelInset, bottom: 0, left: 0 }
    : { top, right: 0, bottom: collapsedHeight, left: 0 };
  return { snap, setSnap, setCollapsedHeight, insets, desktop, topInset };
}
