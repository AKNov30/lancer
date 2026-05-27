import {
  BracesIcon,
  FileCode2Icon,
  KeyIcon,
  KeyRoundIcon,
  ListIcon,
  NetworkIcon,
  SettingsIcon,
  SquareCodeIcon,
} from "lucide-react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useRequest } from "@/stores/request-store";
import { AuthPanel } from "./auth-panel";
import { BodyEditor } from "./body-editor";
import { CapturesEditor } from "./captures-editor";
import { HeadersEditor } from "./headers-editor";
import { ParamsEditor } from "./params-editor";
import { RequestSettings } from "./request-settings";
import { ScriptsEditor } from "./scripts-editor";
import { VarsEditor } from "./vars-editor";

/**
 * Postman-style tabbed editor for the currently active request.
 * Tabs: Params · Headers · Body (placeholder) · Auth.
 *
 * Tab labels include live counts so the user can see at a glance which
 * sections carry data.
 */
export function RequestEditor() {
  const queryCount = useRequest((s) => s.request.query.filter((r) => r.enabled).length);
  const headerCount = useRequest((s) => s.request.headers.filter((r) => r.enabled).length);
  const bodyKind = useRequest((s) => s.request.body.kind);
  const options = useRequest((s) => s.request.options);
  const captures = useRequest((s) => s.request.captures);
  const captureCount = captures.filter((c) => c.enabled).length;
  const vars = useRequest((s) => s.request.vars);
  const varCount = vars.filter((v) => v.enabled && v.key.trim()).length;
  const hasScripts = useRequest(
    (s) =>
      Boolean(s.request.preRequestScript?.trim()) || Boolean(s.request.postResponseScript?.trim()),
  );
  const authKind = useRequest((s) => s.auth.kind);
  const hasAuth = authKind !== "none";
  const hasBody = bodyKind !== "none";
  const hasCustomOptions =
    options.timeoutMs != null ||
    options.followRedirects != null ||
    options.maxRedirects != null ||
    options.insecureSkipVerify != null;

  return (
    <Tabs defaultValue="params" className="flex h-full min-h-0 flex-col">
      <TabsList
        variant="line"
        className="h-9 shrink-0 rounded-none border-border border-b bg-card px-3"
      >
        <TabsTrigger value="params" className="cursor-pointer gap-1.5">
          <ListIcon className="size-3.5" strokeWidth={1.75} aria-hidden="true" />
          Params
          {queryCount > 0 && (
            <span className="ml-1 rounded-sm bg-primary/15 px-1 nums-tabular text-[10px] text-primary">
              {queryCount}
            </span>
          )}
        </TabsTrigger>
        <TabsTrigger value="headers" className="cursor-pointer gap-1.5">
          <NetworkIcon className="size-3.5" strokeWidth={1.75} aria-hidden="true" />
          Headers
          {headerCount > 0 && (
            <span className="ml-1 rounded-sm bg-primary/15 px-1 nums-tabular text-[10px] text-primary">
              {headerCount}
            </span>
          )}
        </TabsTrigger>
        <TabsTrigger value="body" className="cursor-pointer gap-1.5">
          <SquareCodeIcon className="size-3.5" strokeWidth={1.75} aria-hidden="true" />
          Body
          {hasBody && (
            <span
              aria-hidden="true"
              className="ml-1 size-1.5 rounded-full bg-[color:var(--color-info)]"
              title={`Body: ${bodyKind}`}
            />
          )}
        </TabsTrigger>
        <TabsTrigger value="auth" className="cursor-pointer gap-1.5">
          <KeyRoundIcon className="size-3.5" strokeWidth={1.75} aria-hidden="true" />
          Auth
          {hasAuth && (
            <span
              aria-hidden="true"
              className="ml-1 size-1.5 rounded-full bg-[color:var(--color-success)]"
              title={`Active: ${authKind}`}
            />
          )}
        </TabsTrigger>
        <TabsTrigger value="vars" className="cursor-pointer gap-1.5">
          <BracesIcon className="size-3.5" strokeWidth={1.75} aria-hidden="true" />
          Vars
          {varCount > 0 && (
            <span className="ml-1 rounded-sm bg-primary/15 px-1 nums-tabular text-[10px] text-primary">
              {varCount}
            </span>
          )}
        </TabsTrigger>
        <TabsTrigger value="captures" className="cursor-pointer gap-1.5">
          <KeyIcon className="size-3.5" strokeWidth={1.75} aria-hidden="true" />
          Captures
          {captureCount > 0 && (
            <span className="ml-1 rounded-sm bg-primary/15 px-1 nums-tabular text-[10px] text-primary">
              {captureCount}
            </span>
          )}
        </TabsTrigger>
        <TabsTrigger value="scripts" className="cursor-pointer gap-1.5">
          <FileCode2Icon className="size-3.5" strokeWidth={1.75} aria-hidden="true" />
          Scripts
          {hasScripts && (
            <span
              aria-hidden="true"
              className="ml-1 size-1.5 rounded-full bg-[color:var(--color-info)]"
              title="Pre-request / post-response script present"
            />
          )}
        </TabsTrigger>
        <TabsTrigger value="settings" className="cursor-pointer gap-1.5">
          <SettingsIcon className="size-3.5" strokeWidth={1.75} aria-hidden="true" />
          Settings
          {hasCustomOptions && (
            <span
              aria-hidden="true"
              className={`ml-1 size-1.5 rounded-full ${
                options.insecureSkipVerify
                  ? "bg-[color:var(--color-destructive)]"
                  : "bg-[color:var(--color-warning)]"
              }`}
              title="Custom request settings active"
            />
          )}
        </TabsTrigger>
      </TabsList>

      <TabsContent value="params" className="flex-1 overflow-hidden focus-visible:outline-none">
        <ParamsEditor />
      </TabsContent>

      <TabsContent value="headers" className="flex-1 overflow-hidden focus-visible:outline-none">
        <HeadersEditor />
      </TabsContent>

      <TabsContent value="body" className="flex-1 overflow-hidden focus-visible:outline-none">
        <BodyEditor />
      </TabsContent>

      <TabsContent value="auth" className="flex-1 overflow-hidden focus-visible:outline-none">
        <AuthPanel />
      </TabsContent>

      <TabsContent value="vars" className="flex-1 overflow-auto focus-visible:outline-none">
        <VarsEditor />
      </TabsContent>

      <TabsContent value="captures" className="flex-1 overflow-auto focus-visible:outline-none">
        <CapturesEditor />
      </TabsContent>

      <TabsContent value="scripts" className="flex-1 overflow-hidden focus-visible:outline-none">
        <ScriptsEditor />
      </TabsContent>

      <TabsContent value="settings" className="flex-1 overflow-hidden focus-visible:outline-none">
        <RequestSettings />
      </TabsContent>
    </Tabs>
  );
}
