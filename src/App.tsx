import { useEffect } from "react";
import { AppShell } from "@/components/layout/app-shell";
import { WelcomeDialog } from "@/components/welcome/welcome-dialog";
import { useTheme } from "@/stores/theme-store";

export default function App() {
  // Mount-time theme bootstrap. `init()` attaches a `matchMedia` listener so
  // changing the OS appearance updates Lancer live when the user has picked
  // "System". Without this, theme="system" only ever resolves once.
  useEffect(() => {
    useTheme.getState().init();
  }, []);

  return (
    <>
      <AppShell />
      <WelcomeDialog />
    </>
  );
}
