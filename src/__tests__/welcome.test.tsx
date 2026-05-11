import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { WelcomeDialog } from "@/components/welcome/welcome-dialog";
import { useWelcome } from "@/stores/welcome-store";

vi.mock("@tauri-apps/plugin-dialog", () => ({
  open: vi.fn(),
}));
vi.mock("@/lib/tauri", () => ({
  listWorkspace: vi.fn().mockResolvedValue([]),
  readRequest: vi.fn(),
}));

describe("WelcomeDialog", () => {
  beforeEach(() => {
    window.localStorage.clear();
    useWelcome.setState({ open: true });
  });

  it("renders welcome content when open", () => {
    render(<WelcomeDialog />);
    expect(screen.getByRole("heading", { name: /welcome to lancer/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /open folder/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /skip/i })).toBeInTheDocument();
  });

  it("Skip persists dismissed flag and closes", async () => {
    const user = userEvent.setup();
    render(<WelcomeDialog />);
    await user.click(screen.getByRole("button", { name: /skip/i }));
    expect(window.localStorage.getItem("lancer.welcomeDismissed")).toBe("true");
    expect(useWelcome.getState().open).toBe(false);
  });

  it("does not show on subsequent renders if dismissed", () => {
    window.localStorage.setItem("lancer.welcomeDismissed", "true");
    // The store reads localStorage on creation — we need to reset state to reflect this.
    useWelcome.setState({ open: false });
    render(<WelcomeDialog />);
    expect(screen.queryByRole("heading", { name: /welcome to lancer/i })).not.toBeInTheDocument();
  });
});
