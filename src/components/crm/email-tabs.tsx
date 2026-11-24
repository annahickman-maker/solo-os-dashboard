'use client';
/** Email has two views: Email automations and All contacts. Same underline tabs as Content. */
import Link from 'next/link';
import { usePathname } from 'next/navigation';

const TABS = [
  { href: '/crm/workflows', label: 'Email automations' },
  { href: '/crm/leads', label: 'All contacts' },
];

export function EmailTabs() {
  const path = usePathname() || '';
  return (
    <nav aria-label="Email views" className="px-4 sm:px-12 flex items-center gap-1 border-b border-minimal-border shrink-0 overflow-x-auto mb-4">
      {TABS.map((t) => {
        const on = path === t.href || path.startsWith(`${t.href}/`);
        return (
          <Link
            key={t.href}
            href={t.href}
            aria-current={on ? 'page' : undefined}
            className={`px-3.5 py-2.5 text-[13px] font-medium border-b-2 -mb-px whitespace-nowrap transition-colors ${
              on ? 'border-white text-white' : 'border-transparent text-minimal-muted hover:text-white'
            }`}
          >
            {t.label}
          </Link>
        );
      })}
    </nav>
  );
}
