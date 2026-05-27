import { KeyIcon } from "lucide-react";
import { KvTable } from "@/components/ui/kv-table";
import { useRequest } from "@/stores/request-store";

/**
 * Per-request variables editor. These vars layer ABOVE env file values and
 * BELOW the runtime overlay during substitution, so each request can carry
 * its own defaults without polluting the global env.
 *
 * Round-trips through `.bru`'s `vars { ... }` block — saved on disk
 * alongside the request, unlike captures (which are session-only).
 */
export function VarsEditor() {
  const vars = useRequest((s) => s.request.vars);
  const setVars = useRequest((s) => s.setVars);

  return (
    <div className="flex h-full flex-col gap-3 p-3">
      <div className="flex items-start gap-3 rounded-md border border-border/60 bg-card/40 p-3">
        <KeyIcon
          className="mt-0.5 size-4 shrink-0 text-muted-foreground"
          strokeWidth={1.75}
          aria-hidden="true"
        />
        <div className="space-y-0.5">
          <h3 className="font-semibold text-foreground text-sm">Request variables</h3>
          <p className="text-muted-foreground text-xs">
            Use{" "}
            <code className="rounded-sm border border-border bg-card px-1 font-mono text-[11px]">
              {"{{name}}"}
            </code>{" "}
            anywhere in URL, headers, query, body, or auth. These vars override env file values and
            are persisted to the <code className="font-mono">.bru</code> file.
          </p>
        </div>
      </div>
      <KvTable
        rows={vars}
        onChange={setVars}
        keyPlaceholder="userId"
        valuePlaceholder="42"
        hint="Precedence: folder.bru < environment < this request < runtime captures."
      />
    </div>
  );
}
