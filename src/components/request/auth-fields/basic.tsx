import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useRequest } from "@/stores/request-store";

export function BasicFields() {
  const auth = useRequest((s) => s.auth);
  const setAuth = useRequest((s) => s.setAuth);

  if (auth.kind !== "basic") return null;

  return (
    <div className="grid max-w-md grid-cols-[100px_1fr] items-center gap-2">
      <Label htmlFor="basic-username" className="text-xs">
        Username
      </Label>
      <Input
        id="basic-username"
        value={auth.username}
        onChange={(e) => setAuth({ ...auth, username: e.target.value })}
        className="font-mono text-xs"
      />
      <Label htmlFor="basic-password" className="text-xs">
        Password
      </Label>
      <Input
        id="basic-password"
        type="password"
        value={auth.password}
        onChange={(e) => setAuth({ ...auth, password: e.target.value })}
        className="font-mono text-xs"
      />
    </div>
  );
}
