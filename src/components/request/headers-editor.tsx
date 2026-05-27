import { KvTable } from "@/components/ui/kv-table";
import { useRequest } from "@/stores/request-store";

export function HeadersEditor() {
  const headers = useRequest((s) => s.request.headers);
  const setHeaders = useRequest((s) => s.setHeaders);

  return (
    <div className="flex h-full flex-col overflow-y-auto p-3">
      <KvTable
        rows={headers}
        onChange={setHeaders}
        keyPlaceholder="X-Custom-Header"
        valuePlaceholder="value"
        hint="Headers are added in order. Common headers (Host, Content-Length, User-Agent) are added automatically when missing."
      />
    </div>
  );
}
