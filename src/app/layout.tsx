import '@ant-design/v5-patch-for-react-19';
import { Koulen, Roboto } from 'next/font/google';
import { SupabaseProvider } from '@/lib/SupabaseContext';
import { AuthProvider } from '@/lib/contexts/AuthContext';
import { NavigationProvider } from '@/lib/contexts/NavigationContext';
import { QueryProvider } from '@/lib/providers/QueryProvider';
import './globals.css';

// 配置 Koulen 字体
const koulen = Koulen({
  weight: '400',
  subsets: ['latin'],
  display: 'swap',
  variable: '--font-koulen',
});

// 配置 Roboto 字体（regular 400）
const roboto = Roboto({
  weight: ['400', '500', '700'],
  subsets: ['latin'],
  display: 'swap',
  variable: '--font-roboto',
});

export default function RootLayout({ children }: { children: React.ReactNode }) {
    return (
      <html lang="en" className={`${koulen.variable} ${roboto.variable}`}>
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