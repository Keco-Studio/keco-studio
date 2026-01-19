/**
 * Email Service
 * 
 * Handles sending invitation emails using Resend API.
 * Uses React Email templates for consistent, responsive email design.
 */

import { Resend } from 'resend';
import { InvitationEmail } from '@/emails/invitation-email';

// Initialize Resend client
const resend = new Resend(process.env.RESEND_API_KEY);

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
  params: SendInvitationEmailParams
): Promise<string> {
  const {
    recipientEmail,
    recipientName,
    inviterName,
    projectName,
    role,
    acceptLink,
  } = params;

  try {
    const result = await resend.emails.send({
      from: FROM_EMAIL,
      to: recipientEmail,
      subject: `${inviterName} invited you to collaborate on ${projectName}`,
      react: InvitationEmail({
        recipientName: recipientName || recipientEmail.split('@')[0],
        inviterName,
        projectName,
        role,
        acceptLink,
      }),
    });

    if (result.error) {
      throw new Error(`Email send failed: ${result.error.message}`);
    }

    if (!result.data?.id) {
      throw new Error('Email send succeeded but no ID returned');
    }

    return result.data.id;
  } catch (error) {
    // Re-throw with context for better error handling upstream
    if (error instanceof Error) {
      throw new Error(`Failed to send invitation email: ${error.message}`);
    }
    throw new Error('Failed to send invitation email: Unknown error');
  }
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

