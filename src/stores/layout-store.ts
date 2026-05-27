import { create } from "zustand";

/**
 * Whether the Response panel sits to the right of the editor (split
 * horizontally) or below it (split vertically). Saved in localStorage so
 * the layout persists across sessions per-user.
 */
export type ResponseOrientation = "right" | "bottom";

interface LayoutState {
  responseOrientation: ResponseOrientation;
  setResponseOrientation: (o: ResponseOrientation) => void;
}

const STORAGE_KEY = "lancer.layout.responseOrientation";

function loadStored(): ResponseOrientation {
  if (typeof window === "undefined") return "right";
  const v = window.localStorage.getItem(STORAGE_KEY);
  return v === "bottom" ? "bottom" : "right";
}

export const useLayout = create<LayoutState>((set) => ({
  responseOrientation: loadStored(),
  setResponseOrientation: (o) => {
    if (typeof window !== "undefined") {
      window.localStorage.setItem(STORAGE_KEY, o);
    }
    set({ responseOrientation: o });
  },
}));
