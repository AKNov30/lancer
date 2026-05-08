import { invoke } from "@tauri-apps/api/core";
import type { HttpRequest, HttpResponse } from "@/lib/types";

export async function sendRequest(req: HttpRequest): Promise<HttpResponse> {
  return invoke<HttpResponse>("send_request", { req });
}
