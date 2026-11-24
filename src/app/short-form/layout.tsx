import { Inter } from 'next/font/google';
import '@/components/solo/solo.css';

const inter = Inter({ subsets: ['latin'], variable: '--font-solo' });

export const metadata = { title: 'Short form' };

export default function ShortFormLayout({ children }: { children: React.ReactNode }) {
  return <div className={`solo ${inter.variable}`}>{children}</div>;
}
