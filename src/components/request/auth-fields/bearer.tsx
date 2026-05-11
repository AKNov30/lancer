import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useRequest } from "@/stores/request-store";

export function BearerFields() {
  const auth = useRequest((s) => s.auth);
  const setAuth = useRequest((s) => s.setAuth);

  if (auth.kind !== "bearer") return null;

  return (
    <div className="grid max-w-md grid-cols-[100px_1fr] items-center gap-2">
      <Label htmlFor="bearer-token" className="text-xs">
        Token
      </Label>
      <Input
        id="bearer-token"
        value={auth.token}
        onChange={(e) => setAuth({ kind: "bearer", token: e.target.value })}
        className="font-mono text-xs"
        placeholder="ey…"
      />
    </div>
  );
}
