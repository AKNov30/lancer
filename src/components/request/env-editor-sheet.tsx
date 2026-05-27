import { save as saveDialog } from "@tauri-apps/plugin-dialog";
import {
  CheckIcon,
  DownloadIcon,
  KeyIcon,
  Loader2,
  PlusIcon,
  SaveIcon,
  Trash2Icon,
  XIcon,
} from "lucide-react";
import { useEffect, useState } from "react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Sheet,
  SheetBody,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import {
  deleteEnv,
  deleteSecret,
  type Environment,
  getSecret,
  listEnvs,
  readEnv,
  saveBytes,
  setSecret,
  writeEnv,
} from "@/lib/tauri";
import { cn } from "@/lib/utils";
import { useEnv } from "@/stores/env-store";
import { useWorkspace } from "@/stores/workspace-store";

interface Props {
  open: boolean;
  onOpenChange: (b: boolean) => void;
}

export function EnvEditorSheet({ open, onOpenChange }: Props) {
  const rootPath = useWorkspace((s) => s.rootPath);
  const refreshEnvStore = useEnv((s) => s.refresh);

  const [envs, setEnvs] = useState<string[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [env, setEnv] = useState<Environment | null>(null);
  const [secretValues, setSecretValues] = useState<Record<string, string>>({});
  const [dirty, setDirty] = useState(false);
  const [savingState, setSavingState] = useState<"idle" | "saving" | "saved">("idle");
  const [error, setError] = useState<string | null>(null);
  const [newEnvName, setNewEnvName] = useState("");

  useEffect(() => {
    if (!open || !rootPath) return;
    listEnvs(rootPath)
      .then(setEnvs)
      .catch((e: unknown) => setError(String(e)));
  }, [open, rootPath]);

  useEffect(() => {
    if (!rootPath || !selected) {
      setEnv(null);
      return;
    }
    readEnv(rootPath, selected)
      .then((e) => {
        setEnv(e);
        setSecretValues({});
        setDirty(false);
        setSavingState("idle");
      })
      .catch((e: unknown) => setError(String(e)));
  }, [rootPath, selected]);

  async function fetchSecret(name: string) {
    if (!rootPath || !selected) return;
    if (secretValues[name] !== undefined) return;
    try {
      const v = await getSecret(rootPath, selected, name);
      setSecretValues((s) => ({ ...s, [name]: v ?? "" }));
    } catch (e) {
      setError(String(e));
    }
  }

  function updateVar(idx: number, key: string, value: string) {
    if (!env) return;
    const vars: [string, string][] = env.vars.map((v, i) => (i === idx ? [key, value] : v));
    setEnv({ ...env, vars });
    setDirty(true);
  }

  function addVar() {
    if (!env) return;
    setEnv({ ...env, vars: [...env.vars, ["", ""]] });
    setDirty(true);
  }

  function removeVar(idx: number) {
    if (!env) return;
    setEnv({ ...env, vars: env.vars.filter((_, i) => i !== idx) });
    setDirty(true);
  }

  function addSecret() {
    if (!env) return;
    setEnv({ ...env, secretNames: [...env.secretNames, ""] });
    setDirty(true);
  }

  function renameSecret(idx: number, name: string) {
    if (!env) return;
    setEnv({
      ...env,
      secretNames: env.secretNames.map((s, i) => (i === idx ? name : s)),
    });
    setDirty(true);
  }

  function setSecretLocalValue(name: string, value: string) {
    setSecretValues((s) => ({ ...s, [name]: value }));
    setDirty(true);
  }

  async function removeSecret(idx: number) {
    if (!env || !rootPath || !selected) return;
    const name = env.secretNames[idx];
    setEnv({ ...env, secretNames: env.secretNames.filter((_, i) => i !== idx) });
    setDirty(true);
    if (name) {
      try {
        await deleteSecret(rootPath, selected, name);
      } catch (e) {
        setError(String(e));
      }
    }
  }

  async function save() {
    if (!env || !rootPath || !selected || savingState === "saving") return;
    setError(null);
    setSavingState("saving");
    try {
      await writeEnv(rootPath, env);
      for (const name of env.secretNames) {
        const v = secretValues[name];
        if (v !== undefined && v !== "") {
          await setSecret(rootPath, selected, name, v);
        }
      }
      setDirty(false);
      await refreshEnvStore(rootPath);
      setSavingState("saved");
      setTimeout(() => setSavingState("idle"), 1500);
    } catch (e) {
      setError(String(e));
      setSavingState("idle");
    }
  }

  /**
   * Export the currently-selected environment as a Postman v2.1 environment
   * JSON file. Secrets are NOT included — Postman wants the values inline
   * and we never want to ship a token to disk in plaintext. The exported
   * file references them by key but leaves `value` empty.
   */
  async function exportEnvAsPostman() {
    if (!env || !selected) return;
    setError(null);
    try {
      const values: Array<{
        key: string;
        value: string;
        enabled: boolean;
        type: "default" | "secret";
      }> = [];
      for (const [k, v] of env.vars) {
        values.push({ key: k, value: v, enabled: true, type: "default" });
      }
      for (const name of env.secretNames) {
        values.push({ key: name, value: "", enabled: true, type: "secret" });
      }
      const payload = {
        id: crypto.randomUUID(),
        name: env.name,
        values,
        _postman_variable_scope: "environment",
        _postman_exported_at: new Date().toISOString(),
        _postman_exported_using: "Lancer",
      };
      const json = JSON.stringify(payload, null, 2);
      const target = await saveDialog({
        defaultPath: `${env.name}.postman_environment.json`,
        filters: [{ name: "Postman Environment", extensions: ["json"] }],
        title: `Export environment "${env.name}" as Postman v2.1`,
      });
      if (!target) return;
      await saveBytes(target, Array.from(new TextEncoder().encode(json)));
    } catch (e) {
      setError(String(e));
    }
  }

  async function handleDeleteEnv() {
    if (!rootPath || !selected) return;
    try {
      await deleteEnv(rootPath, selected);
      setSelected(null);
      setEnv(null);
      const list = await listEnvs(rootPath);
      setEnvs(list);
      await refreshEnvStore(rootPath);
    } catch (e) {
      setError(String(e));
    }
  }

  async function createNewEnv() {
    if (!rootPath || !newEnvName.trim()) return;
    const fresh: Environment = {
      name: newEnvName.trim(),
      vars: [],
      secretNames: [],
    };
    try {
      await writeEnv(rootPath, fresh);
      setNewEnvName("");
      const list = await listEnvs(rootPath);
      setEnvs(list);
      setSelected(fresh.name);
      await refreshEnvStore(rootPath);
    } catch (e) {
      setError(String(e));
    }
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-[720px] sm:max-w-[720px]">
        <SheetHeader>
          <SheetTitle>Environments</SheetTitle>
          <SheetDescription>
            Manage variables and secrets per environment. Secrets live in your OS keyring; vars
            commit to <code className="font-mono">environments/</code>.
          </SheetDescription>
        </SheetHeader>

        {!rootPath ? (
          <SheetBody>
            <div className="text-muted-foreground text-sm">Open a folder first.</div>
          </SheetBody>
        ) : (
          <div className="flex min-h-0 flex-1 gap-0">
            {/* Left: env list (sticky panel inside sheet) */}
            <aside className="flex w-[200px] shrink-0 flex-col gap-1.5 border-border/60 border-r px-3 py-4">
              <Label className="font-mono font-semibold text-[10px] text-muted-foreground/70 tracking-[0.15em] uppercase">
                Environments
                <span className="ml-1.5 nums-tabular text-muted-foreground/40">{envs.length}</span>
              </Label>
              <div className="flex flex-col gap-0.5">
                {envs.map((n) => {
                  const isActive = selected === n;
                  return (
                    <button
                      key={n}
                      type="button"
                      data-active={isActive}
                      className={cn(
                        "group/env relative cursor-pointer rounded-sm px-2 py-1 text-left text-xs",
                        "transition-all duration-150 ease-out",
                        "hover:bg-accent/60",
                        "data-[active=true]:bg-accent",
                      )}
                      onClick={() => setSelected(n)}
                    >
                      <span
                        aria-hidden="true"
                        className={cn(
                          "absolute left-0 top-1/2 h-3.5 w-0.5 -translate-y-1/2 rounded-full bg-primary",
                          "scale-y-0 transition-transform duration-150",
                          "group-data-[active=true]/env:scale-y-100",
                        )}
                      />
                      <span className="ml-1.5 font-mono">{n}</span>
                    </button>
                  );
                })}
              </div>
              <div className="mt-2 flex gap-1">
                <Input
                  className="h-7 flex-1 text-xs"
                  placeholder="New env…"
                  value={newEnvName}
                  onChange={(e) => setNewEnvName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") void createNewEnv();
                  }}
                />
                <Button
                  size="sm"
                  onClick={() => void createNewEnv()}
                  disabled={!newEnvName.trim()}
                  className="h-7 w-7 cursor-pointer p-0 disabled:cursor-not-allowed"
                  title="Create env"
                  aria-label="Create env"
                >
                  <PlusIcon className="size-3.5" strokeWidth={2} aria-hidden="true" />
                </Button>
              </div>
            </aside>

            {/* Right: editor */}
            <div className="flex min-w-0 flex-1 flex-col">
              {error && (
                <div className="mx-4 mt-3 flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-xs">
                  <span className="font-medium text-destructive">Error:</span>
                  <span className="break-all font-mono text-muted-foreground">{error}</span>
                </div>
              )}

              <ScrollArea className="min-h-0 flex-1">
                {!env ? (
                  <div className="p-6 text-center text-muted-foreground text-sm">
                    Pick an env on the left, or create a new one.
                  </div>
                ) : (
                  <div className="space-y-5 px-4 py-4">
                    <div className="flex items-center justify-between gap-2">
                      <h3 className="truncate font-mono font-semibold text-sm">{env.name}</h3>
                      <div className="flex shrink-0 gap-2">
                        <Button
                          size="sm"
                          onClick={() => void save()}
                          disabled={(!dirty && savingState !== "saved") || savingState === "saving"}
                          className="cursor-pointer gap-1.5 disabled:cursor-not-allowed"
                        >
                          {savingState === "saved" ? (
                            <>
                              <CheckIcon
                                className="size-3.5 text-[color:var(--color-success)]"
                                strokeWidth={1.75}
                                aria-hidden="true"
                              />
                              Saved
                            </>
                          ) : savingState === "saving" ? (
                            <>
                              <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />
                              Saving…
                            </>
                          ) : (
                            <>
                              <SaveIcon
                                className="size-3.5"
                                strokeWidth={1.75}
                                aria-hidden="true"
                              />
                              Save
                            </>
                          )}
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => void exportEnvAsPostman()}
                          className="cursor-pointer gap-1.5"
                          title="Save this environment as a Postman v2.1 environment JSON file"
                        >
                          <DownloadIcon
                            className="size-3.5"
                            strokeWidth={1.75}
                            aria-hidden="true"
                          />
                          Export
                        </Button>
                        <AlertDialog>
                          <AlertDialogTrigger asChild>
                            <Button
                              size="sm"
                              variant="destructive"
                              className="cursor-pointer gap-1.5"
                            >
                              <Trash2Icon
                                className="size-3.5"
                                strokeWidth={1.75}
                                aria-hidden="true"
                              />
                              Delete
                            </Button>
                          </AlertDialogTrigger>
                          <AlertDialogContent>
                            <AlertDialogHeader>
                              <AlertDialogTitle>
                                Delete env &ldquo;{env.name}&rdquo;?
                              </AlertDialogTitle>
                              <AlertDialogDescription>
                                Removes the .bru file. Keyring secrets for this env are NOT deleted.
                              </AlertDialogDescription>
                            </AlertDialogHeader>
                            <AlertDialogFooter>
                              <AlertDialogCancel>Cancel</AlertDialogCancel>
                              <AlertDialogAction
                                variant="destructive"
                                onClick={() => void handleDeleteEnv()}
                              >
                                Delete
                              </AlertDialogAction>
                            </AlertDialogFooter>
                          </AlertDialogContent>
                        </AlertDialog>
                      </div>
                    </div>

                    {/* Variables */}
                    <section className="rounded-lg border border-border/60 bg-card/40 p-3 shadow-xs">
                      <div className="mb-2 flex items-center justify-between">
                        <Label className="font-semibold text-foreground text-xs">Variables</Label>
                        <span className="nums-tabular text-muted-foreground text-[10px]">
                          {env.vars.length}
                        </span>
                      </div>
                      <div className="space-y-1">
                        {env.vars.map(([k, v], idx) => (
                          <div
                            // biome-ignore lint/suspicious/noArrayIndexKey: vars have no stable id
                            key={idx}
                            className="group/row grid grid-cols-[1fr_1fr_32px] gap-1.5"
                          >
                            <Input
                              className="h-7 font-mono text-xs"
                              value={k}
                              placeholder="key"
                              onChange={(e) => updateVar(idx, e.target.value, v)}
                            />
                            <Input
                              className="h-7 font-mono text-xs"
                              value={v}
                              placeholder="value"
                              onChange={(e) => updateVar(idx, k, e.target.value)}
                            />
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={() => removeVar(idx)}
                              className="h-7 w-7 cursor-pointer p-0 text-muted-foreground/60 opacity-0 transition-opacity hover:text-destructive group-hover/row:opacity-100"
                              title="Remove variable"
                              aria-label="Remove variable"
                            >
                              <XIcon className="size-3.5" strokeWidth={1.75} aria-hidden="true" />
                            </Button>
                          </div>
                        ))}
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={addVar}
                          className="mt-1 w-full cursor-pointer gap-1.5 border-dashed text-muted-foreground hover:text-foreground"
                        >
                          <PlusIcon className="size-3.5" strokeWidth={1.75} aria-hidden="true" />
                          Add variable
                        </Button>
                      </div>
                    </section>

                    {/* Secrets */}
                    <section className="rounded-lg border border-border/60 bg-card/40 p-3 shadow-xs">
                      <div className="mb-2 flex items-center justify-between">
                        <Label className="flex items-center gap-1.5 font-semibold text-foreground text-xs">
                          <KeyIcon
                            className="size-3.5 text-[color:var(--color-warning)]"
                            strokeWidth={1.75}
                            aria-hidden="true"
                          />
                          Secrets
                          <span className="font-normal text-muted-foreground">(OS keyring)</span>
                        </Label>
                        <span className="nums-tabular text-muted-foreground text-[10px]">
                          {env.secretNames.length}
                        </span>
                      </div>
                      <div className="space-y-1">
                        {env.secretNames.map((name, idx) => (
                          <div
                            // biome-ignore lint/suspicious/noArrayIndexKey: secretNames have no stable id
                            key={idx}
                            className="group/row grid grid-cols-[1fr_1fr_32px] gap-1.5"
                          >
                            <Input
                              className="h-7 font-mono text-xs"
                              value={name}
                              placeholder="name"
                              onChange={(e) => renameSecret(idx, e.target.value)}
                            />
                            <Input
                              type="password"
                              className="h-7 font-mono text-xs"
                              value={secretValues[name] ?? ""}
                              placeholder={name ? "(stored in keyring — click to reveal/edit)" : ""}
                              onFocus={() => name && void fetchSecret(name)}
                              onChange={(e) => name && setSecretLocalValue(name, e.target.value)}
                            />
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={() => void removeSecret(idx)}
                              className="h-7 w-7 cursor-pointer p-0 text-muted-foreground/60 opacity-0 transition-opacity hover:text-destructive group-hover/row:opacity-100"
                              title="Remove secret"
                              aria-label="Remove secret"
                            >
                              <XIcon className="size-3.5" strokeWidth={1.75} aria-hidden="true" />
                            </Button>
                          </div>
                        ))}
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={addSecret}
                          className="mt-1 w-full cursor-pointer gap-1.5 border-dashed text-muted-foreground hover:text-foreground"
                        >
                          <PlusIcon className="size-3.5" strokeWidth={1.75} aria-hidden="true" />
                          Add secret
                        </Button>
                      </div>
                    </section>
                  </div>
                )}
              </ScrollArea>
            </div>
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}
