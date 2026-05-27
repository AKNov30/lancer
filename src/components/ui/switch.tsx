"use client";

import { Switch as RadixSwitch } from "radix-ui";
import * as React from "react";

import { cn } from "@/lib/utils";

/**
 * Themed switch built on Radix `Switch`. Replaces the hand-rolled toggle
 * buttons that were sprinkled across the app — those used `translate-x-[…]`
 * arbitrary classes that didn't always animate correctly in Tailwind v4.
 * Using Radix gives us proper a11y (role=switch, focus ring, keyboard) for
 * free and a single visual definition to maintain.
 *
 * `variant="danger"` swaps the on-state color to destructive — used for
 * options like "Skip TLS verification" where ON is the dangerous mode.
 */
function Switch({
  className,
  variant = "default",
  ...props
}: React.ComponentProps<typeof RadixSwitch.Root> & {
  variant?: "default" | "danger";
}) {
  return (
    <RadixSwitch.Root
      data-slot="switch"
      data-variant={variant}
      className={cn(
        // Track
        "peer relative inline-flex h-6 w-10 shrink-0 cursor-pointer items-center rounded-full",
        "border-2 border-transparent shadow-xs outline-none transition-colors duration-200",
        // States
        "data-[state=unchecked]:bg-muted",
        "data-[variant=default]:data-[state=checked]:bg-primary",
        "data-[variant=danger]:data-[state=checked]:bg-destructive",
        "focus-visible:ring-2 focus-visible:ring-primary/50 focus-visible:ring-offset-1 focus-visible:ring-offset-background",
        "disabled:cursor-not-allowed disabled:opacity-50",
        className,
      )}
      {...props}
    >
      <RadixSwitch.Thumb
        data-slot="switch-thumb"
        className={cn(
          "pointer-events-none block size-5 rounded-full bg-background shadow-sm ring-0",
          "transition-transform duration-200",
          // Translate exactly 16px (track is 40px, thumb is 20px, border 2px×2 = 4px →
          // free space = 40-4-20 = 16px). Radix manages the data-state, we just
          // pick a side per state.
          "data-[state=unchecked]:translate-x-0",
          "data-[state=checked]:translate-x-4",
        )}
      />
    </RadixSwitch.Root>
  );
}

export { Switch };
