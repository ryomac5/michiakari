import type { ComponentProps } from "react";
import { cn } from "@/lib/utils";

const fieldClass =
  "w-full rounded-xl border border-transparent bg-foreground/[0.05] px-3 text-[16px] text-foreground placeholder:text-muted focus-visible:border-focus focus-visible:bg-surface";

export function Input({ className, ...props }: ComponentProps<"input">) {
  return <input className={cn(fieldClass, "h-12", className)} {...props} />;
}

export function Textarea({ className, ...props }: ComponentProps<"textarea">) {
  return (
    <textarea className={cn(fieldClass, "min-h-32 py-3 leading-relaxed", className)} {...props} />
  );
}
