import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { AuthFieldProps } from "./shared";

export function AwsSigV4Fields({ value, onChange, idPrefix }: AuthFieldProps) {
  if (value.kind !== "awsSigV4") return null;

  return (
    <div className="grid w-full grid-cols-[120px_1fr] items-center gap-x-3 gap-y-2">
      <Label htmlFor={`${idPrefix}-aws-access-key`} className="font-medium text-xs">
        Access Key ID
      </Label>
      <Input
        id={`${idPrefix}-aws-access-key`}
        value={value.accessKeyId}
        onChange={(e) => onChange({ ...value, accessKeyId: e.target.value })}
        className="font-mono text-xs"
        placeholder="AKIA…"
      />
      <Label htmlFor={`${idPrefix}-aws-secret-key`} className="font-medium text-xs">
        Secret Key
      </Label>
      <Input
        id={`${idPrefix}-aws-secret-key`}
        type="password"
        value={value.secretAccessKey}
        onChange={(e) => onChange({ ...value, secretAccessKey: e.target.value })}
        className="font-mono text-xs"
      />
      <Label htmlFor={`${idPrefix}-aws-session`} className="font-medium text-xs">
        Session Token
      </Label>
      <Input
        id={`${idPrefix}-aws-session`}
        type="password"
        value={value.sessionToken ?? ""}
        onChange={(e) => onChange({ ...value, sessionToken: e.target.value || null })}
        className="font-mono text-xs"
        placeholder="(optional, for STS)"
      />
      <Label htmlFor={`${idPrefix}-aws-region`} className="font-medium text-xs">
        Region
      </Label>
      <Input
        id={`${idPrefix}-aws-region`}
        value={value.region}
        onChange={(e) => onChange({ ...value, region: e.target.value })}
        className="font-mono text-xs"
        placeholder="us-east-1"
      />
      <Label htmlFor={`${idPrefix}-aws-service`} className="font-medium text-xs">
        Service
      </Label>
      <Input
        id={`${idPrefix}-aws-service`}
        value={value.service}
        onChange={(e) => onChange({ ...value, service: e.target.value })}
        className="font-mono text-xs"
        placeholder="execute-api"
      />
    </div>
  );
}
