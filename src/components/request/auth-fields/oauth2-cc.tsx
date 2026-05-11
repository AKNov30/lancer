import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useRequest } from "@/stores/request-store";

export function OAuth2CcFields() {
  const auth = useRequest((s) => s.auth);
  const setAuth = useRequest((s) => s.setAuth);

  if (auth.kind !== "oAuth2Cc") return null;

  return (
    <div className="grid max-w-xl grid-cols-[120px_1fr] items-center gap-2">
      <Label htmlFor="oauth2-token-url" className="text-xs">
        Token URL
      </Label>
      <Input
        id="oauth2-token-url"
        value={auth.tokenUrl}
        onChange={(e) => setAuth({ ...auth, tokenUrl: e.target.value })}
        className="font-mono text-xs"
        placeholder="https://auth.example.com/oauth/token"
      />
      <Label htmlFor="oauth2-client-id" className="text-xs">
        Client ID
      </Label>
      <Input
        id="oauth2-client-id"
        value={auth.clientId}
        onChange={(e) => setAuth({ ...auth, clientId: e.target.value })}
        className="font-mono text-xs"
      />
      <Label htmlFor="oauth2-client-secret" className="text-xs">
        Client Secret
      </Label>
      <Input
        id="oauth2-client-secret"
        type="password"
        value={auth.clientSecret}
        onChange={(e) => setAuth({ ...auth, clientSecret: e.target.value })}
        className="font-mono text-xs"
      />
      <Label htmlFor="oauth2-scope" className="text-xs">
        Scope
      </Label>
      <Input
        id="oauth2-scope"
        value={auth.scope}
        onChange={(e) => setAuth({ ...auth, scope: e.target.value })}
        className="font-mono text-xs"
        placeholder="read:users write:users"
      />
      <Label htmlFor="oauth2-audience" className="text-xs">
        Audience
      </Label>
      <Input
        id="oauth2-audience"
        value={auth.audience}
        onChange={(e) => setAuth({ ...auth, audience: e.target.value })}
        className="font-mono text-xs"
        placeholder="(optional)"
      />
    </div>
  );
}
