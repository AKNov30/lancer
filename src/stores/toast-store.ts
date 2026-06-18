import { create } from "zustand";

/**
 * Minimal in-house toast system.
 *
 * Why in-house instead of a library: `sonner` appears in stale lockfile
 * metadata but is NOT installed (no `node_modules/sonner`) and is never
 * imported. Pulling it in would add a runtime dep + bundle weight for a
 * handful of background-error notices. A ~40-line Zustand store + a small
 * portal `<Toaster>` covers our needs (success / error / info, auto-dismiss,
 * manual close) while staying inside the project's existing patterns.
 */
export type ToastVariant = "success" | "error" | "info";

export interface Toast {
  id: number;
  variant: ToastVariant;
  message: string;
  /** Optional secondary line — e.g. the underlying error cause. */
  description?: string;
  /** Auto-dismiss delay in ms. `null` keeps it until manually dismissed. */
  duration: number | null;
}

export interface ToastOptions {
  description?: string;
  /** Override the auto-dismiss delay (ms). `null` to make it sticky. */
  duration?: number | null;
}

interface ToastState {
  toasts: Toast[];
  /** Add a toast and return its id (so callers can dismiss it early). */
  add: (variant: ToastVariant, message: string, opts?: ToastOptions) => number;
  dismiss: (id: number) => void;
  clear: () => void;
}

/** Default auto-dismiss windows — errors linger longer so they're readable. */
const DEFAULT_DURATION: Record<ToastVariant, number> = {
  success: 3000,
  info: 4000,
  error: 6000,
};

let nextId = 1;

export const useToasts = create<ToastState>((set) => ({
  toasts: [],
  add: (variant, message, opts) => {
    const id = nextId++;
    const duration = opts?.duration !== undefined ? opts.duration : DEFAULT_DURATION[variant];
    set((s) => ({
      toasts: [...s.toasts, { id, variant, message, description: opts?.description, duration }],
    }));
    return id;
  },
  dismiss: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),
  clear: () => set({ toasts: [] }),
}));

/**
 * Tiny typed API for firing toasts from anywhere (event handlers, async
 * callbacks) without needing the React hook. Mirrors sonner's surface so a
 * future swap to a library is a one-file change.
 */
export const toast = {
  success: (message: string, opts?: ToastOptions) =>
    useToasts.getState().add("success", message, opts),
  error: (message: string, opts?: ToastOptions) => useToasts.getState().add("error", message, opts),
  info: (message: string, opts?: ToastOptions) => useToasts.getState().add("info", message, opts),
  dismiss: (id: number) => useToasts.getState().dismiss(id),
};
