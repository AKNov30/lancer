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
import { Separator } from "@/components/ui/separator";
import {
  Sheet,
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
  setSecret,
  writeEnv,
} from "@/lib/tauri";
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
  const [error, setError] = useState<string | null>(null);
  const [newEnvName, setNewEnvName] = useState("");

  // Load env list when sheet opens or rootPath changes
  useEffect(() => {
    if (!open || !rootPath) return;
    listEnvs(rootPath)
      .then(setEnvs)
      .catch((e: unknown) => setError(String(e)));
  }, [open, rootPath]);

  // Load selected env
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
      })
      .catch((e: unknown) => setError(String(e)));
  }, [rootPath, selected]);

  async function fetchSecret(name: string) {
    if (!rootPath || !selected) return;
    if (secretValues[name] !== undefined) return; // already fetched
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
    if (!env || !rootPath || !selected) return;
    setError(null);
    try {
      // Write env file (vars + secret_names) first, then secrets
      await writeEnv(rootPath, env);
      for (const name of env.secretNames) {
        const v = secretValues[name];
        if (v !== undefined && v !== "") {
          await setSecret(rootPath, selected, name, v);
        }
      }
      setDirty(false);
      await refreshEnvStore(rootPath);
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
      <SheetContent side="right" className="w-[640px] sm:max-w-[640px]">
        <SheetHeader>
          <SheetTitle>Environments</SheetTitle>
          <SheetDescription>
            Manage variables and secrets per environment. Secrets live in your OS keyring; vars
            commit to <code>environments/</code>.
          </SheetDescription>
        </SheetHeader>

        {error && (
          <div className="mt-2 rounded-md border border-destructive/40 bg-destructive/10 p-2 text-xs text-destructive">
            {error}
          </div>
        )}

        {!rootPath ? (
          <div className="mt-6 text-sm text-muted-foreground">Open a folder first.</div>
        ) : (
          <div className="mt-4 grid grid-cols-[180px_1fr] gap-3">
            {/* Left: env list */}
            <div className="flex flex-col gap-1 border-r border-border pr-2">
              {envs.map((n) => (
                <button
                  key={n}
                  type="button"
                  className={`rounded-sm px-2 py-1 text-left text-xs hover:bg-accent ${
                    selected === n ? "bg-accent" : ""
                  }`}
                  onClick={() => setSelected(n)}
                >
                  {n}
                </button>
              ))}
              <Separator className="my-2" />
              <div className="flex gap-1">
                <Input
                  className="h-7 flex-1 text-xs"
                  placeholder="new env name"
                  value={newEnvName}
                  onChange={(e) => setNewEnvName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") void createNewEnv();
                  }}
                />
                <Button size="sm" onClick={() => void createNewEnv()} disabled={!newEnvName.trim()}>
                  +
                </Button>
              </div>
            </div>

            {/* Right: editor */}
            <ScrollArea className="h-[calc(100vh-220px)]">
              {!env ? (
                <div className="p-3 text-sm text-muted-foreground">Pick an env on the left.</div>
              ) : (
                <div className="space-y-4 pr-2">
                  <div className="flex items-center justify-between">
                    <h3 className="font-mono text-sm">{env.name}</h3>
                    <div className="flex gap-2">
                      <Button size="sm" onClick={() => void save()} disabled={!dirty}>
                        Save
                      </Button>
                      <AlertDialog>
                        <AlertDialogTrigger asChild>
                          <Button size="sm" variant="destructive">
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
                            <AlertDialogAction onClick={() => void handleDeleteEnv()}>
                              Delete
                            </AlertDialogAction>
                          </AlertDialogFooter>
                        </AlertDialogContent>
                      </AlertDialog>
                    </div>
                  </div>

                  {/* Variables */}
                  <div>
                    <Label className="text-xs">Variables</Label>
                    <div className="mt-1 space-y-1">
                      {env.vars.map(([k, v], idx) => (
                        // biome-ignore lint/suspicious/noArrayIndexKey: vars have no stable id; idx is the identity
                        <div key={idx} className="grid grid-cols-[1fr_1fr_28px] gap-1">
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
                          <Button size="sm" variant="ghost" onClick={() => removeVar(idx)}>
                            ×
                          </Button>
                        </div>
                      ))}
                      <Button size="sm" variant="ghost" onClick={addVar}>
                        + Add var
                      </Button>
                    </div>
                  </div>

                  {/* Secrets */}
                  <div>
                    <Label className="text-xs">
                      Secrets <span className="text-muted-foreground">(stored in OS keyring)</span>
                    </Label>
                    <div className="mt-1 space-y-1">
                      {env.secretNames.map((name, idx) => (
                        // biome-ignore lint/suspicious/noArrayIndexKey: secretNames have no stable id; idx is the identity
                        <div key={idx} className="grid grid-cols-[1fr_1fr_28px] gap-1">
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
                          <Button size="sm" variant="ghost" onClick={() => void removeSecret(idx)}>
                            ×
                          </Button>
                        </div>
                      ))}
                      <Button size="sm" variant="ghost" onClick={addSecret}>
                        + Add secret
                      </Button>
                    </div>
                  </div>
                </div>
              )}
            </ScrollArea>
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}
