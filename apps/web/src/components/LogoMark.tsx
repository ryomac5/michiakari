import { cn } from "@/lib/utils";

// みちあかりのロゴマーク。暗い角丸の地に分かれ道を描き、進む側の先を黄色の信号灯が照らす。src/app/icon.svg と同じ形
export function LogoMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 64 64" className={cn("shrink-0", className)} aria-hidden focusable="false">
      <rect
        x="2"
        y="2"
        width="60"
        height="60"
        rx="16"
        fill="#1c2431"
        stroke="#4a5568"
        strokeWidth="2"
      />
      <path
        d="M31 58 V38 L15 22"
        fill="none"
        stroke="#f8f1dc"
        strokeOpacity="0.4"
        strokeWidth="7"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M31 58 V38 L42 26"
        fill="none"
        stroke="#f8f1dc"
        strokeWidth="7"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle cx="44" cy="21" r="17" fill="#f6b73c" fillOpacity="0.3" />
      <circle cx="44" cy="21" r="12" fill="#f6b73c" />
      <circle cx="41.5" cy="18.5" r="4.5" fill="#fff3c4" />
    </svg>
  );
}
