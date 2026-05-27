"use client";

import { Checkbox as RadixCheckbox } from "radix-ui";
import { CheckIcon, MinusIcon } from "lucide-react";
import * as React from "react";

import { cn } from "@/lib/utils";

/**
 * Themed checkbox built on Radix `Checkbox`. Supports `checked={true|false|"indeterminate"}`
 * for tri-state lists (e.g. "all collections selected" master toggle).
 */
function Checkbox({
  className,
  ...props
}: React.ComponentProps<typeof RadixCheckbox.Root>) {
  return (
    <RadixCheckbox.Root
      data-slot="checkbox"
      className={cn(
        "peer grid size-4 shrink-0 cursor-pointer place-items-center rounded-sm border shadow-xs transition-all",
        "border-border bg-background",
        "hover:border-primary/60",
        "data-[state=checked]:border-primary data-[state=checked]:bg-primary data-[state=checked]:text-primary-foreground",
        "data-[state=indeterminate]:border-primary data-[state=indeterminate]:bg-primary data-[state=indeterminate]:text-primary-foreground",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 focus-visible:ring-offset-1 focus-visible:ring-offset-background",
        "disabled:cursor-not-allowed disabled:opacity-50",
        className,
      )}
      {...props}
    >
      <RadixCheckbox.Indicator className="grid place-items-center">
        {props.checked === "indeterminate" ? (
          <MinusIcon className="size-3" strokeWidth={3} aria-hidden="true" />
        ) : (
          <CheckIcon className="size-3" strokeWidth={3} aria-hidden="true" />
        )}
      </RadixCheckbox.Indicator>
    </RadixCheckbox.Root>
  );
}

export { Checkbox };
