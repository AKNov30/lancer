import { useEffect } from "react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useEnv } from "@/stores/env-store";
import { useWorkspace } from "@/stores/workspace-store";

const NO_ENV = "__none__";

export function EnvSwitcher() {
  const rootPath = useWorkspace((s) => s.rootPath);
  const available = useEnv((s) => s.available);
  const activeEnv = useEnv((s) => s.activeEnv);
  const refresh = useEnv((s) => s.refresh);
  const setActiveEnv = useEnv((s) => s.setActiveEnv);

  useEffect(() => {
    void refresh(rootPath);
  }, [rootPath, refresh]);

  if (!rootPath) {
    return <span className="text-muted-foreground text-xs">No workspace</span>;
  }
  if (available.length === 0) {
    return <span className="text-muted-foreground text-xs">No environments</span>;
  }

  return (
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
  );
}
