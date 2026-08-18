import type { Metadata } from 'next';
import { SupabaseProvider } from '@/lib/SupabaseContext';
import { AuthProvider } from '@/lib/contexts/AuthContext';
import { NavigationProvider } from '@/lib/contexts/NavigationContext';
import { QueryProvider } from '@/lib/providers/QueryProvider';
import './globals.css';

export const metadata: Metadata = {
  title: 'Keco Studio',
  description: 'Collaborative game design workspace',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    // translate="no" keeps browser auto-translate from rewriting React text
    // nodes, which otherwise surfaces as removeChild NotFoundError on route
    // changes (Next.js route announcer / React 19 commit deletion).
    <html lang="en" translate="no">
      <body suppressHydrationWarning>
        <QueryProvider>
          <SupabaseProvider>
            <AuthProvider>
              <NavigationProvider>
                {children}
              </NavigationProvider>
            </AuthProvider>
          </SupabaseProvider>
        </QueryProvider>
      </body>
    </html>
  );
}
