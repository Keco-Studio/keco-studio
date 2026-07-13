/**
 * Helpers to turn an SSEEvent async generator into a streaming Response.
 */

import type { SSEEvent } from './types';

const encoder = new TextEncoder();
const keepalive = encoder.encode(': keepalive\n\n');

export const DEFAULT_SSE_HEARTBEAT_INTERVAL_MS = 15_000;

function formatEvent(event: SSEEvent): Uint8Array {
  return encoder.encode(`data: ${JSON.stringify(event)}\n\n`);
}

/**
 * Build a text/event-stream Response from an SSEEvent generator. Errors thrown
 * by the generator are surfaced as a final `error` + `done` event pair.
 */
export function sseResponse(
  generator: AsyncGenerator<SSEEvent>,
  options: {
    abortController?: AbortController;
    heartbeatIntervalMs?: number;
  } = {}
): Response {
  const abortController = options.abortController ?? new AbortController();
  const heartbeatIntervalMs =
    options.heartbeatIntervalMs ?? DEFAULT_SSE_HEARTBEAT_INTERVAL_MS;
  let cancelled = false;
  let heartbeatTimer: ReturnType<typeof setInterval> | undefined;

  const stopHeartbeat = () => {
    if (heartbeatTimer) {
      clearInterval(heartbeatTimer);
      heartbeatTimer = undefined;
    }
  };

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      if (heartbeatIntervalMs > 0) {
        heartbeatTimer = setInterval(() => {
          if (cancelled || abortController.signal.aborted) return;
          try {
            controller.enqueue(keepalive);
          } catch {
            stopHeartbeat();
          }
        }, heartbeatIntervalMs);
      }
      try {
        for await (const event of generator) {
          if (cancelled || abortController.signal.aborted) return;
          controller.enqueue(formatEvent(event));
        }
      } catch (err) {
        if (cancelled || abortController.signal.aborted) return;
        const message = err instanceof Error ? err.message : 'Unexpected agent error.';
        controller.enqueue(formatEvent({ type: 'error', message }));
        controller.enqueue(formatEvent({ type: 'done' }));
      } finally {
        stopHeartbeat();
        if (!cancelled) {
          controller.close();
        }
      }
    },
    cancel() {
      cancelled = true;
      stopHeartbeat();
      abortController.abort();
      void generator.return?.(undefined);
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  });
}
