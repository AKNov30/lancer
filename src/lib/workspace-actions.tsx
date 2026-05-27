// Single source of truth for the workspace-level "create / import / find /
// workspace-op" actions. The "+ Add" dropdown, the sidebar right-click menu,
// and the command palette all render from THESE descriptors and dispatch
// through `runWorkspaceAction` — so labels, icons, and behavior can never
// drift between entry points again (they used to: "From file…" vs "Import from
// file…", FileJsonIcon vs DownloadIcon, local state vs store dispatch, etc.).

import {
  FileJsonIcon,
  FilePlusIcon,
  FolderOpenIcon,
  KeyIcon,
  LibraryIcon,
  type LucideIcon,
  RefreshCwIcon,
  SearchIcon,
  TerminalIcon,
  UploadIcon,
} from "lucide-react";
import { revealInFileManager } from "@/lib/reveal-in-file-manager";
import type { PendingAction } from "@/stores/ui-store";

const isMac = typeof navigator !== "undefined" && /Mac|iPod|iPhone|iPad/.test(navigator.platform);

export interface WorkspaceActionDef {
  id: WorkspaceActionId;
  label: string;
  Icon: LucideIcon;
  /** Trailing muted hint (e.g. "auto-detect", "Ctrl+K"). */
  hint?: string;
}

export type WorkspaceActionId =
  | "new-request"
  | "new-folder"
  | "new-environment"
  | "import-from-file"
  | "import-curl"
  | "export-workspace"
  | "reveal"
  | "refresh"
  | "search";

/** Canonical descriptor per action — one label, one icon, one hint. */
export const ACT: Record<WorkspaceActionId, WorkspaceActionDef> = {
  "new-request": { id: "new-request", label: "New request", Icon: FilePlusIcon },
  "new-folder": { id: "new-folder", label: "New collection", Icon: LibraryIcon },
  "new-environment": { id: "new-environment", label: "New environment", Icon: KeyIcon },
  "import-from-file": {
    id: "import-from-file",
    label: "Import from file…",
    Icon: FileJsonIcon,
    hint: "auto-detect",
  },
  "import-curl": { id: "import-curl", label: "Import cURL command…", Icon: TerminalIcon },
  "export-workspace": {
    id: "export-workspace",
    label: "Export workspace…",
    Icon: UploadIcon,
    hint: "ZIP / Postman",
  },
  reveal: { id: "reveal", label: "Show in file explorer", Icon: FolderOpenIcon },
  refresh: { id: "refresh", label: "Refresh workspace", Icon: RefreshCwIcon },
  search: {
    id: "search",
    label: "Search & commands…",
    Icon: SearchIcon,
    hint: isMac ? "⌘K" : "Ctrl+K",
  },
};

export const CREATE_ACTIONS: WorkspaceActionDef[] = [
  ACT["new-request"],
  ACT["new-folder"],
  ACT["new-environment"],
];
export const IMPORT_ACTIONS: WorkspaceActionDef[] = [ACT["import-from-file"], ACT["import-curl"]];

export interface WorkspaceActionCtx {
  rootPath: string;
  requestAction: (a: PendingAction) => void;
  setPaletteOpen: (b: boolean) => void;
  refresh: () => void;
}

/** Dispatch an action by id. All create/import/export flow through the
 * `requestAction` store channel (Sidebar/SidebarHeader listen and open the
 * right dialog); refresh/reveal/search run directly. */
export function runWorkspaceAction(id: WorkspaceActionId, ctx: WorkspaceActionCtx): void {
  switch (id) {
    case "new-request":
      ctx.requestAction({ type: "new-request", parentPath: ctx.rootPath });
      break;
    case "new-folder":
      ctx.requestAction({ type: "new-folder", parentPath: ctx.rootPath });
      break;
    case "new-environment":
      ctx.requestAction({ type: "new-environment" });
      break;
    case "import-from-file":
      ctx.requestAction({ type: "import-from-file" });
      break;
    case "import-curl":
      ctx.requestAction({ type: "import-curl" });
      break;
    case "export-workspace":
      ctx.requestAction({ type: "export-workspace" });
      break;
    case "refresh":
      ctx.refresh();
      break;
    case "reveal":
      void revealInFileManager(ctx.rootPath);
      break;
    case "search":
      ctx.setPaletteOpen(true);
      break;
  }
}
