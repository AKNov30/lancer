import { GripVerticalIcon } from "lucide-react";
import * as ResizablePrimitive from "react-resizable-panels";

import { cn } from "@/lib/utils";

function ResizablePanelGroup({ className, ...props }: ResizablePrimitive.GroupProps) {
  return (
    <ResizablePrimitive.Group
      data-slot="resizable-panel-group"
      className={cn(
        "flex h-full w-full data-[panel-group-direction=vertical]:flex-col",
        className,
      )}
      {...props}
    />
  );
}

function ResizablePanel({ ...props }: ResizablePrimitive.PanelProps) {
  return <ResizablePrimitive.Panel data-slot="resizable-panel" {...props} />;
}

function ResizableHandle({
  withHandle,
  className,
  ...props
}: ResizablePrimitive.SeparatorProps & { withHandle?: boolean }) {
  return (
    <ResizablePrimitive.Separator
      data-slot="resizable-handle"
      className={cn(
        // Handle takes 6px of physical layout width — wide enough to be its
        // own click target without any pseudo-element trickery. The 1px
        // visible divider line sits inside.
        //
        // react-resizable-panels v4 NO LONGER emits `data-panel-group-direction`
        // (that was a v2 thing). We use `aria-orientation` instead:
        //   aria-orientation="vertical"   → vertical line, divides L↔R (default)
        //   aria-orientation="horizontal" → horizontal line, divides T↕B
        "group/resize relative z-30 flex w-1.5 shrink-0 cursor-col-resize items-center justify-center bg-transparent",
        // The actual visible divider — 1px hairline, centered
        "before:absolute before:inset-y-0 before:left-1/2 before:w-px before:-translate-x-1/2 before:bg-border before:transition-colors before:content-['']",
        // Hover/drag states — the line lights up primary
        "hover:before:bg-primary/60",
        "data-[resize-handle-state=hover]:before:bg-primary/80",
        "data-[resize-handle-state=drag]:before:bg-primary",
        // Keyboard focus
        "focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-primary/40 focus-visible:before:bg-primary",
        // Horizontal separator (= vertical panel group): swap dimensions, cursor, and divider line orientation.
        "aria-[orientation=horizontal]:h-1.5 aria-[orientation=horizontal]:w-full aria-[orientation=horizontal]:cursor-row-resize",
        "aria-[orientation=horizontal]:before:left-0 aria-[orientation=horizontal]:before:h-px aria-[orientation=horizontal]:before:w-full aria-[orientation=horizontal]:before:translate-x-0 aria-[orientation=horizontal]:before:-translate-y-1/2 aria-[orientation=horizontal]:before:top-1/2",
        // Rotate the inner grip pill 90° so the dots run along the line direction.
        "[&[aria-orientation=horizontal]>div]:rotate-90",
        className,
      )}
      {...props}
    >
      {withHandle && (
        <div
          aria-hidden="true"
          className={cn(
            "relative z-10 flex h-6 w-3 items-center justify-center rounded-[3px]",
            "border border-border/60 bg-card/80 backdrop-blur supports-[backdrop-filter]:bg-card/60",
            "shadow-sm transition-all duration-200",
            "group-hover/resize:border-primary/50 group-hover/resize:scale-110 group-hover/resize:shadow-md",
            "group-data-[resize-handle-state=drag]/resize:scale-110 group-data-[resize-handle-state=drag]/resize:border-primary",
          )}
        >
          <GripVerticalIcon
            className="size-2.5 text-muted-foreground transition-colors group-hover/resize:text-foreground"
            aria-hidden="true"
          />
        </div>
      )}
    </ResizablePrimitive.Separator>
  );
}

export { ResizableHandle, ResizablePanel, ResizablePanelGroup };
