import { Inter } from 'next/font/google';
import '@/components/solo/solo.css';
import '@/components/library/library.css';

const inter = Inter({ subsets: ['latin'], variable: '--font-solo' });

export const metadata = { title: 'Memory' };

/** Same look as the Library: the Solo page scope and its search bar styles. */
export default function MemoryLayout({ children }: { children: React.ReactNode }) {
  return <div className={`solo ${inter.variable}`}>{children}</div>;
}
