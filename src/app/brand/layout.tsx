/** Brand area: shared header and tabs, then the current page. */
import '@/components/solo/solo.css';
import '@/components/brand/brand.css';
import { BrandTabs } from '@/components/brand/brand-tabs';

export default function BrandLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex-1 min-h-0 flex flex-col">
      <BrandTabs />
      <div className="flex-1 min-h-0 flex flex-col">{children}</div>
    </div>
  );
}
