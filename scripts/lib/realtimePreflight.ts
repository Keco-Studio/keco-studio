export type RealtimePreflightChannelStatus =
  | 'SUBSCRIBED'
  | 'CHANNEL_ERROR'
  | 'TIMED_OUT'
  | 'CLOSED'
  | string;

export type RealtimePreflightChannel = {
  on: (
    type: 'broadcast',
    filter: { event: string },
    callback: (payload: { payload: unknown }) => void
  ) => RealtimePreflightChannel;
  subscribe: (
    callback: (status: RealtimePreflightChannelStatus, error?: Error) => void
  ) => RealtimePreflightChannel;
  httpSend: (event: string, payload: unknown) => Promise<{ success?: boolean; error?: string }>;
  unsubscribe: () => Promise<unknown>;
};

export type RealtimePreflightClient = {
  auth: {
    signInWithPassword: (credentials: {
      email: string;
      password: string;
    }) => Promise<{
      data: { session: unknown | null; user: { id: string } | null };
      error: Error | null;
    }>;
  };
  channel: (
    topic: string,
    options: { config: { private: true; broadcast: { ack: boolean; self: boolean } } }
  ) => RealtimePreflightChannel;
};

export type RealtimePreflightPrivateTopic = {
  topic: string;
  cleanup: () => Promise<void>;
};

export type RealtimePreflightOptions = {
  env: Record<string, string | undefined>;
  createClient: (url: string, anonKey: string) => RealtimePreflightClient;
  createPrivateTopic: (
    senderUserId: string,
    receiverUserId: string,
  ) => Promise<RealtimePreflightPrivateTopic>;
  timeoutMs: number;
};

type RealtimePreflightEnvironment = {
  url: string;
  anonKey: string;
  sender: RealtimePreflightCredentials;
  receiver: RealtimePreflightCredentials;
};

type RealtimePreflightCredentials = {
  email: string;
  password: string;
};

const DEFAULT_SENDER_EMAIL = 'seed-empty@mailinator.com';
const DEFAULT_RECEIVER_EMAIL = 'seed-empty-2@mailinator.com';
const DEFAULT_PASSWORD = 'Password123!';

function required(env: RealtimePreflightOptions['env'], name: string): string {
  const value = env[name]?.trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}

export function readRealtimePreflightEnvironment(
  env: RealtimePreflightOptions['env']
): RealtimePreflightEnvironment {
  const environment = {
    url: required(env, 'NEXT_PUBLIC_SUPABASE_URL'),
    anonKey: required(env, 'NEXT_PUBLIC_SUPABASE_ANON_KEY'),
    sender: {
      email: env.REALTIME_PREFLIGHT_EMAIL?.trim() || DEFAULT_SENDER_EMAIL,
      password: env.REALTIME_PREFLIGHT_PASSWORD?.trim() || DEFAULT_PASSWORD,
    },
    receiver: {
      email: env.REALTIME_PREFLIGHT_RECEIVER_EMAIL?.trim() || DEFAULT_RECEIVER_EMAIL,
      password: env.REALTIME_PREFLIGHT_RECEIVER_PASSWORD?.trim()
        || env.REALTIME_PREFLIGHT_PASSWORD?.trim()
        || DEFAULT_PASSWORD,
    },
  };
  if (environment.sender.email === environment.receiver.email) {
    throw new Error('Realtime preflight sender and receiver must use distinct email addresses');
  }
  return environment;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function waitFor<T>(promise: Promise<T>, label: string, timeoutMs: number): Promise<T> {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  const expiry = new Promise<never>((_, reject) => {
    timeout = setTimeout(() => reject(new Error(`${label} timed out after ${timeoutMs}ms`)), timeoutMs);
  });
  return Promise.race([promise, expiry]).finally(() => {
    if (timeout) clearTimeout(timeout);
  });
}

async function signIn(
  client: RealtimePreflightClient,
  credentials: RealtimePreflightCredentials,
): Promise<string> {
  const result = await client.auth.signInWithPassword(credentials);
  if (result.error || !result.data.session || !result.data.user?.id) {
    throw new Error(result.error?.message ?? 'authentication returned no session');
  }
  return result.data.user.id;
}

function waitForSubscription(
  channel: RealtimePreflightChannel,
  label: string,
  timeoutMs: number
): Promise<void> {
  return waitFor(
    new Promise<void>((resolve, reject) => {
      channel.subscribe((status, error) => {
        if (status === 'SUBSCRIBED') {
          resolve();
          return;
        }
        reject(error ?? new Error(`${label} subscription returned ${status}`));
      });
    }),
    `${label} subscription`,
    timeoutMs
  );
}

export async function runRealtimePreflight(
  options: RealtimePreflightOptions
): Promise<{ authenticatedClients: 2; broadcastDelivered: true }> {
  const environment = readRealtimePreflightEnvironment(options.env);
  const sender = options.createClient(environment.url, environment.anonKey);
  const receiver = options.createClient(environment.url, environment.anonKey);
  const event = 'authenticated-broadcast';
  const nonce = Math.random().toString(36).slice(2);
  let resolveReceived: (() => void) | undefined;
  const received = new Promise<void>((resolve) => {
    resolveReceived = resolve;
  });
  let senderChannel: RealtimePreflightChannel | undefined;
  let receiverChannel: RealtimePreflightChannel | undefined;
  let privateTopic: RealtimePreflightPrivateTopic | undefined;

  try {
    const [senderUserId, receiverUserId] = await Promise.all([
      signIn(sender, environment.sender),
      signIn(receiver, environment.receiver),
    ]);
    privateTopic = await options.createPrivateTopic(senderUserId, receiverUserId);

    receiverChannel = receiver
      .channel(privateTopic.topic, { config: { private: true, broadcast: { ack: true, self: false } } })
      .on('broadcast', { event }, (message) => {
        const payload = message.payload as { nonce?: unknown } | null;
        if (payload?.nonce === nonce) resolveReceived?.();
      });
    senderChannel = sender.channel(privateTopic.topic, {
      config: { private: true, broadcast: { ack: true, self: false } },
    });

    await Promise.all([
      waitForSubscription(receiverChannel, 'receiver', options.timeoutMs),
      waitForSubscription(senderChannel, 'sender', options.timeoutMs),
    ]);

    const result = await senderChannel.httpSend(event, { nonce });
    if (result.success === false) {
      throw new Error(`broadcast rejected: ${result.error ?? 'unknown error'}`);
    }
    await waitFor(received, 'broadcast delivery', options.timeoutMs);

    return { authenticatedClients: 2, broadcastDelivered: true };
  } catch (error) {
    throw new Error(`Realtime preflight failed: ${errorMessage(error)}`);
  } finally {
    await Promise.all([
      senderChannel?.unsubscribe(),
      receiverChannel?.unsubscribe(),
      privateTopic?.cleanup(),
    ]);
  }
}
