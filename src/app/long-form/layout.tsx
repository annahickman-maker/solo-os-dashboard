import { Inter } from 'next/font/google';
import '@/components/solo/solo.css';

const inter = Inter({ subsets: ['latin'], variable: '--font-solo' });

export const metadata = { title: 'Long form' };

export default function LongFormLayout({ children }: { children: React.ReactNode }) {
  return <div className={`solo ${inter.variable}`}>{children}</div>;
}
