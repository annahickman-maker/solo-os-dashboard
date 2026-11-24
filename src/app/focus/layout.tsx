import '@/components/focus/focus.css';

export const metadata = { title: 'Focus' };

export default function FocusLayout({ children }: { children: React.ReactNode }) {
  return <div className="focus-page flex-1 min-h-0 flex flex-col">{children}</div>;
}
