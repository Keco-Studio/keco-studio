/**
 * Invitation Token Utilities
 * 
 * Generates and validates JWT tokens for secure invitation links.
 * Uses jose library for JWT signing with HMAC-SHA256.
 * 
 * Security features:
 * - Cryptographically signed with server secret
 * - 7-day expiration (configurable)
 * - Tamper-proof (signature validation)
 * - Self-contained (no DB lookup for token structure)
 */

import { SignJWT, jwtVerify, type JWTPayload } from 'jose';
import type { InvitationTokenPayload } from '@/lib/types/collaboration';

/**
 * Get JWT signing secret from environment
 * @throws Error if secret not configured
 */
function getSecret(): Uint8Array {
  const secret = process.env.INVITATION_SECRET;
  
  if (!secret) {
    throw new Error('INVITATION_SECRET environment variable not configured');
  }
  
  return new TextEncoder().encode(secret);
}

/**
 * Default token expiration (7 days in seconds)
 */
const DEFAULT_EXPIRATION_DAYS = 7;
const SECONDS_PER_DAY = 24 * 60 * 60;

/**
 * Generate invitation token (JWT)
 * 
 * @param payload - Invitation data to encode in token
 * @param expirationDays - Days until token expires (default: 7)
 * @returns Signed JWT token string
 * 
 * @example
 * ```typescript
 * const token = await generateInvitationToken({
 *   invitationId: 'uuid-123',
 *   projectId: 'uuid-456',
 *   email: 'user@example.com',
 *   role: 'editor',
 *   exp: Math.floor(Date.now() / 1000) + (7 * 24 * 60 * 60)
 * });
 * ```
 */
export async function generateInvitationToken(
  payload: Omit<InvitationTokenPayload, 'exp'>,
  expirationDays: number = DEFAULT_EXPIRATION_DAYS
): Promise<string> {
  const secret = getSecret();
  
  // Calculate expiration timestamp (Unix timestamp in seconds)
  const expirationSeconds = Math.floor(Date.now() / 1000) + (expirationDays * SECONDS_PER_DAY);
  
  const token = await new SignJWT({
    ...payload,
    exp: expirationSeconds,
  })
    .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
    .setIssuedAt()
    .setExpirationTime(expirationSeconds)
    .sign(secret);
  
  return token;
}

/**
 * Validate and decode invitation token
 * 
 * @param token - JWT token string from invitation link
 * @returns Decoded token payload if valid
 * @throws Error if token invalid, expired, or signature verification fails
 * 
 * @example
 * ```typescript
 * try {
 *   const payload = await validateInvitationToken(token);
 *   // Token is valid, use payload.invitationId, payload.projectId, etc.
 * } catch (error) {
 *   // Token invalid or expired
 *   console.error('Invalid invitation:', error.message);
 * }
 * ```
 */
export async function validateInvitationToken(
  token: string
): Promise<InvitationTokenPayload> {
  const secret = getSecret();
  
  try {
    const { payload } = await jwtVerify(token, secret, {
      algorithms: ['HS256'],
    });
    
    // Verify required fields are present
    if (!payload.invitationId || !payload.projectId || !payload.email || !payload.role) {
      throw new Error('Invalid token payload: missing required fields');
    }
    
    // Type assertion after validation
    return payload as unknown as InvitationTokenPayload;
  } catch (error) {
    if (error instanceof Error) {
      // Enhance error messages for common cases
      if (error.message.includes('exp')) {
        throw new Error('Invitation link has expired');
      }
      if (error.message.includes('signature')) {
        throw new Error('Invalid invitation link (signature verification failed)');
      }
      throw new Error(`Invalid invitation token: ${error.message}`);
    }
    throw new Error('Invalid invitation token: Unknown error');
  }
}

/**
 * Decode token without validation (for debugging only)
 * 
 * WARNING: Does NOT verify signature or expiration.
 * Only use for debugging/logging, never for authorization.
 * 
 * @param token - JWT token string
 * @returns Decoded payload (unverified)
 */
export function decodeInvitationTokenUnsafe(token: string): JWTPayload | null {
  try {
    // Split JWT into parts (header.payload.signature)
    const parts = token.split('.');
    if (parts.length !== 3) {
      return null;
    }
    
    // Decode payload (middle part)
    const payload = JSON.parse(
      Buffer.from(parts[1], 'base64url').toString('utf-8')
    );
    
    return payload;
  } catch {
    return null;
  }
}

/**
 * Check if token is expired without full validation
 * Useful for providing better error messages
 * 
 * @param token - JWT token string
 * @returns True if token is expired
 */
export function isTokenExpired(token: string): boolean {
  const payload = decodeInvitationTokenUnsafe(token);
  
  if (!payload || typeof payload.exp !== 'number') {
    return true; // Treat invalid tokens as expired
  }
  
  const nowSeconds = Math.floor(Date.now() / 1000);
  return payload.exp < nowSeconds;
}

/**
 * Get token expiration time
 * 
 * @param token - JWT token string
 * @returns Expiration date or null if invalid
 */
export function getTokenExpiration(token: string): Date | null {
  const payload = decodeInvitationTokenUnsafe(token);
  
  if (!payload || typeof payload.exp !== 'number') {
    return null;
  }
  
  return new Date(payload.exp * 1000); // Convert seconds to milliseconds
}

/**
 * Validate token configuration
 * Useful for health checks
 * 
 * @returns True if secret is properly configured
 */
export function isTokenConfigured(): boolean {
  try {
    const secret = process.env.INVITATION_SECRET;
    return !!secret && secret.length >= 32; // Minimum 32 bytes recommended
  } catch {
    return false;
  }
}

