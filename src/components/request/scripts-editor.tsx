import { FlaskConicalIcon, PlayIcon } from "lucide-react";
import { CodeEditor } from "@/components/ui/code-editor";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useRequest } from "@/stores/request-store";

/**
 * Pre-request + post-response scripting editor. Two JavaScript editors, each
 * persisted to the `.bru` file as `script:pre-request` / `script:post-response`
 * blocks and executed by the Rust `boa_engine` sandbox at send time.
 *
 * The scripts get a small `lancer.*` API (env get/set, request/response,
 * test/expect). We document the surface inline so the user has a reference
 * without leaving the app — this is the "beat Postman" local scripting story.
 */
export function ScriptsEditor() {
  const preRequestScript = useRequest((s) => s.request.preRequestScript ?? "");
  const postResponseScript = useRequest((s) => s.request.postResponseScript ?? "");
  const setPreRequestScript = useRequest((s) => s.setPreRequestScript);
  const setPostResponseScript = useRequest((s) => s.setPostResponseScript);

  return (
    <Tabs defaultValue="pre" className="flex h-full min-h-0 flex-col">
      <div className="flex items-center justify-between gap-2 border-border/60 border-b bg-card/40 px-3 py-1.5">
        <TabsList variant="line" className="h-7 bg-transparent p-0">
          <TabsTrigger value="pre" className="cursor-pointer gap-1.5 text-xs">
            <PlayIcon className="size-3.5" strokeWidth={1.75} aria-hidden="true" />
            Pre-request
            {preRequestScript.trim() && (
              <span
                aria-hidden="true"
                className="ml-1 size-1.5 rounded-full bg-[color:var(--color-info)]"
                title="Pre-request script present"
              />
            )}
          </TabsTrigger>
          <TabsTrigger value="post" className="cursor-pointer gap-1.5 text-xs">
            <FlaskConicalIcon className="size-3.5" strokeWidth={1.75} aria-hidden="true" />
            Post-response
            {postResponseScript.trim() && (
              <span
                aria-hidden="true"
                className="ml-1 size-1.5 rounded-full bg-[color:var(--color-success)]"
                title="Post-response script present"
              />
            )}
          </TabsTrigger>
        </TabsList>
      </div>

      <TabsContent value="pre" className="flex min-h-0 flex-1 flex-col gap-2 p-3">
        <p className="text-muted-foreground text-xs leading-relaxed">
          Runs before the request is sent. Set variables with{" "}
          <code className="rounded-sm border border-border bg-card px-1 font-mono text-[11px]">
            lancer.env.set("token", "...")
          </code>{" "}
          and read the outgoing request via{" "}
          <code className="rounded-sm border border-border bg-card px-1 font-mono text-[11px]">
            lancer.request
          </code>
          .
        </p>
        <div className="min-h-0 flex-1">
          <CodeEditor
            value={preRequestScript}
            onChange={setPreRequestScript}
            language="javascript"
            minHeight="100%"
            className="h-full"
            placeholder={'// e.g.\nlancer.env.set("ts", String(Date.now()));'}
          />
        </div>
      </TabsContent>

      <TabsContent value="post" className="flex min-h-0 flex-1 flex-col gap-2 p-3">
        <p className="text-muted-foreground text-xs leading-relaxed">
          Runs after the response arrives. Assert with{" "}
          <code className="rounded-sm border border-border bg-card px-1 font-mono text-[11px]">
            lancer.test(name, fn)
          </code>{" "}
          and{" "}
          <code className="rounded-sm border border-border bg-card px-1 font-mono text-[11px]">
            expect(...)
          </code>
          ; read the response via{" "}
          <code className="rounded-sm border border-border bg-card px-1 font-mono text-[11px]">
            lancer.response
          </code>{" "}
          (<code className="font-mono">.status</code>, <code className="font-mono">.body</code>,{" "}
          <code className="font-mono">.json()</code>, <code className="font-mono">.headers</code>).
          Results show in the response <span className="font-medium">Tests</span> tab.
        </p>
        <div className="min-h-0 flex-1">
          <CodeEditor
            value={postResponseScript}
            onChange={setPostResponseScript}
            language="javascript"
            minHeight="100%"
            className="h-full"
            placeholder={
              '// e.g.\nlancer.test("status is 200", () => {\n  expect(lancer.response.status).toBe(200);\n});'
            }
          />
        </div>
      </TabsContent>
    </Tabs>
  );
}
