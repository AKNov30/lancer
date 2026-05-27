import { create } from "zustand";

/**
 * Runtime overlay of captured variables, layered on top of env-file vars
 * during request substitution. Captures are scoped per environment name —
 * a token captured under env `dev` doesn't leak into env `prod`. The key
 * `__none__` holds captures for sessions with no active env.
 *
 * Values live in-memory only — they survive tab switches but reset on app
 * restart, which matches Postman's session-scoped capture semantics.
 */
type CaptureBag = Record<string, string>;
const NO_ENV = "__none__";

interface CapturesState {
  overlay: Record<string, CaptureBag>;
  set: (envName: string | null, varName: string, value: string) => void;
  setMany: (envName: string | null, vars: Array<[string, string]>) => void;
  /** Remove every captured value (current session reset). */
  clearAll: () => void;
  /** Remove captures for one env only. */
  clearEnv: (envName: string | null) => void;
  /** Flat list of overlay vars for the supplied env, ready to ship to Rust. */
  getForEnv: (envName: string | null) => Array<[string, string]>;
}

export const useCaptures = create<CapturesState>((set, get) => ({
  overlay: {},

  set: (envName, varName, value) =>
    set((s) => {
      const k = envName ?? NO_ENV;
      const bag = { ...(s.overlay[k] ?? {}), [varName]: value };
      return { overlay: { ...s.overlay, [k]: bag } };
    }),

  setMany: (envName, vars) =>
    set((s) => {
      const k = envName ?? NO_ENV;
      const bag = { ...(s.overlay[k] ?? {}) };
      for (const [name, value] of vars) bag[name] = value;
      return { overlay: { ...s.overlay, [k]: bag } };
    }),

  clearAll: () => set({ overlay: {} }),

  clearEnv: (envName) =>
    set((s) => {
      const k = envName ?? NO_ENV;
      const next = { ...s.overlay };
      delete next[k];
      return { overlay: next };
    }),

  getForEnv: (envName) => {
    const bag = get().overlay[envName ?? NO_ENV] ?? {};
    return Object.entries(bag);
  },
}));
