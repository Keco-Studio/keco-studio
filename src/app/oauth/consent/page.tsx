import { Suspense } from 'react';
import { OAuthConsentClient } from '@/components/mcp/OAuthConsentClient';

export default function OAuthConsentPage() {
  return (
    <Suspense fallback={<main>Loading authorization request...</main>}>
      <OAuthConsentClient />
    </Suspense>
  );
}
