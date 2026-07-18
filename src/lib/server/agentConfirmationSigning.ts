import 'server-only';

const TEST_CONFIRMATION_SIGNING_SECRET =
  'keco-studio-test-only-agent-confirmation-signing-secret-v1';

export function getAgentConfirmationSigningSecret(): string {
  const configured =
    process.env.AGENT_CONFIRMATION_SIGNING_SECRET ?? process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (process.env.NODE_ENV === 'test') {
    return configured ?? TEST_CONFIRMATION_SIGNING_SECRET;
  }
  if (configured === undefined || configured.length < 32) {
    throw new Error('Agent confirmation signing secret is not configured securely.');
  }
  return configured;
}
