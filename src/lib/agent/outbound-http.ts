/**
 * Outbound HTTP for LLM / embedding providers.
 *
 * Node's built-in fetch (undici) ignores HTTP(S)_PROXY. In environments that
 * reach external APIs only via a local proxy, that surfaces as TypeError
 * "fetch failed" / ConnectTimeoutError. Always route through undici's
 * EnvHttpProxyAgent so proxy + NO_PROXY are honored.
 */

import {
  EnvHttpProxyAgent,
  fetch as undiciFetch,
  type Dispatcher,
  type RequestInit as UndiciRequestInit,
} from 'undici';

let outboundDispatcher: Dispatcher | null = null;

export function getOutboundDispatcher(): Dispatcher {
  outboundDispatcher ??= new EnvHttpProxyAgent({
    connectTimeout: 30_000,
    // Professional GDD generation may run for up to 270 seconds. Keep the
    // provider transport alive long enough for the worker deadline to handle
    // cancellation and retries instead of cutting it off at 120 seconds.
    headersTimeout: 300_000,
    bodyTimeout: 300_000,
  });
  return outboundDispatcher;
}

export function resetOutboundDispatcherForTests(): void {
  outboundDispatcher = null;
}

type OutboundRequestInit = Omit<UndiciRequestInit, 'dispatcher'> & {
  dispatcher?: Dispatcher;
};

export function outboundFetch(
  input: Parameters<typeof undiciFetch>[0],
  init?: OutboundRequestInit
): ReturnType<typeof undiciFetch> {
  return undiciFetch(input, {
    ...init,
    dispatcher: init?.dispatcher ?? getOutboundDispatcher(),
  });
}
