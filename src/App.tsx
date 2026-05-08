import { useState } from "react";
import { invoke } from "@tauri-apps/api/core";
// TODO(M1.2): replace inline styles with Tailwind + shadcn primitives

export default function App() {
  const [msg, setMsg] = useState<string | null>(null);
  return (
    <main
      style={{
        height: "100%",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: 16,
        padding: 24,
      }}
    >
      <h1 style={{ margin: 0 }}>Lancer</h1>
      <p style={{ margin: 0, opacity: 0.7 }}>Send requests fast.</p>
      <button
        onClick={async () => {
          try {
            setMsg(await invoke<string>("greet", { name: "Lancer" }));
          } catch (e) {
            setMsg(`error: ${String(e)}`);
          }
        }}
      >
        Ping Rust
      </button>
      {msg && <pre style={{ fontFamily: "ui-monospace, monospace" }}>{msg}</pre>}
    </main>
  );
}
