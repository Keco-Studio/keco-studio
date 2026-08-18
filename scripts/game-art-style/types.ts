export type ProviderConfig = {
  baseUrl: string;
  apiKey: string;
  model?: string;
  downloadHosts?: string[];
  requestTimeoutMs?: number;
  fetchImpl?: typeof fetch;
};

export type GeneratedImage = {
  bytes: Buffer;
  revisedPrompt?: string;
};
