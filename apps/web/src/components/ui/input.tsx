import type { ComponentProps } from "react";
import { cn } from "@/lib/utils";

const fieldClass =
  "w-full rounded-xl border-2 border-border bg-surface px-4 text-lg text-foreground placeholder:text-muted focus-visible:border-focus";

export function Input({ className, ...props }: ComponentProps<"input">) {
  return <input className={cn(fieldClass, "h-14", className)} {...props} />;
}

export function Textarea({ className, ...props }: ComponentProps<"textarea">) {
  return (
    <textarea className={cn(fieldClass, "min-h-36 py-3 leading-relaxed", className)} {...props} />
  );
}
