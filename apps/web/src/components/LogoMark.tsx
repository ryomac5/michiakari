import { cn } from "@/lib/utils";

// マツカエルのロゴマーク。緑の丸い体に目を 2 つ載せたカエル。src/app/icon.svg と同じ形
export function LogoMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 64 64" className={cn("shrink-0", className)} aria-hidden focusable="false">
      <circle cx="20" cy="18" r="11" fill="#2f9e5b" />
      <circle cx="44" cy="18" r="11" fill="#2f9e5b" />
      <circle cx="32" cy="36" r="25" fill="#2f9e5b" />
      <ellipse cx="32" cy="44" rx="15" ry="11" fill="#8fd6a8" />
      <circle cx="20" cy="18" r="6.5" fill="#ffffff" />
      <circle cx="44" cy="18" r="6.5" fill="#ffffff" />
      <circle cx="21" cy="19" r="3.2" fill="#0d1218" />
      <circle cx="43" cy="19" r="3.2" fill="#0d1218" />
      <path
        d="M22 34 Q32 41 42 34"
        fill="none"
        stroke="#0d1218"
        strokeWidth="3.2"
        strokeLinecap="round"
      />
    </svg>
  );
}
