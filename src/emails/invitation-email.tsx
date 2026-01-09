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
} from '@react-email/components';

interface InvitationEmailProps {
  recipientName: string;
  inviterName: string;
  projectName: string;
  role: string;
  acceptLink: string;
}

export function InvitationEmail({
  recipientName = 'there',
  inviterName = 'A team member',
  projectName = 'Untitled Project',
  role = 'Editor',
  acceptLink = 'https://app.keco.studio',
}: InvitationEmailProps) {
  const previewText = `${inviterName} invited you to collaborate on ${projectName}`;

  return (
    <Html>
      <Head />
      <Preview>{previewText}</Preview>
      <Body style={main}>
        <Container style={container}>
          {/* Logo */}
          <Section style={logoSection}>
            <Heading style={logoText}>Keco Studio</Heading>
          </Section>

          {/* Main Content */}
          <Section style={content}>
            <Heading style={h1}>You've been invited!</Heading>
            
            <Text style={text}>
              Hi {recipientName},
            </Text>
            
            <Text style={text}>
              <strong>{inviterName}</strong> has invited you to collaborate on 
              the project <strong>{projectName}</strong> as a <strong>{role}</strong>.
            </Text>
            
            <Text style={text}>
              As a {role.toLowerCase()}, you'll be able to:
            </Text>
            
            <ul style={list}>
              {role === 'Admin' && (
                <>
                  <li style={listItem}>Invite and manage collaborators</li>
                  <li style={listItem}>Edit all project content and settings</li>
                  <li style={listItem}>View all project libraries and assets</li>
                </>
              )}
              {role === 'Editor' && (
                <>
                  <li style={listItem}>Edit project libraries and assets</li>
                  <li style={listItem}>Create and modify library content</li>
                  <li style={listItem}>Collaborate in real-time with team members</li>
                </>
              )}
              {role === 'Viewer' && (
                <>
                  <li style={listItem}>View project libraries and assets</li>
                  <li style={listItem}>See real-time updates from editors</li>
                  <li style={listItem}>Export and share library content</li>
                </>
              )}
            </ul>
            
            <Section style={buttonSection}>
              <Button style={button} href={acceptLink}>
                Accept Invitation
              </Button>
            </Section>
            
            <Text style={text}>
              Or copy and paste this URL into your browser:
            </Text>
            <Text style={linkText}>
              <Link href={acceptLink} style={link}>
                {acceptLink}
              </Link>
            </Text>
            
            <Hr style={hr} />
            
            <Text style={footer}>
              This invitation will expire in 7 days. If you didn't expect this invitation, 
              you can safely ignore this email.
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
  backgroundColor: '#f6f9fc',
  fontFamily:
    '-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,"Helvetica Neue",Ubuntu,sans-serif',
};

const container = {
  backgroundColor: '#ffffff',
  margin: '0 auto',
  padding: '20px 0 48px',
  marginBottom: '64px',
  maxWidth: '600px',
};

const logoSection = {
  padding: '32px 40px',
  textAlign: 'center' as const,
  borderBottom: '1px solid #e6e8eb',
};

const logoText = {
  color: '#1a1a1a',
  fontSize: '24px',
  fontWeight: '700',
  margin: '0',
  letterSpacing: '-0.5px',
};

const content = {
  padding: '40px 40px',
};

const h1 = {
  color: '#1a1a1a',
  fontSize: '28px',
  fontWeight: '700',
  lineHeight: '1.3',
  margin: '0 0 24px',
};

const text = {
  color: '#525252',
  fontSize: '16px',
  lineHeight: '1.6',
  margin: '0 0 16px',
};

const list = {
  color: '#525252',
  fontSize: '16px',
  lineHeight: '1.6',
  margin: '0 0 16px',
  paddingLeft: '20px',
};

const listItem = {
  marginBottom: '8px',
};

const buttonSection = {
  textAlign: 'center' as const,
  margin: '32px 0',
};

const button = {
  backgroundColor: '#000000',
  borderRadius: '6px',
  color: '#ffffff',
  fontSize: '16px',
  fontWeight: '600',
  textDecoration: 'none',
  textAlign: 'center' as const,
  display: 'inline-block',
  padding: '12px 32px',
  lineHeight: '1.5',
};

const linkText = {
  color: '#737373',
  fontSize: '14px',
  lineHeight: '1.6',
  margin: '0 0 16px',
  wordBreak: 'break-all' as const,
};

const link = {
  color: '#2563eb',
  textDecoration: 'underline',
};

const hr = {
  borderColor: '#e6e8eb',
  margin: '32px 0',
};

const footer = {
  color: '#737373',
  fontSize: '14px',
  lineHeight: '1.6',
  margin: '0',
};

