import type { SseEvent } from "@/types";
import { apiUrl } from "./api";

export function subscribeRun(runId: string, onEvent: (e: SseEvent) => void): () => void {
  const es = new EventSource(apiUrl(`runs/${runId}/events`));
  es.onmessage = (m) => {
    try {
      onEvent(JSON.parse(m.data));
    } catch {
      /* ignore malformed */
    }
  };
  es.onerror = () => {
    /* EventSource auto-reconnects; run.done closes the server stream */
  };
  return () => es.close();
}
