import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import type { GeneratedImage, ProviderConfig } from './types';

const MAX_IMAGE_BYTES = 20 * 1024 * 1024;
const DEFAULT_TIMEOUT_MS = 180_000;
const MAX_JSON_BYTES = 2 * 1024 * 1024;
const responseCleanup = new WeakMap<Response, () => void>();
const responseSignals = new WeakMap<Response, AbortSignal>();

export class ProviderError extends Error {
  constructor(public readonly code: string, message: string) {
    super(message);
    this.name = 'ProviderError';
  }
}

export function normalizeProviderBaseUrl(value: string): string {
  const url = new URL(value);
  const pathname = url.pathname.replace(/\/+$/, '');
  url.pathname = pathname.endsWith('/v1') ? pathname : `${pathname}/v1`;
  return url.toString().replace(/\/$/, '');
}

function releaseResponse(response: Response): void {
  responseCleanup.get(response)?.();
  responseCleanup.delete(response);
  responseSignals.delete(response);
}

async function readLimited(response: Response, maxBytes: number): Promise<Buffer> {
  const declared = Number(response.headers.get('content-length') ?? '0');
  if (declared > maxBytes) {
    releaseResponse(response);
    throw new ProviderError('RESPONSE_TOO_LARGE', 'Provider response body is too large.');
  }
  if (!response.body) {
    try {
      const bytes = Buffer.from(await response.arrayBuffer());
      if (bytes.length > maxBytes) throw new ProviderError('RESPONSE_TOO_LARGE', 'Provider response body is too large.');
      return bytes;
    }
    catch (error) {
      if (responseSignals.get(response)?.aborted) throw new ProviderError('TIMEOUT', 'Provider request timed out.');
      throw error;
    } finally {
      releaseResponse(response);
    }
  }
  const reader = response.body.getReader();
  const chunks: Buffer[] = [];
  let total = 0;
  try {
    for (;;) {
      const next = await reader.read();
      if (next.done) break;
      total += next.value.byteLength;
      if (total > maxBytes) throw new ProviderError('RESPONSE_TOO_LARGE', 'Provider response body is too large.');
      chunks.push(Buffer.from(next.value));
    }
    return Buffer.concat(chunks, total);
  } catch (error) {
    const signal = responseSignals.get(response);
    if (signal?.aborted) throw new ProviderError('TIMEOUT', 'Provider request timed out.');
    throw error;
  } finally {
    releaseResponse(response);
    reader.releaseLock();
  }
}

async function safeJson(response: Response): Promise<unknown> {
  try {
    const bytes = await readLimited(response, MAX_JSON_BYTES);
    return JSON.parse(bytes.toString('utf8')) as unknown;
  } catch (error) {
    if (error instanceof ProviderError) throw error;
    throw new ProviderError('INVALID_RESPONSE', 'Provider returned invalid JSON.');
  }
}

async function providerFetch(config: ProviderConfig, input: string | URL, init?: RequestInit): Promise<Response> {
  const fetchImpl = config.fetchImpl ?? fetch;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), config.requestTimeoutMs ?? DEFAULT_TIMEOUT_MS);
  try {
    const response = await fetchImpl(input, { ...init, signal: controller.signal });
    responseCleanup.set(response, () => clearTimeout(timeout));
    responseSignals.set(response, controller.signal);
    return response;
  } catch (error) {
    clearTimeout(timeout);
    if (controller.signal.aborted) throw new ProviderError('TIMEOUT', 'Provider request timed out.');
    throw new ProviderError('NETWORK_ERROR', 'Provider request failed.');
  }
}

export async function discoverImageModel(config: ProviderConfig): Promise<string> {
  if (config.model) return config.model;
  const response = await providerFetch(config, `${normalizeProviderBaseUrl(config.baseUrl)}/models`, {
    headers: { Authorization: `Bearer ${config.apiKey}` },
  });
  if (!response.ok) { releaseResponse(response); throw new ProviderError(`HTTP_${response.status}`, `Provider model discovery failed (${response.status}).`); }
  const payload = await safeJson(response) as { data?: Array<{ id?: unknown; object?: unknown; capabilities?: unknown }> };
  const candidates = (payload.data ?? []).filter((model) => {
    if (typeof model.id !== 'string') return false;
    const metadata = JSON.stringify({ object: model.object, capabilities: model.capabilities }).toLowerCase();
    return /image|vision|gpt-image/.test(`${model.id} ${metadata}`.toLowerCase());
  }).map((model) => String(model.id));
  if (candidates.length !== 1) throw new ProviderError('MODEL_AMBIGUOUS', `Expected exactly one image model; found ${candidates.length}.`);
  return candidates[0];
}

function isPrivateAddress(hostname: string): boolean {
  const normalized = hostname.toLowerCase().replace(/^\[|\]$/g, '');
  const version = isIP(normalized);
  if (version === 4) {
    const octets = normalized.split('.').map(Number);
    const [a, b] = octets;
    return a === 0 || a === 10 || a === 127 || (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254)
      || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a >= 224);
  }
  if (version === 6) {
    if (normalized.startsWith('::ffff:')) return isPrivateAddress(normalized.slice(7));
    return normalized === '::' || normalized === '::1' || normalized.startsWith('fc') || normalized.startsWith('fd')
      || /^fe[89ab]/.test(normalized);
  }
  return false;
}

async function assertPublicHostname(hostname: string): Promise<void> {
  if (isPrivateAddress(hostname)) throw new ProviderError('DOWNLOAD_URL_REJECTED', `Generated image host is private: ${hostname}`);
  if (isIP(hostname)) return;
  const addresses = await lookup(hostname, { all: true, verbatim: true });
  if (!addresses.length || addresses.some(({ address }) => isPrivateAddress(address))) {
    throw new ProviderError('DOWNLOAD_URL_REJECTED', `Generated image host resolves to a private address: ${hostname}`);
  }
}

async function publicDownloadUrl(raw: string, provider: URL, allowlist: string[]): Promise<URL> {
  const url = new URL(raw);
  if (url.protocol !== 'https:' && !(url.origin === provider.origin && provider.protocol === 'http:')) throw new ProviderError('DOWNLOAD_URL_REJECTED', 'Generated image URL protocol is not allowed.');
  if (url.username || url.password) throw new ProviderError('DOWNLOAD_URL_REJECTED', 'Generated image URL credentials are not allowed.');
  const allowedProvider = url.origin === provider.origin;
  const allowedHost = allowlist.includes(url.hostname) && url.protocol === 'https:' && (url.port === '' || url.port === '443');
  if (!allowedProvider && !allowedHost) {
    throw new ProviderError('DOWNLOAD_URL_REJECTED', `Generated image host is not allowed: ${url.hostname}`);
  }
  await assertPublicHostname(url.hostname);
  return url;
}

export async function downloadGeneratedImage(rawUrl: string, config: ProviderConfig): Promise<Buffer> {
  const provider = new URL(normalizeProviderBaseUrl(config.baseUrl));
  const url = await publicDownloadUrl(rawUrl, provider, config.downloadHosts ?? []);
  const response = await providerFetch(config, url, { redirect: 'error' });
  if (!response.ok) { releaseResponse(response); throw new ProviderError(`DOWNLOAD_${response.status}`, `Generated image download failed (${response.status}).`); }
  const contentType = response.headers.get('content-type') ?? '';
  if (!contentType.startsWith('image/')) { releaseResponse(response); throw new ProviderError('MIME_MISMATCH', 'Generated response is not an image.'); }
  const bytes = await readLimited(response, MAX_IMAGE_BYTES);
  if (!bytes.length || bytes.length > MAX_IMAGE_BYTES) throw new ProviderError('IMAGE_SIZE_INVALID', 'Generated image size is invalid.');
  return bytes;
}

export async function generateImage(config: ProviderConfig, prompt: string, size = '1536x1024'): Promise<GeneratedImage> {
  const model = await discoverImageModel(config);
  const response = await providerFetch(config, `${normalizeProviderBaseUrl(config.baseUrl)}/images/generations`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${config.apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model, prompt, size, quality: 'high', response_format: 'b64_json', n: 1 }),
  });
  if (!response.ok) { releaseResponse(response); throw new ProviderError(`HTTP_${response.status}`, `Provider image generation failed (${response.status}).`); }
  const payload = await safeJson(response) as { data?: Array<{ b64_json?: unknown; url?: unknown; revised_prompt?: unknown }> };
  const item = payload.data?.[0];
  if (!item) throw new ProviderError('IMAGE_MISSING', 'Provider returned no image.');
  let bytes: Buffer;
  if (typeof item.b64_json === 'string') {
    if (item.b64_json.length > MAX_IMAGE_BYTES * 2) throw new ProviderError('IMAGE_SIZE_INVALID', 'Generated base64 image is too large.');
    bytes = Buffer.from(item.b64_json, 'base64');
  } else if (typeof item.url === 'string') {
    bytes = await downloadGeneratedImage(item.url, config);
  } else {
    throw new ProviderError('IMAGE_MISSING', 'Provider response has no supported image payload.');
  }
  if (!bytes.length || bytes.length > MAX_IMAGE_BYTES) throw new ProviderError('IMAGE_SIZE_INVALID', 'Generated image size is invalid.');
  return { bytes, ...(typeof item.revised_prompt === 'string' ? { revisedPrompt: item.revised_prompt } : {}) };
}
