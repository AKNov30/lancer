import { create } from "zustand";

export type Theme = "light" | "dark" | "system";

interface ThemeState {
  /** User's selected mode — may be "system". */
  theme: Theme;
  /** Concrete mode currently applied to <html>. Either "light" or "dark". */
  resolvedTheme: "light" | "dark";
  setTheme: (t: Theme) => void;
  init: () => void;
}

const STORAGE_KEY = "lancer.theme";

function resolveSystem(): "light" | "dark" {
  if (typeof window === "undefined") return "dark";
  return window.matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark";
}

function applyToDocument(resolved: "light" | "dark") {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  root.classList.toggle("dark", resolved === "dark");
  root.classList.toggle("light", resolved === "light");
  root.style.colorScheme = resolved;
}

function loadStored(): Theme {
  if (typeof window === "undefined") return "system";
  const stored = window.localStorage.getItem(STORAGE_KEY);
  if (stored === "light" || stored === "dark" || stored === "system") return stored;
  return "system";
}

export const useTheme = create<ThemeState>((set, get) => ({
  theme: loadStored(),
  resolvedTheme: resolveSystem(),

  setTheme: (theme) => {
    if (typeof window !== "undefined") {
      window.localStorage.setItem(STORAGE_KEY, theme);
    }
    const resolved = theme === "system" ? resolveSystem() : theme;
    applyToDocument(resolved);
    set({ theme, resolvedTheme: resolved });
  },

  init: () => {
    const theme = loadStored();
    const resolved = theme === "system" ? resolveSystem() : theme;
    applyToDocument(resolved);
    set({ theme, resolvedTheme: resolved });

    // React to system theme changes if user picked "system"
    if (typeof window !== "undefined") {
      const mq = window.matchMedia("(prefers-color-scheme: light)");
      const onChange = () => {
        if (get().theme === "system") {
          const next = resolveSystem();
          applyToDocument(next);
          set({ resolvedTheme: next });
        }
      };
      mq.addEventListener("change", onChange);
    }
  },
}));
