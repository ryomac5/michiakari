"use client";

import Link from "next/link";
import type { MapLabels } from "./labels";

// 地図の隅に常設する出典。文字は小さいまま、押せる高さは 44px にする
// シートを大きく開くと地図の線やピンがこの帯に掛かるので、淡い下地を敷いて線の上でも読めるようにする
// 帯の高さ。地図を寄せるときは、この分を地図の要素の余白に入れる
export const mapAttributionHeight = 24;

export function MapAttribution({
  labels,
  insets,
  testIds,
}: {
  labels: MapLabels["attribution"];
  insets: { bottom: number; left: number; right: number };
  testIds?: { root: string; line: string };
}) {
  return (
    <div
      data-testid={testIds?.root}
      style={{ bottom: insets.bottom, left: insets.left, right: insets.right }}
      className="pointer-events-none absolute z-10 flex items-end px-2 text-[10px] leading-snug text-muted transition-[bottom] duration-200"
    >
      {/* 下地は文字の 1 行だけに敷く。リンクの押せる範囲は下地の外へ上に伸ばす */}
      <p
        aria-hidden
        data-testid={testIds?.line}
        className="min-w-0 truncate rounded-l-md bg-background/70 py-0.5 pl-1.5 tracking-tight opacity-90 backdrop-blur-[2px]"
      >
        {labels.short}
      </p>
      <ul className="sr-only">
        {labels.full.map((line) => (
          <li key={line}>{line}</li>
        ))}
      </ul>
      <Link
        href="/about"
        className="pointer-events-auto flex h-11 shrink-0 items-end font-medium underline underline-offset-2"
      >
        <span className="rounded-r-md bg-background/70 py-0.5 pr-1.5 pl-2 backdrop-blur-[2px]">
          {labels.link}
        </span>
      </Link>
    </div>
  );
}
