import { useEffect, useMemo, useState } from "react";
import { type ResolvedVar, resolveVars } from "@/lib/tauri";
import { kvRowsToTuples } from "@/lib/types";
import { useCaptures } from "@/stores/captures-store";
import { useEnv } from "@/stores/env-store";
import { useRequest, useTabs } from "@/stores/request-store";
import { useWorkspace } from "@/stores/workspace-store";

const TOKEN = /\{\{\s*([^}]+?)\s*\}\}/g;

type SegKind = "lit" | "known" | "secret" | "unknown";

/**
 * Live "resolves to" preview under the URL bar. Substitutes every `{{var}}`
 * in the URL with its actual value — green for resolved, amber `••••` for
 * secrets (masked), red for unresolved — so the user can SEE exactly what
 * endpoint the request will hit before sending. (Postman only shows this on
 * hover per-token; a persistent line is clearer.)
 */
export function VarResolvedPreview() {
  const url = useRequest((s) => s.request.url);
  const vars = useRequest((s) => s.request.vars);
  const workspaceRoot = useWorkspace((s) => s.rootPath);
  const activeEnv = useEnv((s) => s.activeEnv);
  const savedPath = useTabs(
    (s) => (s.tabs.find((t) => t.id === s.activeId) ?? s.tabs[0])?.savedPath ?? null,
  );
  const getOverlayForEnv = useCaptures((s) => s.getForEnv);
  // Subscribe to the active env's overlay BAG so the "resolves to" preview
  // re-runs when a capture writes a new token. `getForEnv` is a stable ref and
  // would otherwise never trigger the debounced resolve below on new captures.
  const overlayBag = useCaptures((s) => s.overlay[activeEnv ?? "__none__"]);

  const [map, setMap] = useState<Record<string, ResolvedVar>>({});

  const hasTokens = url.includes("{{");

  // Resolve (debounced) whenever the URL or variable context changes. Reading
  // folder.bru chain + env + keyring secrets needs the Rust backend, so this
  // can't be done purely client-side and stay accurate.
  // biome-ignore lint/correctness/useExhaustiveDependencies: overlayBag is a re-run trigger (its content, read via getForEnv, isn't otherwise reactive)
  useEffect(() => {
    if (!hasTokens) {
      setMap({});
      return;
    }
    let cancelled = false;
    const t = setTimeout(() => {
      const extraVars = [...kvRowsToTuples(vars), ...getOverlayForEnv(activeEnv)];
      void resolveVars({
        workspaceRoot: workspaceRoot ?? undefined,
        envName: activeEnv,
        requestPath: savedPath ?? undefined,
        extraVars: extraVars.length > 0 ? extraVars : undefined,
      })
        .then((list) => {
          if (cancelled) return;
          const m: Record<string, ResolvedVar> = {};
          for (const v of list) m[v.name] = v;
          setMap(m);
        })
        .catch(() => {
          if (!cancelled) setMap({});
        });
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
    // `url` intentionally excluded — the resolved var VALUES don't depend on
    // url text (only on env/folder/captures); `hasTokens` gates on/off.
    // `overlayBag` is included so a fresh capture re-resolves the preview.
  }, [vars, workspaceRoot, activeEnv, savedPath, getOverlayForEnv, hasTokens, overlayBag]);

  const segments = useMemo(() => {
    if (!hasTokens) return null;
    const segs: Array<{ text: string; kind: SegKind }> = [];
    let last = 0;
    for (const mt of url.matchAll(TOKEN)) {
      const idx = mt.index ?? 0;
      if (idx > last) segs.push({ text: url.slice(last, idx), kind: "lit" });
      const name = mt[1].trim();
      const v = map[name];
      if (!v) segs.push({ text: `{{${name}}}`, kind: "unknown" });
      else if (v.isSecret) segs.push({ text: "••••", kind: "secret" });
      else segs.push({ text: v.value || "(empty)", kind: "known" });
      last = idx + mt[0].length;
    }
    if (last < url.length) segs.push({ text: url.slice(last), kind: "lit" });
    return segs;
  }, [url, map, hasTokens]);

  if (!hasTokens || !segments || segments.length === 0) return null;

  const anyUnknown = segments.some((s) => s.kind === "unknown");

  return (
    <div className="flex items-center gap-2 border-border/40 border-b bg-card/30 px-3 py-1">
      <span className="shrink-0 font-mono text-[10px] text-muted-foreground/50 uppercase tracking-[0.1em]">
        resolves&nbsp;to
      </span>
      <span className="min-w-0 flex-1 truncate font-mono text-[11px]">
        {segments.map((s, i) => (
          <span
            // biome-ignore lint/suspicious/noArrayIndexKey: positional segments regenerated wholesale
            key={`${i}-${s.kind}`}
            className={
              s.kind === "known"
                ? "text-[color:var(--color-success)]"
                : s.kind === "secret"
                  ? "text-[color:var(--color-warning)]"
                  : s.kind === "unknown"
                    ? "text-[color:var(--color-destructive)]"
                    : "text-foreground/70"
            }
          >
            {s.text}
          </span>
        ))}
      </span>
      {anyUnknown && (
        <span className="shrink-0 font-medium text-[10px] text-[color:var(--color-destructive)]">
          unresolved {"{{var}}"}
        </span>
      )}
    </div>
  );
}
