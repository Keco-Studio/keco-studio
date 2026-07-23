import 'server-only';

import { createHmac, timingSafeEqual } from 'node:crypto';

const CONNECTION_ID_VERSION = 'v1';
const TEST_SIGNING_SECRET =
  'keco-studio-test-only-mcp-connection-signing-secret-v1';

function getSigningSecret(): string {
  const configured = process.env.MCP_CONNECTION_ID_SIGNING_SECRET;
  if (process.env.NODE_ENV === 'test') {
    return configured ?? TEST_SIGNING_SECRET;
  }
  if (!configured || configured.length < 32) {
    throw new Error('MCP connection ID signing secret is not configured securely.');
  }
  return configured;
}

function signature(userId: string, authorizationId: string): Buffer {
  const payload = `${CONNECTION_ID_VERSION}:${userId.length}:${userId}:${authorizationId.length}:${authorizationId}`;
  return createHmac('sha256', getSigningSecret()).update(payload, 'utf8').digest();
}

export function signMcpConnectionId(
  userId: string,
  authorizationId: string
): string {
  return `${CONNECTION_ID_VERSION}.${signature(userId, authorizationId).toString('base64url')}`;
}

export function matchesMcpConnectionId(
  connectionId: string,
  userId: string,
  authorizationId: string
): boolean {
  const [version, encoded, extra] = connectionId.split('.');
  if (version !== CONNECTION_ID_VERSION || !encoded || extra !== undefined) {
    return false;
  }

  let supplied: Buffer;
  try {
    supplied = Buffer.from(encoded, 'base64url');
  } catch {
    return false;
  }
  const expected = signature(userId, authorizationId);
  return supplied.length === expected.length && timingSafeEqual(supplied, expected);
}
