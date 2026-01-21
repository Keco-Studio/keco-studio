/**
 * Email Service
 * 
 * Handles sending invitation emails using Resend API.
 * Uses React Email templates for consistent, responsive email design.
 */

import { Resend } from 'resend';
import { InvitationEmail } from '@/emails/invitation-email';

// Lazy initialization of Resend client to avoid build-time errors
// Initialize only when needed and API key is available
function getResendClient(): Resend {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    throw new Error('RESEND_API_KEY is not configured. Please check your environment variables.');
  }
  if (apiKey === 're_your_resend_api_key_here') {
    throw new Error('RESEND_API_KEY is set to placeholder value. Please set a valid API key.');
  }
  return new Resend(apiKey);
}

/**
 * Email sender configuration
 * Update domain after verifying in Resend dashboard
 */
const FROM_EMAIL = process.env.RESEND_FROM_EMAIL || 'Keco Studio <invites@resend.dev>';

/**
 * Parameters for sending invitation email
 */
export type SendInvitationEmailParams = {
  recipientEmail: string;
  recipientName?: string;
  inviterName: string;
  inviterEmail: string;
  projectName: string;
  role: string;
  acceptLink: string;
};

/**
 * Send collaboration invitation email
 * 
 * @param params - Email parameters including recipient, inviter, project details
 * @returns Email ID from Resend for tracking delivery
 * @throws Error if email send fails
 * 
 * @example
 * ```typescript
 * const emailId = await sendInvitationEmail({
 *   recipientEmail: 'colleague@example.com',
 *   inviterName: 'Alice',
 *   projectName: 'Design System',
 *   role: 'Editor',
 *   acceptLink: 'https://app.keco.studio/accept-invitation?token=...'
 * });
 * ```
 */
export async function sendInvitationEmail(
  params: SendInvitationEmailParams,
  retries: number = 2
): Promise<string> {
  const {
    recipientEmail,
    recipientName,
    inviterName,
    inviterEmail,
    projectName,
    role,
    acceptLink,
  } = params;

  // Validate configuration before attempting to send
  if (!process.env.RESEND_API_KEY) {
    throw new Error('RESEND_API_KEY is not configured. Please check your environment variables.');
  }

  if (process.env.RESEND_API_KEY === 're_your_resend_api_key_here') {
    throw new Error('RESEND_API_KEY is set to placeholder value. Please set a valid API key.');
  }

  let lastError: Error | null = null;
  
  // Retry logic for network errors
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      if (attempt > 0) {
        // Wait before retry: 1s, 2s, 4s (exponential backoff)
        const delay = Math.min(1000 * Math.pow(2, attempt - 1), 4000);
        console.log(`[EmailService] Retrying email send (attempt ${attempt + 1}/${retries + 1}) after ${delay}ms...`);
        await new Promise(resolve => setTimeout(resolve, delay));
      }

      const resend = getResendClient();
      const result = await resend.emails.send({
        from: FROM_EMAIL,
        to: recipientEmail,
        subject: `${inviterName} invited you to collaborate on ${projectName}`,
        react: InvitationEmail({
          recipientName: recipientName || recipientEmail.split('@')[0],
          inviterName,
          inviterEmail,
          projectName,
          role,
          acceptLink,
        }),
      });

      if (result.error) {
        console.error('[EmailService] Resend API error:', {
          message: result.error.message,
          name: result.error.name,
          statusCode: (result.error as any).statusCode,
        });
        throw new Error(`Email send failed: ${result.error.message}`);
      }

      if (!result.data?.id) {
        throw new Error('Email send succeeded but no ID returned');
      }

      if (attempt > 0) {
        console.log(`[EmailService] Email sent successfully after ${attempt} retries:`, result.data.id);
      } else {
        console.log('[EmailService] Email sent successfully:', result.data.id);
      }
      return result.data.id;
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
      
      // Check if it's a network error that we should retry
      const errorMessage = lastError.message;
      const isNetworkError = 
        errorMessage.includes('Unable to fetch') ||
        errorMessage.includes('fetch failed') ||
        errorMessage.includes('ENOTFOUND') ||
        errorMessage.includes('ECONNREFUSED') ||
        errorMessage.includes('ETIMEDOUT') ||
        errorMessage.includes('request could not be resolved');
      
      // Only retry on network errors, and only if we have retries left
      if (isNetworkError && attempt < retries) {
        console.warn(`[EmailService] Network error on attempt ${attempt + 1}, will retry...`);
        continue; // Retry
      }
      
      // If not a network error, or no retries left, throw immediately
      if (error instanceof Error) {
        // Enhanced error handling with network diagnostics
        if (isNetworkError) {
          console.error('[EmailService] Network error after all retries:', {
            message: errorMessage,
            attempts: attempt + 1,
            apiKeyConfigured: !!process.env.RESEND_API_KEY,
            apiKeyLength: process.env.RESEND_API_KEY?.length || 0,
            fromEmail: FROM_EMAIL,
          });
          throw new Error(
            `Network error: Unable to connect to Resend API after ${attempt + 1} attempts. ` +
            `This could be due to: 1) Network connectivity issues, 2) DNS resolution problems, ` +
            `3) Firewall/proxy blocking the request, or 4) Resend API service outage. ` +
            `Original error: ${errorMessage}`
          );
        }
        
        // Re-throw with context for better error handling upstream
        throw new Error(`Failed to send invitation email: ${errorMessage}`);
      }
      throw new Error('Failed to send invitation email: Unknown error');
    }
  }
  
  // If we get here, all retries failed
  throw lastError || new Error('Failed to send invitation email: Unknown error');
}

/**
 * Validate email configuration
 * Useful for health checks and startup validation
 * 
 * @returns True if API key is configured
 */
export function isEmailConfigured(): boolean {
  return !!process.env.RESEND_API_KEY && process.env.RESEND_API_KEY !== 're_your_resend_api_key_here';
}

/**
 * Get email service status for debugging
 * 
 * @returns Status information
 */
export function getEmailServiceStatus(): {
  configured: boolean;
  fromEmail: string;
  apiKeySet: boolean;
} {
  return {
    configured: isEmailConfigured(),
    fromEmail: FROM_EMAIL,
    apiKeySet: !!process.env.RESEND_API_KEY,
  };
}

