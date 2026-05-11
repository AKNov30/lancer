import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useRequest } from "@/stores/request-store";

export function AwsSigV4Fields() {
  const auth = useRequest((s) => s.auth);
  const setAuth = useRequest((s) => s.setAuth);

  if (auth.kind !== "awsSigV4") return null;

  return (
    <div className="grid max-w-xl grid-cols-[140px_1fr] items-center gap-2">
      <Label htmlFor="aws-access-key" className="text-xs">
        Access Key ID
      </Label>
      <Input
        id="aws-access-key"
        value={auth.accessKeyId}
        onChange={(e) => setAuth({ ...auth, accessKeyId: e.target.value })}
        className="font-mono text-xs"
      />
      <Label htmlFor="aws-secret-key" className="text-xs">
        Secret Key
      </Label>
      <Input
        id="aws-secret-key"
        type="password"
        value={auth.secretAccessKey}
        onChange={(e) => setAuth({ ...auth, secretAccessKey: e.target.value })}
        className="font-mono text-xs"
      />
      <Label htmlFor="aws-session" className="text-xs">
        Session Token
      </Label>
      <Input
        id="aws-session"
        type="password"
        value={auth.sessionToken ?? ""}
        onChange={(e) => setAuth({ ...auth, sessionToken: e.target.value || null })}
        className="font-mono text-xs"
        placeholder="(optional, for STS)"
      />
      <Label htmlFor="aws-region" className="text-xs">
        Region
      </Label>
      <Input
        id="aws-region"
        value={auth.region}
        onChange={(e) => setAuth({ ...auth, region: e.target.value })}
        className="font-mono text-xs"
        placeholder="us-east-1"
      />
      <Label htmlFor="aws-service" className="text-xs">
        Service
      </Label>
      <Input
        id="aws-service"
        value={auth.service}
        onChange={(e) => setAuth({ ...auth, service: e.target.value })}
        className="font-mono text-xs"
        placeholder="execute-api"
      />
    </div>
  );
}
