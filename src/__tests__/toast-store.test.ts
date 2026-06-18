import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { toast, useToasts } from "@/stores/toast-store";

describe("toast-store", () => {
  beforeEach(() => {
    useToasts.setState({ toasts: [] });
    vi.useRealTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("adds a success toast with the given message", () => {
    toast.success("Saved");
    const { toasts } = useToasts.getState();
    expect(toasts).toHaveLength(1);
    expect(toasts[0]).toMatchObject({ variant: "success", message: "Saved" });
  });

  it("carries the description from error options", () => {
    toast.error("Boom", { description: "disk full" });
    const t = useToasts.getState().toasts[0];
    expect(t.variant).toBe("error");
    expect(t.description).toBe("disk full");
  });

  it("assigns a unique, increasing id per toast and returns it", () => {
    const a = toast.info("a");
    const b = toast.info("b");
    expect(b).toBeGreaterThan(a);
    const ids = useToasts.getState().toasts.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("dismiss removes only the targeted toast", () => {
    const a = toast.info("a");
    toast.info("b");
    toast.dismiss(a);
    const { toasts } = useToasts.getState();
    expect(toasts).toHaveLength(1);
    expect(toasts[0].message).toBe("b");
  });

  it("clear removes every toast", () => {
    toast.success("a");
    toast.error("b");
    useToasts.getState().clear();
    expect(useToasts.getState().toasts).toHaveLength(0);
  });

  it("defaults errors to a longer duration than success", () => {
    const successId = toast.success("ok");
    const errorId = toast.error("bad");
    const byId = (id: number) => useToasts.getState().toasts.find((t) => t.id === id);
    const successDuration = byId(successId)?.duration ?? 0;
    const errorDuration = byId(errorId)?.duration ?? 0;
    expect(errorDuration).toBeGreaterThan(successDuration as number);
  });

  it("honors an explicit null duration (sticky toast)", () => {
    const id = toast.error("stay", { duration: null });
    expect(useToasts.getState().toasts.find((t) => t.id === id)?.duration).toBeNull();
  });
});
