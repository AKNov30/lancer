import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useRequest } from "@/stores/request-store";

export function ApiKeyFields() {
  const auth = useRequest((s) => s.auth);
  const setAuth = useRequest((s) => s.setAuth);

  if (auth.kind !== "apiKey") return null;

  return (
    <div className="grid max-w-md grid-cols-[100px_1fr] items-center gap-2">
      <Label htmlFor="apikey-key" className="text-xs">
        Key
      </Label>
      <Input
        id="apikey-key"
        value={auth.key}
        onChange={(e) => setAuth({ ...auth, key: e.target.value })}
        className="font-mono text-xs"
        placeholder="X-Api-Key"
      />
      <Label htmlFor="apikey-value" className="text-xs">
        Value
      </Label>
      <Input
        id="apikey-value"
        value={auth.value}
        onChange={(e) => setAuth({ ...auth, value: e.target.value })}
        className="font-mono text-xs"
      />
      <Label htmlFor="apikey-in" className="text-xs">
        Send in
      </Label>
      <Select value={auth.in} onValueChange={(v) => setAuth({ ...auth, in: v })}>
        <SelectTrigger id="apikey-in" className="text-xs">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="header">Header</SelectItem>
          <SelectItem value="query">Query</SelectItem>
        </SelectContent>
      </Select>
    </div>
  );
}
