/**
 * Invitation Email Template
 * 
 * React Email template for collaboration invitations.
 * Responsive, accessible, and works across all major email clients.
 */

import {
  Body,
  Button,
  Container,
  Head,
  Heading,
  Hr,
  Html,
  Img,
  Link,
  Preview,
  Section,
  Text,
  Row,
  Column,
} from '@react-email/components';

interface InvitationEmailProps {
  recipientName: string;
  inviterName: string;
  inviterEmail: string;
  projectName: string;
  role: string;
  acceptLink: string;
}

export function InvitationEmail({
  recipientName = 'there',
  inviterName = 'A team member',
  inviterEmail = 'user@example.com',
  projectName = 'Untitled Project',
  role = 'Editor',
  acceptLink = 'https://app.keco.studio',
}: InvitationEmailProps) {
  const previewText = `${inviterName} invited you to work together with ${projectName}`;
  
  // Extract token from acceptLink for decline link
  const url = new URL(acceptLink);
  const token = url.searchParams.get('token') || '';
  const declineLink = `${url.origin}/decline-invitation?token=${token}`;

  // SVG icon as base64 data URL (converted from LibraryBookIcon.svg)
  // URL-encoded SVG for better email client compatibility
  const svgContent = encodeURIComponent(
    '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M2 3H8C9.06087 3 10.0783 3.42143 10.8284 4.17157C11.5786 4.92172 12 5.93913 12 7V21C12 20.2044 11.6839 19.4413 11.1213 18.8787C10.5587 18.3161 9.79565 18 9 18H2V3Z" stroke="#21272A" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/><path d="M22 3H16C14.9391 3 13.9217 3.42143 13.1716 4.17157C12.4214 4.92172 12 5.93913 12 7V21C12 20.2044 12.3161 19.4413 12.8787 18.8787C13.4413 18.3161 14.2044 18 15 18H22V3Z" stroke="#21272A" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>'
  );
  const bookIconSvg = `data:image/svg+xml;charset=utf-8,${svgContent}`;

  return (
    <Html>
      <Head />
      <Preview>{previewText}</Preview>
      <Body style={main}>
        <Container style={container}>
          {/* Main Content Card */}
          <Section style={cardSection}>
            {/* Avatar and Inviter Info - Left/Right Layout */}
            <Row>
              <Column style={avatarColumn}>
                <div style={avatar}>
                  <Text style={avatarText}>{inviterName.charAt(0).toUpperCase()}</Text>
                </div>
              </Column>
              <Column style={infoColumn}>
                <Heading style={inviterNameHeading}>
                  {inviterName} ({inviterEmail})
                </Heading>
                <Text style={inviteText}>
                  invited you to work together with keco project
                </Text>
              </Column>
            </Row>
            
            {/* Project Name - Left/Right Layout */}
            <Row style={projectRow}>
              <Column style={iconColumn}>
                <Text style={projectIcon}>📖</Text>
              </Column>
              <Column style={projectNameColumn}>
                <Text style={projectNameText}>({projectName})</Text>
              </Column>
            </Row>
            
            {/* Accept Button */}
            <Section style={buttonSection}>
              <Button style={acceptButton} href={acceptLink}>
                Accept invite
              </Button>
            </Section>
            
            {/* Decline Link */}
            <Text style={declineText}>
              <Link href={declineLink} style={declineLinkStyle}>
                or decline
              </Link>
            </Text>
          </Section>
        </Container>
      </Body>
    </Html>
  );
}

export default InvitationEmail;

// ============================================================================
// Styles
// ============================================================================

const main = {
  backgroundColor: '#ede9fe',
  fontFamily:
    '-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,"Helvetica Neue",Ubuntu,sans-serif',
  padding: '40px 20px',
};

const container = {
  margin: '0 auto',
  maxWidth: '600px',
};

const cardSection = {
  backgroundColor: '#ffffff',
  borderRadius: '12px',
  padding: '48px 40px',
  boxShadow: '0 2px 8px rgba(0, 0, 0, 0.1)',
};

// Avatar column (left)
const avatarColumn = {
  width: '80px',
  verticalAlign: 'top',
  paddingRight: '20px',
};

// Info column (right)
const infoColumn = {
  verticalAlign: 'top',
};

const avatar = {
  width: '64px',
  height: '64px',
  borderRadius: '50%',
  backgroundColor: '#10b981',
  display: 'block',
  margin: '0',
  textAlign: 'center' as const,
  lineHeight: '64px',
};

const avatarText = {
  color: '#ffffff',
  fontSize: '28px',
  fontWeight: '600',
  margin: '0',
  lineHeight: '64px',
  display: 'block',
};

const inviterNameHeading = {
  color: '#7c3aed',
  fontSize: '24px',
  fontWeight: '600',
  margin: '0 0 8px 0',
  lineHeight: '1.3',
  textAlign: 'left' as const,
};

const inviteText = {
  color: '#1a1a1a',
  fontSize: '18px',
  fontWeight: '400',
  margin: '0 0 32px 0',
  lineHeight: '1.5',
  textAlign: 'left' as const,
};

// Project row
const projectRow = {
  marginBottom: '32px',
};

// Icon column (left)
const iconColumn = {
  width: '32px',
  verticalAlign: 'middle',
  paddingRight: '12px',
};

// Project name column (right)
const projectNameColumn = {
  verticalAlign: 'middle',
};

const projectIcon = {
  display: 'block',
  margin: '0',
};

const projectNameText = {
  color: '#525252',
  fontSize: '16px',
  fontWeight: '600',
  margin: '0',
  textAlign: 'left' as const,
  lineHeight: '24px',
};

const buttonSection = {
  textAlign: 'center' as const,
  margin: '0 0 16px',
};

const acceptButton = {
  backgroundColor: '#7c3aed',
  borderRadius: '8px',
  color: '#ffffff',
  fontSize: '16px',
  fontWeight: '600',
  textDecoration: 'none',
  textAlign: 'center' as const,
  display: 'inline-block',
  padding: '14px 48px',
  lineHeight: '1.5',
  width: '100%',
  maxWidth: '400px',
};

const declineText = {
  color: '#737373',
  fontSize: '14px',
  margin: '0',
  textAlign: 'center' as const,
};

const declineLinkStyle = {
  color: '#737373',
  textDecoration: 'none',
};

