import { getCurrentWindow } from "@tauri-apps/api/window";
import { create } from "zustand";

/**
 * Theme variants Lancer ships:
 *  - "light"      — bright UI
 *  - "dark"       — high-contrast near-black (current default; OLED-friendly)
 *  - "dark-soft"  — softer dark, closer to VS Code / Dracula contrast
 *  - "system"     — follow OS preference (resolves to "light" or "dark")
 */
export type Theme = "light" | "dark" | "dark-soft" | "system";

/** The concrete theme actually applied to `<html>` — never "system". */
export type ResolvedTheme = "light" | "dark" | "dark-soft";

interface ThemeState {
  theme: Theme;
  resolvedTheme: ResolvedTheme;
  setTheme: (t: Theme) => void;
  init: () => void;
}

const STORAGE_KEY = "lancer.theme";

function resolveSystem(): ResolvedTheme {
  if (typeof window === "undefined") return "dark";
  return window.matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark";
}

/**
 * Sync the OS-level window chrome (Windows: DWM title-bar) with the resolved
 * theme. On Windows this controls whether the title bar paints dark or light;
 * without this call the OS keeps showing the system default and the colors
 * clash with the app.
 */
async function syncTauriWindowTheme(resolved: ResolvedTheme): Promise<void> {
  try {
    const win = getCurrentWindow();
    // Tauri's setTheme accepts "light" | "dark" | null (follow system).
    // Both our dark variants map to "dark" at the OS level — the soft
    // version is just a CSS palette swap inside the webview.
    const osTheme = resolved === "light" ? "light" : "dark";
    await win.setTheme(osTheme);
  } catch {
    /* Tauri API unavailable (running in plain browser?) — no-op */
  }
}

function applyToDocument(resolved: ResolvedTheme) {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  root.classList.toggle("dark", resolved === "dark");
  root.classList.toggle("dark-soft", resolved === "dark-soft");
  root.classList.toggle("light", resolved === "light");
  // Browsers / WebView2 use `color-scheme` to colour native scrollbars and
  // form controls; map both dark variants to "dark".
  root.style.colorScheme = resolved === "light" ? "light" : "dark";
  void syncTauriWindowTheme(resolved);
}

function loadStored(): Theme {
  if (typeof window === "undefined") return "system";
  const stored = window.localStorage.getItem(STORAGE_KEY);
  if (stored === "light" || stored === "dark" || stored === "dark-soft" || stored === "system") {
    return stored;
  }
  return "system";
}

function resolve(theme: Theme): ResolvedTheme {
  if (theme === "system") return resolveSystem();
  return theme;
}

export const useTheme = create<ThemeState>((set, get) => ({
  theme: loadStored(),
  resolvedTheme: resolve(loadStored()),

  setTheme: (theme) => {
    if (typeof window !== "undefined") {
      window.localStorage.setItem(STORAGE_KEY, theme);
    }
    const resolved = resolve(theme);
    applyToDocument(resolved);
    set({ theme, resolvedTheme: resolved });
  },

  init: () => {
    const theme = loadStored();
    const resolved = resolve(theme);
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
