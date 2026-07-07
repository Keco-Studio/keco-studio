/**
 * Helpers to turn an SSEEvent async generator into a streaming Response.
 */

import type { SSEEvent } from './types';

const encoder = new TextEncoder();

function formatEvent(event: SSEEvent): Uint8Array {
  return encoder.encode(`data: ${JSON.stringify(event)}\n\n`);
}

/**
 * Build a text/event-stream Response from an SSEEvent generator. Errors thrown
 * by the generator are surfaced as a final `error` + `done` event pair.
 */
export function sseResponse(
  generator: AsyncGenerator<SSEEvent>,
  options: { abortController?: AbortController } = {}
): Response {
  const abortController = options.abortController ?? new AbortController();
  let cancelled = false;

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
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
        if (!cancelled) {
          controller.close();
        }
      }
    },
    cancel() {
      cancelled = true;
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
