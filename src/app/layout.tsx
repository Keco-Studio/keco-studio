import '@ant-design/v5-patch-for-react-19';
import { SupabaseProvider } from '@/lib/SupabaseContext';
import { AuthProvider } from '@/lib/contexts/AuthContext';
import { NavigationProvider } from '@/lib/contexts/NavigationContext';
import { QueryProvider } from '@/lib/providers/QueryProvider';
import './globals.css';

export default function RootLayout({ children }: { children: React.ReactNode }) {
    return (
      <html lang="en">
        <body>
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