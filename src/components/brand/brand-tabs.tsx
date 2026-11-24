'use client';
/**
 * Brand area header: "Brand" plus the Playbooks / Reputation /
 * Offer page tabs. Hidden on a single playbook (/brand/<slug>), which has
 * its own header with a way back.
 */
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { PageHeader } from '@/components/crm/kit';

const TABS = [
  { href: '/brand', label: 'Playbooks' },
  { href: '/brand/reputation', label: 'Reputation' },
  { href: '/brand/offer', label: 'Offer' },
];

export function BrandTabs() {
  const path = (usePathname() || '/brand').replace(/\/+$/, '') || '/brand';
  const active = TABS.slice(1).find((t) => path === t.href || path.startsWith(`${t.href}/`))?.href
    ?? (path === '/brand' ? '/brand' : null);
  if (!active) return null;
  return (
    <>
      <PageHeader title="Brand" className="!px-4 sm:!px-12" />
      <nav aria-label="Brand sections" className="px-4 sm:px-12 flex items-center gap-1 border-b border-minimal-border shrink-0 overflow-x-auto">
        {TABS.map((t) => (
          <Link
            key={t.href}
            href={t.href}
            aria-current={t.href === active ? 'page' : undefined}
            className={`px-3.5 py-2.5 text-[13px] font-medium border-b-2 -mb-px whitespace-nowrap transition-colors ${
              t.href === active ? 'border-white text-white' : 'border-transparent text-minimal-muted hover:text-white'
            }`}
          >
            {t.label}
          </Link>
        ))}
      </nav>
    </>
  );
}
