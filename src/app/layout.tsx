import { SupabaseProvider } from '@/lib/SupabaseContext';
import { AuthProvider } from '@/lib/contexts/AuthContext';
import { NavigationProvider } from '@/lib/contexts/NavigationContext';
import './globals.css';

export default function RootLayout({ children }: { children: React.ReactNode }) {
    return (
      <html lang="en">
        <body>
          <SupabaseProvider>
            <AuthProvider>
              <NavigationProvider>
                {children}
              </NavigationProvider>
            </AuthProvider>
          </SupabaseProvider>
        </body>
      </html>
    );
  }