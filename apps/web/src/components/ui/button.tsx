import { cva, type VariantProps } from "class-variance-authority";
import type { ComponentProps } from "react";
import { cn } from "@/lib/utils";

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 rounded-xl font-bold whitespace-nowrap transition-colors disabled:pointer-events-none disabled:opacity-45 [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        default: "bg-primary text-primary-foreground hover:opacity-90",
        outline: "border-2 border-border bg-transparent text-foreground hover:bg-surface-raised",
        secondary: "bg-surface-raised text-foreground hover:bg-border",
        ghost: "bg-transparent text-foreground hover:bg-surface-raised",
      },
      size: {
        default: "h-12 px-5 text-base [&_svg]:size-5",
        lg: "h-14 px-6 text-lg [&_svg]:size-6",
        sm: "h-10 px-3 text-sm [&_svg]:size-4",
        icon: "size-11 [&_svg]:size-5",
      },
    },
    defaultVariants: { variant: "default", size: "default" },
  },
);

export type ButtonProps = ComponentProps<"button"> & VariantProps<typeof buttonVariants>;

export function Button({ className, variant, size, type = "button", ...props }: ButtonProps) {
  return (
    <button type={type} className={cn(buttonVariants({ variant, size }), className)} {...props} />
  );
}

export { buttonVariants };
