import { MoreVerticalIcon, PlusIcon, RefreshCwIcon } from "lucide-react";
import { useEffect, useState } from "react";
import { CurlImportDialog } from "@/components/importers/curl-dialog";
import { OpenApiImportDialog } from "@/components/importers/openapi-dialog";
import { PostmanDialog } from "@/components/importers/postman-dialog";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  ACT,
  CREATE_ACTIONS,
  IMPORT_ACTIONS,
  runWorkspaceAction,
  type WorkspaceActionCtx,
  type WorkspaceActionDef,
} from "@/lib/workspace-actions";
import { useUi } from "@/stores/ui-store";

interface SidebarHeaderProps {
  rootPath: string;
  loading: boolean;
  onRefresh: () => void;
}

/**
 * Sidebar header — compact:  [+ Add ▾]            [⟳] [⋮]
 *
 * Every action here renders from the shared `workspace-actions` descriptors
 * and dispatches via `runWorkspaceAction`, so the "+ Add" menu, the sidebar
 * right-click menu, and the command palette stay perfectly in sync (same
 * label, icon, and behavior — they used to drift).
 */
export function SidebarHeader({ rootPath, loading, onRefresh }: SidebarHeaderProps) {
  // Track which importer dialog is open. Only one at a time.
  const [openImporter, setOpenImporter] = useState<null | "curl" | "openapi" | "postman">(null);

  const pendingAction = useUi((s) => s.pendingAction);
  const requestAction = useUi((s) => s.requestAction);
  const setPaletteOpen = useUi((s) => s.setPaletteOpen);
  const clearPendingAction = useUi((s) => s.clearPendingAction);

  // Bridge: import actions dispatched from anywhere (palette, +Add, context
  // menu) land here and open the matching dialog.
  useEffect(() => {
    if (!pendingAction) return;
    if (pendingAction.type === "import-curl") {
      setOpenImporter("curl");
      clearPendingAction();
    } else if (pendingAction.type === "import-openapi") {
      setOpenImporter("openapi");
      clearPendingAction();
    } else if (pendingAction.type === "import-postman") {
      setOpenImporter("postman");
      clearPendingAction();
    }
  }, [pendingAction, clearPendingAction]);

  const ctx: WorkspaceActionCtx = { rootPath, requestAction, setPaletteOpen, refresh: onRefresh };

  function Item({ def }: { def: WorkspaceActionDef }) {
    const Icon = def.Icon;
    return (
      <DropdownMenuItem
        className="cursor-pointer gap-2"
        onSelect={() => runWorkspaceAction(def.id, ctx)}
      >
        <Icon className="size-3.5" strokeWidth={1.75} aria-hidden="true" />
        {def.label}
        {def.hint && (
          <span className="ml-auto font-mono text-[10px] text-muted-foreground">{def.hint}</span>
        )}
      </DropdownMenuItem>
    );
  }

  return (
    <div className="relative flex shrink-0 items-center justify-between gap-1 px-2 py-1.5">
      {/* Left: Add dropdown */}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            size="sm"
            className="h-7 cursor-pointer gap-1 px-2 text-xs"
            title="Add a new request, folder, or import"
          >
            <PlusIcon className="size-3.5" strokeWidth={2} aria-hidden="true" />
            Add
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="min-w-[220px]">
          <DropdownMenuLabel className="font-mono font-semibold text-[10px] text-muted-foreground/70 tracking-[0.15em] uppercase">
            Create
          </DropdownMenuLabel>
          {CREATE_ACTIONS.map((def) => (
            <Item key={def.id} def={def} />
          ))}

          <DropdownMenuSeparator />

          <DropdownMenuLabel className="font-mono font-semibold text-[10px] text-muted-foreground/70 tracking-[0.15em] uppercase">
            Import
          </DropdownMenuLabel>
          {IMPORT_ACTIONS.map((def) => (
            <Item key={def.id} def={def} />
          ))}

          <DropdownMenuSeparator />

          <DropdownMenuLabel className="font-mono font-semibold text-[10px] text-muted-foreground/70 tracking-[0.15em] uppercase">
            Find
          </DropdownMenuLabel>
          <Item def={ACT.search} />
        </DropdownMenuContent>
      </DropdownMenu>

      {/* Right: Refresh + Overflow */}
      <div className="flex items-center gap-0.5">
        <Button
          variant="ghost"
          size="sm"
          className="h-7 w-7 cursor-pointer p-0 text-muted-foreground transition-colors hover:text-foreground"
          onClick={onRefresh}
          title="Refresh workspace"
          aria-label="Refresh workspace"
        >
          <RefreshCwIcon
            className={loading ? "size-3.5 animate-spin" : "size-3.5"}
            strokeWidth={1.75}
            aria-hidden="true"
          />
        </Button>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="sm"
              className="h-7 w-7 cursor-pointer p-0 text-muted-foreground transition-colors hover:text-foreground"
              title="More workspace actions"
              aria-label="Workspace menu"
            >
              <MoreVerticalIcon className="size-3.5" strokeWidth={1.75} aria-hidden="true" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="min-w-[220px]">
            <DropdownMenuLabel className="break-all font-mono text-[10px] text-muted-foreground">
              {rootPath}
            </DropdownMenuLabel>
            <DropdownMenuSeparator />
            <Item def={ACT["export-workspace"]} />
            <Item def={ACT.reveal} />
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      <div aria-hidden="true" className="divider-fade-h absolute inset-x-2 bottom-0" />

      {/* Importer dialogs — controlled by the dropdown above. Mounted lazily. */}
      <CurlImportDialog
        open={openImporter === "curl"}
        onOpenChange={(v) => !v && setOpenImporter(null)}
      />
      <OpenApiImportDialog
        open={openImporter === "openapi"}
        onOpenChange={(v) => !v && setOpenImporter(null)}
      />
      <PostmanDialog
        workspaceRoot={rootPath}
        onImported={onRefresh}
        open={openImporter === "postman"}
        onOpenChange={(v) => !v && setOpenImporter(null)}
      />
    </div>
  );
}
