import { cva, type VariantProps } from "class-variance-authority";
import type { ComponentProps } from "react";
import { cn } from "@/lib/utils";

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 rounded-xl font-semibold whitespace-nowrap transition-[background-color,opacity] disabled:pointer-events-none disabled:opacity-40 [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        default: "bg-primary text-primary-foreground hover:opacity-90",
        outline: "border border-border bg-transparent text-foreground hover:bg-foreground/5",
        secondary: "bg-foreground/[0.06] text-foreground hover:bg-foreground/10",
        ghost: "bg-transparent text-foreground hover:bg-foreground/5",
      },
      size: {
        default: "h-12 px-5 text-[15px] [&_svg]:size-[18px]",
        lg: "h-13 px-6 text-[16px] [&_svg]:size-5",
        sm: "h-11 px-3 text-[13px] [&_svg]:size-4",
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
