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
          className="h-7 px-2 text-xs"
          onClick={() => setSheetOpen(true)}
        >
          Manage…
        </Button>
        <EnvEditorSheet open={sheetOpen} onOpenChange={setSheetOpen} />
      </div>
    );
  }

  return (
    <div className="flex items-center gap-1">
      <Select
        value={activeEnv ?? NO_ENV}
        onValueChange={(v) => setActiveEnv(v === NO_ENV ? null : v, rootPath)}
      >
        <SelectTrigger className="w-[140px] text-xs">
          <SelectValue placeholder="No env" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={NO_ENV}>No env</SelectItem>
          {available.map((n) => (
            <SelectItem key={n} value={n}>
              {n}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Button
        variant="ghost"
        size="sm"
        className="h-7 px-2 text-xs"
        onClick={() => setSheetOpen(true)}
      >
        Manage…
      </Button>
      <EnvEditorSheet open={sheetOpen} onOpenChange={setSheetOpen} />
    </div>
  );
}
