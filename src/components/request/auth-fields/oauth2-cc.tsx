import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { AuthFieldProps } from "./shared";

export function OAuth2CcFields({ value, onChange, idPrefix }: AuthFieldProps) {
  if (value.kind !== "oAuth2Cc") return null;

  return (
    <div className="grid w-full grid-cols-[120px_1fr] items-center gap-x-3 gap-y-2">
      <Label htmlFor={`${idPrefix}-oauth2-token-url`} className="font-medium text-xs">
        Token URL
      </Label>
      <Input
        id={`${idPrefix}-oauth2-token-url`}
        value={value.tokenUrl}
        onChange={(e) => onChange({ ...value, tokenUrl: e.target.value })}
        className="font-mono text-xs"
        placeholder="https://auth.example.com/oauth/token"
      />
      <Label htmlFor={`${idPrefix}-oauth2-client-id`} className="font-medium text-xs">
        Client ID
      </Label>
      <Input
        id={`${idPrefix}-oauth2-client-id`}
        value={value.clientId}
        onChange={(e) => onChange({ ...value, clientId: e.target.value })}
        className="font-mono text-xs"
      />
      <Label htmlFor={`${idPrefix}-oauth2-client-secret`} className="font-medium text-xs">
        Client Secret
      </Label>
      <Input
        id={`${idPrefix}-oauth2-client-secret`}
        type="password"
        value={value.clientSecret}
        onChange={(e) => onChange({ ...value, clientSecret: e.target.value })}
        className="font-mono text-xs"
      />
      <Label htmlFor={`${idPrefix}-oauth2-scope`} className="font-medium text-xs">
        Scope
      </Label>
      <Input
        id={`${idPrefix}-oauth2-scope`}
        value={value.scope}
        onChange={(e) => onChange({ ...value, scope: e.target.value })}
        className="font-mono text-xs"
        placeholder="read:users write:users"
      />
      <Label htmlFor={`${idPrefix}-oauth2-audience`} className="font-medium text-xs">
        Audience
      </Label>
      <Input
        id={`${idPrefix}-oauth2-audience`}
        value={value.audience}
        onChange={(e) => onChange({ ...value, audience: e.target.value })}
        className="font-mono text-xs"
        placeholder="(optional)"
      />
    </div>
  );
}
