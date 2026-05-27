import { create } from "zustand";

/**
 * Cross-component UI coordination — palette open state, plus a "pending
 * action" channel so the command palette can ask the Sidebar to open its
 * create/rename/delete dialogs without needing access to those internals.
 *
 * Sidebar subscribes via `useEffect` watching `pendingAction`; once handled,
 * it calls `clearPendingAction` so a repeat of the same action still fires.
 */
export type PendingAction =
  | { type: "new-request"; parentPath: string }
  | { type: "new-folder"; parentPath: string }
  | { type: "new-environment" }
  | { type: "import-curl" }
  | { type: "import-openapi" }
  | { type: "import-postman" }
  /** Unified file picker that sniffs Postman/OpenAPI/env automatically. */
  | { type: "import-from-file" }
  | { type: "open-settings" }
  | { type: "open-history" }
  /** Open the Cookie manager sheet (editable cookie jar). */
  | { type: "open-cookies" }
  | { type: "open-env-editor" }
  | { type: "export-postman" }
  /** Export a specific folder (and its sub-folders) as Postman v2.1. */
  | { type: "export-postman-folder"; folderPath: string }
  /** Open the unified workspace export dialog (ZIP / Postman / pick collections). */
  | { type: "export-workspace" }
  | { type: "run-folder"; folderPath: string }
  | { type: "open-shortcuts" }
  /** Focus the URL bar input (Ctrl/Cmd+L). */
  | { type: "focus-url" }
  /** Open the collection (folder) settings sheet — Variables editor etc. */
  | { type: "open-collection-settings"; folderPath: string }
  /** Open the "New workspace" dialog (name → ~/Documents/Lancer/<name>). */
  | { type: "new-workspace" };

interface UiState {
  paletteOpen: boolean;
  setPaletteOpen: (b: boolean) => void;
  pendingAction: PendingAction | null;
  requestAction: (a: PendingAction) => void;
  clearPendingAction: () => void;
}

export const useUi = create<UiState>((set) => ({
  paletteOpen: false,
  setPaletteOpen: (paletteOpen) => set({ paletteOpen }),
  pendingAction: null,
  requestAction: (a) => set({ pendingAction: a, paletteOpen: false }),
  clearPendingAction: () => set({ pendingAction: null }),
}));
