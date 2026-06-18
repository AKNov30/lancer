import {
  CookieIcon,
  FolderOpenIcon,
  FolderPlusIcon,
  HistoryIcon,
  KeyboardIcon,
  LayersIcon,
  MonitorIcon,
  MoonIcon,
  MoonStarIcon,
  PanelBottomIcon,
  PanelRightIcon,
  PlayIcon,
  RefreshCwIcon,
  SettingsIcon,
  SunIcon,
} from "lucide-react";
import { useEffect } from "react";
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
  CommandShortcut,
} from "@/components/ui/command";
import { requestFromCollection } from "@/lib/collection-convert";
import { METHOD_COLOR } from "@/lib/method-color";
import { readRequest } from "@/lib/tauri";
import { isMethod, type Method } from "@/lib/types";
import {
  ACT,
  CREATE_ACTIONS,
  IMPORT_ACTIONS,
  runWorkspaceAction,
  type WorkspaceActionCtx,
  type WorkspaceActionDef,
} from "@/lib/workspace-actions";
import { useEnv } from "@/stores/env-store";
import { useLayout } from "@/stores/layout-store";
import { useTabs } from "@/stores/request-store";
import { useTheme } from "@/stores/theme-store";
import { toast } from "@/stores/toast-store";
import { useUi } from "@/stores/ui-store";
import { useWorkspace } from "@/stores/workspace-store";
import { leafName, useWorkspaces } from "@/stores/workspaces-store";

const isMac = typeof navigator !== "undefined" && /Mac|iPod|iPhone|iPad/.test(navigator.platform);
const MOD_KEY = isMac ? "⌘" : "Ctrl";

/**
 * Global command palette. Bound to Ctrl/Cmd+K. Search workspace requests by
 * name + relative path, plus quick actions for create / theme / layout /
 * environment / sheets.
 */
export function CommandPalette() {
  const open = useUi((s) => s.paletteOpen);
  const setOpen = useUi((s) => s.setPaletteOpen);
  const requestAction = useUi((s) => s.requestAction);

  const items = useWorkspace((s) => s.items);
  const rootPath = useWorkspace((s) => s.rootPath);
  const refreshWorkspace = useWorkspace((s) => s.refresh);
  const openFolder = useWorkspace((s) => s.openFolder);
  const setRootPath = useWorkspace((s) => s.setRootPath);
  const recentWorkspaces = useWorkspaces((s) => s.recent);

  const openInTab = useTabs((s) => s.openInTab);

  const envs = useEnv((s) => s.available);
  const activeEnv = useEnv((s) => s.activeEnv);
  const setActiveEnv = useEnv((s) => s.setActiveEnv);

  const theme = useTheme((s) => s.theme);
  const setTheme = useTheme((s) => s.setTheme);

  const orientation = useLayout((s) => s.responseOrientation);
  const setOrientation = useLayout((s) => s.setResponseOrientation);

  // ── Global Ctrl/Cmd+K to toggle ──────────────────────────────────────────
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = isMac ? e.metaKey : e.ctrlKey;
      if (mod && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen(!useUi.getState().paletteOpen);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [setOpen]);

  const fileItems = items.filter((it) => it.kind === "file");

  // Render Create/Import/Export from the SAME shared descriptors the +Add
  // dropdown and sidebar context menu use, so labels/icons never drift.
  const wsCtx: WorkspaceActionCtx = {
    rootPath: rootPath ?? "",
    requestAction,
    setPaletteOpen: setOpen,
    refresh: () => void refreshWorkspace(),
  };
  const renderCmdAction = (def: WorkspaceActionDef) => {
    const Icon = def.Icon;
    return (
      <CommandItem
        key={def.id}
        value={`${def.label} ${def.hint ?? ""}`}
        onSelect={() => runWorkspaceAction(def.id, wsCtx)}
      >
        <Icon aria-hidden="true" />
        <span>{def.label}</span>
        {def.hint && <CommandShortcut>{def.hint}</CommandShortcut>}
      </CommandItem>
    );
  };

  async function openRequest(path: string, name: string) {
    setOpen(false);
    try {
      const req = await readRequest(path);
      const method: Method = isMethod(req.method) ? req.method : "GET";
      const editor = requestFromCollection(req);
      openInTab(path, name, (t) => ({
        ...t,
        dirty: false,
        request: {
          url: req.url,
          method,
          // Preserve in-session state not stored on disk so re-opening an
          // already-open request via the palette doesn't wipe it.
          mode: t.request.mode,
          headers: editor.headers,
          query: editor.query,
          body: editor.body,
          options: t.request.options,
          vars: editor.vars,
          captures: t.request.captures,
          preRequestScript: editor.preRequestScript,
          postResponseScript: editor.postResponseScript,
        },
        auth: editor.auth,
      }));
    } catch (e) {
      console.error("openRequest failed", e);
      toast.error("Couldn't open request", {
        description: e instanceof Error ? e.message : String(e),
      });
    }
  }

  return (
    <CommandDialog open={open} onOpenChange={setOpen} title="Command palette">
      <CommandInput placeholder="Search requests · type a command…" />
      <CommandList>
        <CommandEmpty>No matches. Try a different keyword.</CommandEmpty>

        {fileItems.length > 0 && (
          <CommandGroup heading="Requests">
            {fileItems.slice(0, 50).map((it) => {
              const m = isMethod(it.method) ? it.method : "GET";
              return (
                <CommandItem
                  key={it.path}
                  value={`${it.name} ${it.relPath}`}
                  onSelect={() => void openRequest(it.path, it.name)}
                >
                  <span
                    className="min-w-12 shrink-0 rounded-[3px] border px-1.5 py-px text-center font-mono font-semibold text-[10px] uppercase tracking-wider"
                    style={{
                      color: METHOD_COLOR[m],
                      backgroundColor: `color-mix(in oklch, ${METHOD_COLOR[m]} 14%, transparent)`,
                      borderColor: `color-mix(in oklch, ${METHOD_COLOR[m]} 25%, transparent)`,
                      borderWidth: 1,
                      borderStyle: "solid",
                    }}
                  >
                    {m}
                  </span>
                  <span className="flex min-w-0 flex-1 flex-col">
                    <span className="truncate">{it.name}</span>
                    <span className="truncate font-mono text-[10px] text-muted-foreground">
                      {it.relPath}
                    </span>
                  </span>
                </CommandItem>
              );
            })}
          </CommandGroup>
        )}

        {fileItems.length > 0 && <CommandSeparator />}

        {recentWorkspaces.length > 1 && (
          <>
            <CommandGroup heading="Switch workspace">
              {recentWorkspaces
                .filter((w) => w.path.toLowerCase() !== (rootPath ?? "").toLowerCase())
                .slice(0, 6)
                .map((w) => {
                  const name = w.name?.trim() || leafName(w.path);
                  return (
                    <CommandItem
                      key={w.path}
                      value={`workspace ${name} ${w.path}`}
                      onSelect={() => {
                        setOpen(false);
                        setRootPath(w.path);
                        void refreshWorkspace();
                      }}
                    >
                      <FolderOpenIcon aria-hidden="true" />
                      <span className="flex min-w-0 flex-1 flex-col">
                        <span className="truncate">{name}</span>
                        <span className="truncate font-mono text-[10px] text-muted-foreground">
                          {w.path}
                        </span>
                      </span>
                    </CommandItem>
                  );
                })}
            </CommandGroup>
            <CommandSeparator />
          </>
        )}

        <CommandGroup heading="Create">{CREATE_ACTIONS.map(renderCmdAction)}</CommandGroup>

        <CommandSeparator />

        <CommandGroup heading="Import">{IMPORT_ACTIONS.map(renderCmdAction)}</CommandGroup>

        <CommandSeparator />

        <CommandGroup heading="Run">
          <CommandItem
            value="run workspace folder"
            disabled={!rootPath}
            onSelect={() => rootPath && requestAction({ type: "run-folder", folderPath: rootPath })}
          >
            <PlayIcon aria-hidden="true" />
            <span>Run workspace…</span>
          </CommandItem>
        </CommandGroup>

        <CommandSeparator />

        <CommandGroup heading="Export">{renderCmdAction(ACT["export-workspace"])}</CommandGroup>

        {envs.length > 0 && (
          <>
            <CommandSeparator />
            <CommandGroup heading="Switch environment">
              <CommandItem
                value="no environment none"
                onSelect={() => {
                  setActiveEnv(null, rootPath ?? null);
                  setOpen(false);
                }}
              >
                <LayersIcon aria-hidden="true" />
                <span>No environment</span>
                {activeEnv === null && <CommandShortcut>active</CommandShortcut>}
              </CommandItem>
              {envs.map((name) => (
                <CommandItem
                  key={name}
                  value={`env ${name}`}
                  onSelect={() => {
                    setActiveEnv(name, rootPath ?? null);
                    setOpen(false);
                  }}
                >
                  <LayersIcon aria-hidden="true" />
                  <span>{name}</span>
                  {activeEnv === name && <CommandShortcut>active</CommandShortcut>}
                </CommandItem>
              ))}
            </CommandGroup>
          </>
        )}

        <CommandSeparator />

        <CommandGroup heading="Appearance">
          <CommandItem
            value="theme light"
            onSelect={() => {
              setTheme("light");
              setOpen(false);
            }}
          >
            <SunIcon aria-hidden="true" />
            <span>Theme: Light</span>
            {theme === "light" && <CommandShortcut>active</CommandShortcut>}
          </CommandItem>
          <CommandItem
            value="theme dark"
            onSelect={() => {
              setTheme("dark");
              setOpen(false);
            }}
          >
            <MoonIcon aria-hidden="true" />
            <span>Theme: Dark</span>
            {theme === "dark" && <CommandShortcut>active</CommandShortcut>}
          </CommandItem>
          <CommandItem
            value="theme soft dark"
            onSelect={() => {
              setTheme("dark-soft");
              setOpen(false);
            }}
          >
            <MoonStarIcon aria-hidden="true" />
            <span>Theme: Soft Dark</span>
            {theme === "dark-soft" && <CommandShortcut>active</CommandShortcut>}
          </CommandItem>
          <CommandItem
            value="theme system"
            onSelect={() => {
              setTheme("system");
              setOpen(false);
            }}
          >
            <MonitorIcon aria-hidden="true" />
            <span>Theme: System</span>
            {theme === "system" && <CommandShortcut>active</CommandShortcut>}
          </CommandItem>

          <CommandItem
            value="layout response right side"
            onSelect={() => {
              setOrientation("right");
              setOpen(false);
            }}
          >
            <PanelRightIcon aria-hidden="true" />
            <span>Layout: Response on right</span>
            {orientation === "right" && <CommandShortcut>active</CommandShortcut>}
          </CommandItem>
          <CommandItem
            value="layout response bottom"
            onSelect={() => {
              setOrientation("bottom");
              setOpen(false);
            }}
          >
            <PanelBottomIcon aria-hidden="true" />
            <span>Layout: Response on bottom</span>
            {orientation === "bottom" && <CommandShortcut>active</CommandShortcut>}
          </CommandItem>
        </CommandGroup>

        <CommandSeparator />

        <CommandGroup heading="Workspace">
          <CommandItem
            value="new workspace create name"
            onSelect={() => {
              setOpen(false);
              requestAction({ type: "new-workspace" });
            }}
          >
            <FolderPlusIcon aria-hidden="true" />
            <span>New workspace…</span>
            <CommandShortcut>just a name</CommandShortcut>
          </CommandItem>
          <CommandItem
            value="open existing folder workspace"
            onSelect={() => {
              setOpen(false);
              void openFolder();
            }}
          >
            <FolderOpenIcon aria-hidden="true" />
            <span>Open existing folder…</span>
            <CommandShortcut>{MOD_KEY} O</CommandShortcut>
          </CommandItem>
          <CommandItem
            value="refresh workspace reload"
            onSelect={() => {
              void refreshWorkspace();
              setOpen(false);
            }}
          >
            <RefreshCwIcon aria-hidden="true" />
            <span>Refresh workspace</span>
            <CommandShortcut>{MOD_KEY} R</CommandShortcut>
          </CommandItem>
          <CommandItem
            value="history requests"
            onSelect={() => requestAction({ type: "open-history" })}
          >
            <HistoryIcon aria-hidden="true" />
            <span>Open history</span>
          </CommandItem>
          <CommandItem
            value="cookies jar manage"
            onSelect={() => requestAction({ type: "open-cookies" })}
          >
            <CookieIcon aria-hidden="true" />
            <span>Manage cookies…</span>
          </CommandItem>
          <CommandItem
            value="keyboard shortcuts cheatsheet"
            onSelect={() => requestAction({ type: "open-shortcuts" })}
          >
            <KeyboardIcon aria-hidden="true" />
            <span>Keyboard shortcuts</span>
            <CommandShortcut>?</CommandShortcut>
          </CommandItem>
          <CommandItem
            value="settings preferences"
            onSelect={() => requestAction({ type: "open-settings" })}
          >
            <SettingsIcon aria-hidden="true" />
            <span>Open settings</span>
          </CommandItem>
        </CommandGroup>
      </CommandList>
    </CommandDialog>
  );
}
