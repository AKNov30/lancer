import { useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Button } from "@/components/ui/button";

export default function App() {
  const [msg, setMsg] = useState<string | null>(null);
  return (
    <main className="h-full flex flex-col items-center justify-center gap-4 p-6">
      <h1 className="font-display italic text-4xl">Lancer</h1>
      <p className="text-sm text-muted-foreground">Send requests fast.</p>
      <Button
        onClick={async () => {
          try {
            setMsg(await invoke<string>("greet", { name: "Lancer" }));
          } catch (e) {
            setMsg(`error: ${String(e)}`);
          }
        }}
      >
        Ping Rust
      </Button>
      {msg && (
        <pre className="font-mono text-xs text-muted-foreground">{msg}</pre>
      )}
    </main>
  );
}
