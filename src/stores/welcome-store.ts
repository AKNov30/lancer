import { create } from "zustand";

const STORAGE_KEY = "lancer.welcomeDismissed";

interface WelcomeState {
  open: boolean;
  setOpen: (b: boolean) => void;
  dismiss: () => void;
}

export const useWelcome = create<WelcomeState>((set) => ({
  open: typeof window !== "undefined" && window.localStorage.getItem(STORAGE_KEY) !== "true",
  setOpen: (open) => set({ open }),
  dismiss: () => {
    if (typeof window !== "undefined") {
      window.localStorage.setItem(STORAGE_KEY, "true");
    }
    set({ open: false });
  },
}));
