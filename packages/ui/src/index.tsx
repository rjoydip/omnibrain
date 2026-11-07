import * as DialogPrimitive from "@radix-ui/react-dialog";
import * as DropdownMenuPrimitive from "@radix-ui/react-dropdown-menu";
import * as SelectPrimitive from "@radix-ui/react-select";
import { Slot } from "@radix-ui/react-slot";
import * as TooltipPrimitive from "@radix-ui/react-tooltip";
import { cva, type VariantProps } from "class-variance-authority";
import { clsx, type ClassValue } from "clsx";
import { type ComponentProps, type ReactNode } from "react";
import { twMerge } from "tailwind-merge";

/** shadcn-style class merge. */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-1.5 whitespace-nowrap rounded-[var(--radius)] font-medium transition-[background,color,filter,box-shadow] outline-none focus-visible:ring-2 focus-visible:ring-accent/50 disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        primary: "bg-signal text-signal-ink hover:brightness-105",
        secondary: "bg-raised text-text hover:brightness-110",
        outline: "bg-transparent text-text hover:bg-raised",
        ghost: "text-muted hover:bg-raised hover:text-text",
        danger: "border border-coral/40 bg-coral/10 text-coral hover:bg-coral/20",
        link: "text-accent underline-offset-4 hover:underline",
      },
      size: {
        sm: "h-7 px-2.5 text-[11.5px]",
        md: "h-8 px-3.5 text-[13px]",
        icon: "size-7",
        "icon-sm": "size-6",
      },
    },
    defaultVariants: { variant: "outline", size: "md" },
  },
);

export function Button({
  className,
  variant,
  size,
  asChild = false,
  ...props
}: ComponentProps<"button"> &
  VariantProps<typeof buttonVariants> & {
    asChild?: boolean;
  }) {
  const Comp = asChild ? Slot : "button";
  return (
    <Comp
      data-slot="button"
      className={cn(buttonVariants({ variant, size }), className)}
      {...props}
    />
  );
}

const badgeVariants = cva(
  "inline-flex items-center gap-1 rounded-full px-2 py-0.5 font-mono text-[10px] uppercase tracking-wider",
  {
    variants: {
      tone: {
        muted: "text-muted",
        accent: "bg-raised text-accent",
        amber: "bg-signal/10 text-signal",
        signal: "bg-signal/10 text-signal",
        cobalt: "bg-cobalt/10 text-cobalt",
        mint: "bg-mint/10 text-mint",
        coral: "bg-coral/10 text-coral",
      },
    },
    defaultVariants: { tone: "muted" },
  },
);

export function Badge({
  tone,
  className,
  children,
}: VariantProps<typeof badgeVariants> & { className?: string; children: ReactNode }) {
  return (
    <span data-slot="badge" className={cn(badgeVariants({ tone }), className)}>
      {children}
    </span>
  );
}

export function Card({ className, ...props }: ComponentProps<"div">) {
  return (
    <div
      data-slot="card"
      className={cn("rounded-[var(--radius)] bg-panel", className)}
      {...props}
    />
  );
}

export function CardHeader({ className, ...props }: ComponentProps<"div">) {
  return (
    <div data-slot="card-header" className={cn("flex flex-col gap-1 p-4", className)} {...props} />
  );
}

export function CardContent({ className, ...props }: ComponentProps<"div">) {
  return <div data-slot="card-content" className={cn("p-4 pt-0", className)} {...props} />;
}

export function CardFooter({ className, ...props }: ComponentProps<"div">) {
  return (
    <div
      data-slot="card-footer"
      className={cn("flex items-center p-4 pt-0", className)}
      {...props}
    />
  );
}

export function Input({ className, ...props }: ComponentProps<"input">) {
  return (
    <input
      data-slot="input"
      className={cn(
        "h-8 w-full rounded-[var(--radius)] bg-raised px-2.5 text-[12.5px] text-text outline-none transition-[box-shadow]",
        "placeholder:text-faint focus-visible:ring-2 focus-visible:ring-accent/50",
        "disabled:cursor-not-allowed disabled:opacity-50",
        className,
      )}
      {...props}
    />
  );
}

export const Select = SelectPrimitive.Root;
export const SelectValue = SelectPrimitive.Value;

export function SelectTrigger({
  className,
  children,
  ...props
}: ComponentProps<typeof SelectPrimitive.Trigger>) {
  return (
    <SelectPrimitive.Trigger
      data-slot="select-trigger"
      className={cn(
        "flex h-8 w-full items-center justify-between gap-2 rounded-[var(--radius)] bg-raised px-2.5 text-[12.5px] text-text outline-none transition-[box-shadow]",
        "focus-visible:ring-2 focus-visible:ring-accent/50 disabled:cursor-not-allowed disabled:opacity-50",
        className,
      )}
      {...props}
    >
      {children}
      <SelectPrimitive.Icon asChild>
        <span aria-hidden="true" className="text-[9px] text-faint">
          ▾
        </span>
      </SelectPrimitive.Icon>
    </SelectPrimitive.Trigger>
  );
}

export function SelectContent({
  className,
  children,
  ...props
}: ComponentProps<typeof SelectPrimitive.Content>) {
  return (
    <SelectPrimitive.Portal>
      <SelectPrimitive.Content
        data-slot="select-content"
        position="popper"
        sideOffset={4}
        className={cn(
          "dialog-content z-50 max-h-72 min-w-[var(--radix-select-trigger-width)] overflow-hidden rounded-[var(--radius)] bg-raised p-1",
          className,
        )}
        {...props}
      >
        <SelectPrimitive.Viewport>{children}</SelectPrimitive.Viewport>
      </SelectPrimitive.Content>
    </SelectPrimitive.Portal>
  );
}

export function SelectItem({
  className,
  children,
  ...props
}: ComponentProps<typeof SelectPrimitive.Item>) {
  return (
    <SelectPrimitive.Item
      data-slot="select-item"
      className={cn(
        "relative flex cursor-default select-none items-center rounded-[6px] py-1.5 pr-7 pl-2 text-[12px] text-muted outline-none",
        "focus:bg-panel focus:text-text data-[disabled]:pointer-events-none data-[disabled]:opacity-50",
        className,
      )}
      {...props}
    >
      <SelectPrimitive.ItemText>{children}</SelectPrimitive.ItemText>
      <SelectPrimitive.ItemIndicator className="absolute right-2">
        <span aria-hidden="true" className="text-accent">
          ✓
        </span>
      </SelectPrimitive.ItemIndicator>
    </SelectPrimitive.Item>
  );
}

export function Separator({ className }: { className?: string }) {
  return <div aria-hidden="true" className={cn("h-px w-full bg-raised", className)} />;
}

export function Spinner({ className }: { className?: string }) {
  return (
    <span
      role="status"
      aria-label="Loading"
      className={cn(
        "inline-block size-4 animate-spin rounded-full border-2 border-line-strong border-t-signal",
        className,
      )}
    />
  );
}

export function EmptyState({
  title,
  body,
  action,
}: {
  title: string;
  body: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center gap-2 rounded-[var(--radius)] px-6 py-12 text-center">
      <p className="text-sm font-medium text-text">{title}</p>
      <p className="max-w-sm text-xs leading-relaxed text-muted">{body}</p>
      {action ? <div className="mt-2">{action}</div> : null}
    </div>
  );
}

export function Modal({
  open,
  onClose,
  title,
  description,
  children,
  footer,
  width = "max-w-lg",
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: string;
  children: ReactNode;
  footer?: ReactNode;
  width?: string;
}) {
  return (
    <DialogPrimitive.Root open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="dialog-overlay fixed inset-0 z-50 bg-black/70" />
        <DialogPrimitive.Content
          className={cn(
            "dialog-content fixed top-[10vh] left-1/2 z-50 flex max-h-[80vh] w-[calc(100%-2rem)] -translate-x-1/2 flex-col overflow-hidden rounded-xl bg-panel outline-none",
            width,
          )}
        >
          <header className="flex items-start justify-between gap-3 px-4 py-3">
            <div className="min-w-0">
              <DialogPrimitive.Title className="text-sm font-semibold text-text">
                {title}
              </DialogPrimitive.Title>
              <DialogPrimitive.Description
                className={description ? "mt-0.5 text-[11px] text-faint" : "sr-only"}
              >
                {description ?? title}
              </DialogPrimitive.Description>
            </div>
            <DialogPrimitive.Close asChild>
              <Button variant="ghost" size="icon-sm" aria-label="Close dialog">
                ✕
              </Button>
            </DialogPrimitive.Close>
          </header>
          <div className="min-h-0 flex-1 overflow-y-auto px-4 py-1">{children}</div>
          {footer ? <footer className="px-4 py-3">{footer}</footer> : null}
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}

export const Menu = DropdownMenuPrimitive.Root;
export const MenuTrigger = DropdownMenuPrimitive.Trigger;

export function MenuContent({
  children,
  align = "end",
  className,
}: {
  children: ReactNode;
  align?: "start" | "center" | "end";
  className?: string;
}) {
  return (
    <DropdownMenuPrimitive.Portal>
      <DropdownMenuPrimitive.Content
        align={align}
        sideOffset={6}
        className={cn(
          "dialog-content z-50 min-w-44 overflow-hidden rounded-[var(--radius)] bg-raised p-1",
          className,
        )}
      >
        {children}
      </DropdownMenuPrimitive.Content>
    </DropdownMenuPrimitive.Portal>
  );
}

export function MenuItem({
  children,
  onSelect,
  className,
  disabled,
}: {
  children: ReactNode;
  onSelect?: () => void;
  className?: string;
  disabled?: boolean;
}) {
  return (
    <DropdownMenuPrimitive.Item
      disabled={disabled}
      onSelect={onSelect}
      className={cn(
        "flex cursor-default items-center gap-2 rounded-[6px] px-2 py-1.5 text-[12px] text-muted outline-none select-none",
        "focus:bg-panel focus:text-text data-[disabled]:pointer-events-none data-[disabled]:opacity-50",
        className,
      )}
    >
      {children}
    </DropdownMenuPrimitive.Item>
  );
}

/** shadcn-style tooltip; replaces native `title` hints. */
export function Tooltip({
  label,
  children,
  side = "top",
  align = "center",
}: {
  label: ReactNode;
  children: ReactNode;
  side?: "top" | "right" | "bottom" | "left";
  align?: "start" | "center" | "end";
}) {
  if (!label) return <>{children}</>;
  return (
    <TooltipPrimitive.Provider delayDuration={250}>
      <TooltipPrimitive.Root>
        <TooltipPrimitive.Trigger asChild>{children}</TooltipPrimitive.Trigger>
        <TooltipPrimitive.Portal>
          <TooltipPrimitive.Content
            side={side}
            align={align}
            sideOffset={6}
            className="dialog-content z-50 max-w-64 rounded-[6px] bg-raised px-2 py-1 font-mono text-[10px] leading-relaxed text-text"
          >
            {label}
          </TooltipPrimitive.Content>
        </TooltipPrimitive.Portal>
      </TooltipPrimitive.Root>
    </TooltipPrimitive.Provider>
  );
}
