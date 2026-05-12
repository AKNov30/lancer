import { useEffect } from "react";
import { CurlImportDialog } from "@/components/importers/curl-dialog";
import { OpenApiImportDialog } from "@/components/importers/openapi-dialog";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { readRequest } from "@/lib/tauri";
import type { Auth, Method } from "@/lib/types";
import { useRequest } from "@/stores/request-store";
import { useWorkspace } from "@/stores/workspace-store";

const METHOD_COLOR: Record<Method, string> = {
  GET: "var(--color-method-get)",
  POST: "var(--color-method-post)",
  PUT: "var(--color-method-put)",
  PATCH: "var(--color-method-patch)",
  DELETE: "var(--color-method-delete)",
  HEAD: "var(--color-method-head)",
  OPTIONS: "var(--color-method-options)",
};

function isMethod(s: string): s is Method {
  return (
    s === "GET" ||
    s === "POST" ||
    s === "PUT" ||
    s === "PATCH" ||
    s === "DELETE" ||
    s === "HEAD" ||
    s === "OPTIONS"
  );
}

export function Sidebar() {
  const rootPath = useWorkspace((s) => s.rootPath);
  const items = useWorkspace((s) => s.items);
  const loading = useWorkspace((s) => s.loading);
  const error = useWorkspace((s) => s.error);
  const openFolder = useWorkspace((s) => s.openFolder);
  const refresh = useWorkspace((s) => s.refresh);

  const setUrl = useRequest((s) => s.setUrl);
  const setMethod = useRequest((s) => s.setMethod);
  const setAuth = useRequest((s) => s.setAuth);

  // Refresh on mount and whenever the root path changes.
  useEffect(() => {
    void refresh();
  }, [refresh]);

  if (!rootPath) {
    return (
      <div className="flex h-full min-w-0 flex-col items-center justify-center gap-3 p-4 text-center">
        <div className="font-display text-xl italic text-muted-foreground">Open a folder</div>
        <p className="max-w-[24ch] text-muted-foreground/80 text-xs leading-relaxed">
          Your <code className="font-mono text-foreground">.bru</code> files live anywhere on disk.
          Sync via Git.
        </p>
        <Button size="sm" onClick={() => void openFolder()}>
          Open folder
        </Button>
      </div>
    );
  }

  return (
    <div className="flex h-full min-w-0 flex-col">
      <div className="flex shrink-0 items-center justify-between gap-1 border-border border-b px-2 py-1.5">
        <div className="flex items-center gap-0.5">
          <CurlImportDialog />
          <OpenApiImportDialog />
        </div>
        <Button
          variant="ghost"
          size="sm"
          className="h-7 px-2 text-xs"
          onClick={() => void openFolder()}
          title={`Change workspace folder (currently: ${rootPath})`}
        >
          Change
        </Button>
      </div>
      <ScrollArea className="flex-1">
        {loading && <div className="p-3 text-muted-foreground text-xs">Loading…</div>}
        {error && <div className="p-3 text-destructive text-xs">{error}</div>}
        {!loading && !error && items.length === 0 && (
          <div className="p-3 text-muted-foreground text-xs">
            No <code className="font-mono">.bru</code> files in this folder.
          </div>
        )}
        <ul className="py-1">
          {items.map((it) => {
            const m: Method = isMethod(it.method) ? it.method : "GET";
            return (
              <li key={it.path}>
                <button
                  type="button"
                  className="flex w-full items-center gap-2 px-2 py-1 text-left hover:bg-accent"
                  onClick={async () => {
                    try {
                      const req = await readRequest(it.path);
                      setUrl(req.url);
                      if (isMethod(req.method)) setMethod(req.method);
                      setAuth((req.auth ?? { kind: "none" }) as Auth);
                    } catch (e) {
                      console.error("read_request failed", e);
                    }
                  }}
                >
                  <span
                    className="w-12 shrink-0 rounded-sm px-1 py-px text-center font-mono font-semibold text-[10px] uppercase tracking-wider"
                    style={{
                      color: METHOD_COLOR[m],
                      backgroundColor: `color-mix(in oklch, ${METHOD_COLOR[m]} 15%, transparent)`,
                    }}
                  >
                    {m}
                  </span>
                  <span className="truncate text-xs">{it.name}</span>
                </button>
              </li>
            );
          })}
        </ul>
      </ScrollArea>
    </div>
  );
}
