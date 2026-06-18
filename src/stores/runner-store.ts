import { create } from "zustand";
import type { TestResult } from "@/lib/types";

export interface RunStep {
  path: string;
  name: string;
  method: string;
  status: "pending" | "running" | "passed" | "failed";
  /** HTTP status code (0 = network/parse error) */
  httpStatus: number;
  elapsedMs: number;
  error?: string;
  /** Assertion results from the step's post-response script (empty if none ran). */
  tests?: TestResult[];
  /** Hard script error (syntax / uncaught) — the HTTP request still ran. */
  scriptError?: string | null;
}

interface RunnerState {
  /** When set, the runner dialog is shown. */
  open: boolean;
  /** Path of the folder being run; `null` while idle. */
  folder: string | null;
  steps: RunStep[];
  running: boolean;
  /** Set by the runner to ask the current loop to bail out early. */
  cancelRequested: boolean;
  /** Start a run for the given folder. */
  startRun: (folder: string, steps: RunStep[]) => void;
  setStepStatus: (idx: number, patch: Partial<RunStep>) => void;
  cancelRun: () => void;
  finish: () => void;
  /** Open the runner dialog without starting (used for empty-state UX). */
  openFor: (folder: string) => void;
  close: () => void;
}

export const useRunner = create<RunnerState>((set) => ({
  open: false,
  folder: null,
  steps: [],
  running: false,
  cancelRequested: false,

  startRun: (folder, steps) =>
    set({ open: true, folder, steps, running: true, cancelRequested: false }),

  setStepStatus: (idx, patch) =>
    set((s) => ({
      steps: s.steps.map((step, i) => (i === idx ? { ...step, ...patch } : step)),
    })),

  cancelRun: () => set({ cancelRequested: true }),

  finish: () => set({ running: false, cancelRequested: false }),

  openFor: (folder) =>
    set({ open: true, folder, steps: [], running: false, cancelRequested: false }),

  close: () => set({ open: false, steps: [], folder: null, running: false }),
}));
