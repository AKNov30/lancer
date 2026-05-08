import { useState } from "react";
import { invoke } from "@tauri-apps/api/core";

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
        onClick={async () =>
          setMsg(await invoke<string>("greet", { name: "Lancer" }))
        }
      >
        Ping Rust
      </button>
      {msg && <pre style={{ fontFamily: "ui-monospace, monospace" }}>{msg}</pre>}
    </main>
  );
}
