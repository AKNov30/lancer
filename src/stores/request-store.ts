import { create } from "zustand";
import type { Auth, HttpRequest, HttpResponse, Method } from "@/lib/types";

interface RequestState {
  request: HttpRequest;
  auth: Auth;
  response: HttpResponse | null;
  loading: boolean;
  error: string | null;
  setUrl: (url: string) => void;
  setMethod: (method: Method) => void;
  setAuth: (auth: Auth) => void;
  setResponse: (resp: HttpResponse | null) => void;
  setLoading: (b: boolean) => void;
  setError: (e: string | null) => void;
}

export const useRequest = create<RequestState>((set) => ({
  request: { url: "", method: "GET", headers: [], query: [] },
  auth: { kind: "none" },
  response: null,
  loading: false,
  error: null,
  setUrl: (url) => set((s) => ({ request: { ...s.request, url } })),
  setMethod: (method) => set((s) => ({ request: { ...s.request, method } })),
  setAuth: (auth) => set({ auth }),
  setResponse: (response) => set({ response }),
  setLoading: (loading) => set({ loading }),
  setError: (error) => set({ error }),
}));
