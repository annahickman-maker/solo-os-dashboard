import type { Metadata, Viewport } from 'next';
import { Geist, Geist_Mono } from 'next/font/google';
import './globals.css';
import './solo-theme.css';
import { Sidebar } from '@/components/sidebar';
import { MobileShell } from '@/components/mobile-shell';
import { cn } from "@/lib/utils";

const geist = Geist({subsets:['latin'],variable:'--font-sans'});

const geistMono = Geist_Mono({
  variable: '--font-mono',
  subsets: ['latin'],
});

export const metadata: Metadata = {
  title: 'Solo OS',
  description: 'Solo OS',
  robots: 'noindex, nofollow',
};

export const viewport: Viewport = { width: 'device-width', initialScale: 1, viewportFit: 'cover' };

// Runs before paint: applies the persisted theme (default dark) to <html>
// so there is no flash of the wrong theme.
const THEME_SCRIPT = `try{var t=localStorage.getItem("dh-theme");document.documentElement.classList.toggle("dark",t!=="light")}catch(e){document.documentElement.classList.add("dark")}`;

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning className={cn("dark", "font-sans", geist.variable)}>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />
      </head>
      <body className={`${geist.variable} ${geistMono.variable} text-white font-sans h-[100dvh] w-screen overflow-hidden flex antialiased`}>
        <Sidebar />
        <main className="flex-1 min-w-0 flex flex-col h-full overflow-hidden">
          <MobileShell part="top" />
          {children}
          <MobileShell part="bottom" />
        </main>
      </body>
    </html>
  );
}
