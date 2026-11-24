import { Inter } from 'next/font/google';
import '@/components/solo/solo.css';
import '@/components/library/library.css';

const inter = Inter({ subsets: ['latin'], variable: '--font-solo' });

export const metadata = { title: 'Library' };

export default function LibraryLayout({ children }: { children: React.ReactNode }) {
  return <div className={`solo ${inter.variable}`}>{children}</div>;
}
