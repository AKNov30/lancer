import { KeyIcon, PlusIcon, Trash2Icon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useEnv } from "@/stores/env-store";
import { type Capture, useRequest } from "@/stores/request-store";

/**
 * Editor for "post-response captures" — JSONPath expressions that extract
 * values from the response body and stash them into the runtime env overlay
 * after a successful send. The downstream request can then use the captured
 * value as `{{varName}}`.
 *
 * Captures are session-scoped: they live in memory until app restart, mirror
 * how Postman's `pm.environment.set(...)` behaves at the UI level. We may
 * persist them to `.bru` in a future release.
 */
export function CapturesEditor() {
  const captures = useRequest((s) => s.request.captures);
  const setCaptures = useRequest((s) => s.setCaptures);
  const activeEnv = useEnv((s) => s.activeEnv);

  function update(idx: number, patch: Partial<Capture>) {
    const next = captures.map((c, i) => (i === idx ? { ...c, ...patch } : c));
    setCaptures(next);
  }

  function add() {
    setCaptures([
      ...captures,
      { id: crypto.randomUUID(), enabled: true, jsonpath: "$.token", envVar: "" },
    ]);
  }

  function remove(idx: number) {
    setCaptures(captures.filter((_, i) => i !== idx));
  }

  return (
    <div className="flex h-full flex-col gap-3 p-3">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="font-semibold text-foreground text-sm">Post-response captures</h3>
          <p className="mt-0.5 text-muted-foreground text-xs">
            Extract from the response body via JSONPath and store as a variable. Use{" "}
            <code className="rounded-sm border border-border bg-card px-1 font-mono text-[11px]">
              {"{{name}}"}
            </code>{" "}
            in downstream requests.{" "}
            <span className="text-[color:var(--color-warning)]">
              Session-scoped — captured values clear on app restart, and these capture rules reset
              when the tab is closed.
            </span>
            {activeEnv && (
              <span className="ml-1 text-muted-foreground/80">
                Active env: <span className="font-medium text-foreground">"{activeEnv}"</span>.
              </span>
            )}
          </p>
        </div>
        <Button
          size="sm"
          variant="outline"
          onClick={add}
          className="shrink-0 cursor-pointer gap-1.5"
        >
          <PlusIcon className="size-3.5" strokeWidth={1.75} aria-hidden="true" />
          Add capture
        </Button>
      </div>

      {captures.length === 0 ? (
        <div className="bg-mesh-primary flex flex-1 flex-col items-center justify-center gap-2 rounded-md border border-border/60 border-dashed p-6 text-center">
          <KeyIcon
            className="size-7 text-muted-foreground/40"
            strokeWidth={1.25}
            aria-hidden="true"
          />
          <p className="font-medium text-foreground text-sm">No captures defined</p>
          <p className="max-w-[40ch] text-muted-foreground text-xs">
            After this request runs, captured values can be reused in another request's URL, body,
            or headers via <code className="font-mono">{"{{name}}"}</code>.
          </p>
          <Button size="sm" variant="outline" onClick={add} className="mt-1 cursor-pointer gap-1.5">
            <PlusIcon className="size-3.5" strokeWidth={1.75} aria-hidden="true" />
            Add your first capture
          </Button>
        </div>
      ) : (
        <ul className="flex flex-col gap-1.5">
          <li className="grid grid-cols-[1fr_1fr_36px] items-center gap-2 px-1 font-mono font-semibold text-[10px] text-muted-foreground/70 tracking-[0.15em] uppercase">
            <span>JSONPath</span>
            <span>Variable name</span>
            <span aria-hidden="true" />
          </li>
          {captures.map((c, idx) => (
            <li
              key={c.id}
              className="grid grid-cols-[1fr_1fr_36px] items-center gap-2 rounded-md border border-border/60 bg-card/40 p-1.5"
            >
              <Input
                value={c.jsonpath}
                onChange={(e) => update(idx, { jsonpath: e.target.value })}
                placeholder="$.token"
                className="h-7 font-mono text-xs"
                aria-label="JSONPath expression"
              />
              <Input
                value={c.envVar}
                onChange={(e) => update(idx, { envVar: e.target.value })}
                placeholder="auth_token"
                className="h-7 font-mono text-xs"
                aria-label="Variable name"
              />
              <Button
                size="sm"
                variant="ghost"
                onClick={() => remove(idx)}
                className="h-7 w-7 cursor-pointer p-0 text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive"
                aria-label="Remove capture"
                title="Remove capture"
              >
                <Trash2Icon className="size-3.5" strokeWidth={1.75} aria-hidden="true" />
              </Button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
