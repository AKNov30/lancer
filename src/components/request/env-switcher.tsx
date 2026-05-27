import { LayersIcon } from "lucide-react";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useEnv } from "@/stores/env-store";
import { useUi } from "@/stores/ui-store";
import { useWorkspace } from "@/stores/workspace-store";
import { EnvEditorSheet } from "./env-editor-sheet";

const NO_ENV = "__none__";

export function EnvSwitcher() {
  const rootPath = useWorkspace((s) => s.rootPath);
  const available = useEnv((s) => s.available);
  const activeEnv = useEnv((s) => s.activeEnv);
  const refresh = useEnv((s) => s.refresh);
  const setActiveEnv = useEnv((s) => s.setActiveEnv);

  const [sheetOpen, setSheetOpen] = useState(false);

  useEffect(() => {
    void refresh(rootPath);
  }, [rootPath, refresh]);

  // Command palette → "New environment" / "Open env editor" channel.
  const pendingAction = useUi((s) => s.pendingAction);
  const clearPendingAction = useUi((s) => s.clearPendingAction);
  useEffect(() => {
    if (pendingAction?.type === "new-environment" || pendingAction?.type === "open-env-editor") {
      setSheetOpen(true);
      clearPendingAction();
    }
  }, [pendingAction, clearPendingAction]);

  if (!rootPath) {
    return (
      <div className="flex items-center gap-1">
        <span className="text-xs text-muted-foreground">No workspace</span>
      </div>
    );
  }

  if (available.length === 0) {
    return (
      <div className="flex items-center gap-1">
        <span className="text-xs text-muted-foreground">No environments</span>
        <Button
          variant="ghost"
          size="sm"
          className="h-7 cursor-pointer px-2 text-xs"
          onClick={() => setSheetOpen(true)}
        >
          Manage…
        </Button>
        <EnvEditorSheet open={sheetOpen} onOpenChange={setSheetOpen} />
      </div>
    );
  }

  const hasActive = !!activeEnv;

  return (
    <div className="flex items-center gap-1">
      <Select
        value={activeEnv ?? NO_ENV}
        onValueChange={(v) => setActiveEnv(v === NO_ENV ? null : v, rootPath)}
      >
        <SelectTrigger
          className="h-7 w-[150px] cursor-pointer gap-1.5 text-xs transition-all duration-150 hover:shadow-sm focus:shadow-[var(--shadow-glow)]"
          aria-label="Switch environment"
          style={
            hasActive
              ? {
                  backgroundImage:
                    "linear-gradient(135deg, color-mix(in oklch, var(--color-info) 8%, transparent), transparent)",
                  borderColor: "color-mix(in oklch, var(--color-info) 25%, var(--color-border))",
                }
              : undefined
          }
        >
          <LayersIcon
            className="size-3.5 shrink-0 text-muted-foreground transition-colors group-hover:text-foreground"
            strokeWidth={1.75}
            aria-hidden="true"
          />
          <SelectValue placeholder="No env" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={NO_ENV} className="cursor-pointer">
            No env
          </SelectItem>
          {available.map((n) => (
            <SelectItem key={n} value={n} className="cursor-pointer">
              {n}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Button
        variant="ghost"
        size="sm"
        className="h-7 cursor-pointer px-2 text-xs"
        onClick={() => setSheetOpen(true)}
      >
        Manage…
      </Button>
      <EnvEditorSheet open={sheetOpen} onOpenChange={setSheetOpen} />
    </div>
  );
}
