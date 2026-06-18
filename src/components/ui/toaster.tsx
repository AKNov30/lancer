"use client";

import { CheckCircle2Icon, InfoIcon, XCircleIcon, XIcon } from "lucide-react";
import * as React from "react";
import { createPortal } from "react-dom";

import { cn } from "@/lib/utils";
import { type Toast, type ToastVariant, useToasts } from "@/stores/toast-store";

/**
 * In-house toast renderer. Mounted once (in AppShell) and driven by the
 * `toast-store`. Renders a fixed bottom-right stack in a body portal so it
 * floats above resizable panels, dialogs and the editor.
 *
 * Theming: surfaces use the same `--color-popover` / `--color-border` /
 * `shadow-lg` / `--radius` tokens as other Lancer surfaces, so it tracks the
 * light / dark / dark-soft palettes automatically. The accent stripe + icon
 * use the semantic `--color-success` / `--color-destructive` / `--color-info`
 * tokens.
 *
 * a11y: the stack is an `aria-live` region. Errors announce assertively;
 * success / info announce politely. Toasts never steal focus — the close
 * button is reachable by tab but nothing is auto-focused.
 */
const VARIANT_META: Record<
  ToastVariant,
  { Icon: typeof InfoIcon; color: string; live: "assertive" | "polite" }
> = {
  success: { Icon: CheckCircle2Icon, color: "var(--color-success)", live: "polite" },
  error: { Icon: XCircleIcon, color: "var(--color-destructive)", live: "assertive" },
  info: { Icon: InfoIcon, color: "var(--color-info)", live: "polite" },
};

function ToastRow({ toast }: { toast: Toast }) {
  const dismiss = useToasts((s) => s.dismiss);
  const { Icon, color } = VARIANT_META[toast.variant];

  // Auto-dismiss after the toast's duration (unless it's sticky: duration null).
  React.useEffect(() => {
    if (toast.duration == null) return;
    const t = window.setTimeout(() => dismiss(toast.id), toast.duration);
    return () => window.clearTimeout(t);
  }, [toast.id, toast.duration, dismiss]);

  return (
    <div
      data-slot="toast"
      role={toast.variant === "error" ? "alert" : "status"}
      className={cn(
        "pointer-events-auto relative flex w-[min(360px,calc(100vw-2rem))] items-start gap-2.5",
        "overflow-hidden rounded-lg border border-border bg-popover py-2.5 pr-2 pl-3 text-popover-foreground",
        "shadow-lg data-[state=closed]:animate-out data-[state=open]:animate-in",
        "data-[state=open]:fade-in-0 data-[state=open]:slide-in-from-bottom-2",
      )}
      data-state="open"
    >
      {/* Accent stripe — semantic colour cue down the leading edge. */}
      <span
        aria-hidden="true"
        className="absolute inset-y-0 left-0 w-0.5"
        style={{ backgroundColor: color }}
      />
      <Icon
        className="mt-px size-4 shrink-0"
        strokeWidth={1.75}
        aria-hidden="true"
        style={{ color }}
      />
      <div className="min-w-0 flex-1">
        <p className="font-medium text-sm leading-snug">{toast.message}</p>
        {toast.description && (
          <p className="mt-0.5 break-words text-muted-foreground text-xs leading-snug">
            {toast.description}
          </p>
        )}
      </div>
      <button
        type="button"
        onClick={() => dismiss(toast.id)}
        className="grid size-5 shrink-0 cursor-pointer place-items-center rounded-sm text-muted-foreground/60 transition-colors hover:bg-accent hover:text-foreground"
        aria-label="Dismiss notification"
      >
        <XIcon className="size-3.5" aria-hidden="true" />
      </button>
    </div>
  );
}

export function Toaster() {
  const toasts = useToasts((s) => s.toasts);
  if (typeof document === "undefined") return null;

  return createPortal(
    <div
      data-slot="toaster"
      // Polite region: most toasts are non-critical. Error rows carry their
      // own role="alert" above for assertive announcement.
      aria-live="polite"
      aria-relevant="additions text"
      className="pointer-events-none fixed right-4 bottom-4 z-[100] flex flex-col items-end gap-2"
    >
      {toasts.map((t) => (
        <ToastRow key={t.id} toast={t} />
      ))}
    </div>,
    document.body,
  );
}
