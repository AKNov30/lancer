import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type { Auth } from "@/lib/types";
import { useRequest } from "@/stores/request-store";
import { ApiKeyFields } from "./auth-fields/api-key";
import { AwsSigV4Fields } from "./auth-fields/aws-sigv4";
import { BasicFields } from "./auth-fields/basic";
import { BearerFields } from "./auth-fields/bearer";
import { OAuth2CcFields } from "./auth-fields/oauth2-cc";

type AuthKind = Auth["kind"];

const EMPTY: Record<AuthKind, Auth> = {
  none: { kind: "none" },
  bearer: { kind: "bearer", token: "" },
  basic: { kind: "basic", username: "", password: "" },
  apiKey: { kind: "apiKey", key: "", value: "", in: "header" },
  oAuth2Cc: {
    kind: "oAuth2Cc",
    tokenUrl: "",
    clientId: "",
    clientSecret: "",
    scope: "",
    audience: "",
  },
  awsSigV4: {
    kind: "awsSigV4",
    accessKeyId: "",
    secretAccessKey: "",
    sessionToken: "",
    region: "",
    service: "",
  },
};

export function AuthPanel() {
  const auth = useRequest((s) => s.auth);
  const setAuth = useRequest((s) => s.setAuth);

  return (
    <Tabs
      value={auth.kind}
      onValueChange={(v) => setAuth(EMPTY[v as AuthKind])}
      className="flex flex-col border-border border-b bg-card"
    >
      <TabsList className="h-9 w-full justify-start rounded-none px-2">
        <TabsTrigger value="none">None</TabsTrigger>
        <TabsTrigger value="bearer">Bearer</TabsTrigger>
        <TabsTrigger value="basic">Basic</TabsTrigger>
        <TabsTrigger value="apiKey">API Key</TabsTrigger>
        <TabsTrigger value="oAuth2Cc">OAuth 2</TabsTrigger>
        <TabsTrigger value="awsSigV4">AWS</TabsTrigger>
      </TabsList>
      <TabsContent value="none" className="p-3 text-muted-foreground text-xs">
        No authentication will be applied.
      </TabsContent>
      <TabsContent value="bearer" className="p-3">
        <BearerFields />
      </TabsContent>
      <TabsContent value="basic" className="p-3">
        <BasicFields />
      </TabsContent>
      <TabsContent value="apiKey" className="p-3">
        <ApiKeyFields />
      </TabsContent>
      <TabsContent value="oAuth2Cc" className="p-3">
        <OAuth2CcFields />
      </TabsContent>
      <TabsContent value="awsSigV4" className="p-3">
        <AwsSigV4Fields />
      </TabsContent>
    </Tabs>
  );
}
