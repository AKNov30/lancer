import { create } from "zustand";
import type { HttpRequest, HttpResponse, Method } from "@/lib/types";

interface RequestState {
  request: HttpRequest;
  response: HttpResponse | null;
  loading: boolean;
  error: string | null;
  setUrl: (url: string) => void;
  setMethod: (method: Method) => void;
  setResponse: (resp: HttpResponse | null) => void;
  setLoading: (b: boolean) => void;
  setError: (e: string | null) => void;
}

export const useRequest = create<RequestState>((set) => ({
  request: { url: "", method: "GET", headers: [], query: [] },
  response: null,
  loading: false,
  error: null,
  setUrl: (url) => set((s) => ({ request: { ...s.request, url } })),
  setMethod: (method) => set((s) => ({ request: { ...s.request, method } })),
  setResponse: (response) => set({ response }),
  setLoading: (loading) => set({ loading }),
  setError: (error) => set({ error }),
}));
