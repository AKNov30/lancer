import type { ReactNode } from "react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type { Auth } from "@/lib/types";
import { ApiKeyFields } from "./api-key";
import { AwsSigV4Fields } from "./aws-sigv4";
import { BasicFields } from "./basic";
import { BearerFields } from "./bearer";
import { OAuth2CcFields } from "./oauth2-cc";
import { AUTH_TABS, type AuthKind, EMPTY } from "./shared";

/**
 * Shared, fully controlled Authorization editor. Renders the kind tabs plus the
 * matching field group, driven entirely by `value`/`onChange`. The request
 * `AuthPanel` (per-tab auth) and the `CollectionAuthEditor` (per-folder default
 * auth) both consume this — the field groups live in one place instead of being
 * re-implemented per surface.
 *
 * - `idPrefix` keeps element `id`/`htmlFor` pairs unique between the two surfaces.
 * - `noneState` is the empty-state content for the "None" tab, which differs in
 *   copy between the request and folder editors.
 */
export function AuthEditor({
  value,
  onChange,
  idPrefix,
  noneState,
}: {
  value: Auth;
  onChange: (auth: Auth) => void;
  idPrefix: string;
  noneState: ReactNode;
}) {
  const fieldProps = { value, onChange, idPrefix } as const;
  return (
    <Tabs
      value={value.kind}
      onValueChange={(v) => onChange(EMPTY[v as AuthKind])}
      className="flex h-full flex-col"
    >
      <div className="border-border/40 border-b">
        <div className="overflow-x-auto">
          <TabsList variant="line" className="h-8 w-max min-w-full justify-start px-3">
            {AUTH_TABS.map((t) => (
              <TabsTrigger key={t.value} value={t.value} className="cursor-pointer text-xs">
                {t.label}
              </TabsTrigger>
            ))}
          </TabsList>
        </div>
      </div>
      <div className="flex min-h-0 flex-1 overflow-y-auto p-3">
        <TabsContent
          value="none"
          className="flex flex-1 flex-col items-center justify-center gap-2 text-center"
        >
          {noneState}
        </TabsContent>
        <TabsContent value="bearer">
          <BearerFields {...fieldProps} />
        </TabsContent>
        <TabsContent value="basic">
          <BasicFields {...fieldProps} />
        </TabsContent>
        <TabsContent value="apiKey">
          <ApiKeyFields {...fieldProps} />
        </TabsContent>
        <TabsContent value="oAuth2Cc">
          <OAuth2CcFields {...fieldProps} />
        </TabsContent>
        <TabsContent value="awsSigV4">
          <AwsSigV4Fields {...fieldProps} />
        </TabsContent>
      </div>
    </Tabs>
  );
}
