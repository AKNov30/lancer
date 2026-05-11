import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { sendRequest } from "@/lib/tauri";
import { useRequest } from "@/stores/request-store";
import { MethodSelect } from "./method-select";

export function UrlBar() {
  const request = useRequest((s) => s.request);
  const auth = useRequest((s) => s.auth);
  const loading = useRequest((s) => s.loading);
  const setUrl = useRequest((s) => s.setUrl);
  const setMethod = useRequest((s) => s.setMethod);
  const setResponse = useRequest((s) => s.setResponse);
  const setLoading = useRequest((s) => s.setLoading);
  const setError = useRequest((s) => s.setError);

  async function onSend() {
    if (!request.url) return;
    setError(null);
    setLoading(true);
    try {
      const resp = await sendRequest(request, auth);
      setResponse(resp);
    } catch (e) {
      setError(String(e));
      setResponse(null);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex items-center gap-2 border-border border-b bg-card px-3 py-2">
      <MethodSelect value={request.method} onChange={setMethod} />
      <Input
        value={request.url}
        onChange={(e) => setUrl(e.target.value)}
        placeholder="https://api.example.com/v1/users"
        className="font-mono"
        onKeyDown={(e) => {
          if (e.key === "Enter") onSend();
        }}
      />
      <Button onClick={onSend} disabled={loading || !request.url}>
        {loading ? "Sending…" : "Send"}
      </Button>
    </div>
  );
}
