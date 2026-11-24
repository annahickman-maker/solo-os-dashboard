'use client';

/**
 * Solo OS phone shell (<640px).
 * Replaces the sidebar on phones: a top bar (S mark, < ROOM > pill, primary
 * action) and a floating tab bar with a More sheet for the other rooms.
 * Desktop never renders this (CSS .so-mobile-only).
 */
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import {
  BRAND_ITEM,
  CONTENT_ITEM,
  FOCUS_ITEM,
  SETUP_ITEM,
  activeHref,
  useNavModules,
  visibleNavGroups,
} from '@/components/nav';
import { SoloIcon } from '@/components/solo-icons';

// Tab bar: Focus, Content, Brand, then More (every other room, in nav order).
const TABS = [FOCUS_ITEM, CONTENT_ITEM, BRAND_ITEM];
const isTab = (href: string) => TABS.some((t) => t.href === href);

// Rooms whose page has a primary "add" action the + button can trigger.
// The page listens for the `so:primary` window event.
const PRIMARY_ACTION = new Set(['/crm/leads']);

function useTheme() {
  const [light, setLight] = useState(false);
  useEffect(() => setLight(!document.documentElement.classList.contains('dark')), []);
  const toggle = () => {
    const next = !light;
    setLight(next);
    document.documentElement.classList.toggle('dark', !next);
    try {
      localStorage.setItem('dh-theme', next ? 'light' : 'dark');
    } catch {}
  };
  return { light, toggle };
}

export function MobileShell({ part }: { part: 'top' | 'bottom' }) {
  const pathname = usePathname() || '';
  const router = useRouter();
  const [sheet, setSheet] = useState(false);
  const [role, setRole] = useState<'admin' | 'social'>('admin');
  const { light, toggle } = useTheme();
  const groups = visibleNavGroups(useNavModules());
  // The More sheet: each nav group without the tab-bar rooms.
  const moreGroups = groups
    .map((g) => ({ ...g, items: g.items.filter((i) => !isTab(i.href)) }))
    .filter((g) => g.items.length > 0);

  useEffect(() => setSheet(false), [pathname]);
  useEffect(() => {
    fetch('/api/settings/me')
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (d?.role === 'social') setRole('social');
      })
      .catch(() => {});
  }, []);

  if (pathname === '/login' || pathname === '/privacy') return null;

  const current = activeHref(pathname);
  // Order the < > arrows step through.
  const roomOrder = [...groups.flatMap((g) => g.items), SETUP_ITEM];
  const idx = roomOrder.findIndex((i) => i.href === current);
  const room = idx >= 0 ? roomOrder[idx] : null;
  const step = (d: number) => {
    if (role === 'social') return;
    const n = roomOrder.length;
    const next = roomOrder[((idx < 0 ? 0 : idx) + d + n) % n];
    router.push(next.href);
  };

  if (part === 'top') {
    return (
      <div className="so-mobile-only">
        <div className="so-topbar">
          <Link href="/focus" className="so-mark" aria-label="Solo OS">
            S
          </Link>
          <div className="so-seg">
            <button type="button" className="arrow" onClick={() => step(-1)} aria-label="Previous room">
              ‹
            </button>
            <span className="on">{room ? room.label : 'Solo OS'}</span>
            <button type="button" className="arrow" onClick={() => step(1)} aria-label="Next room">
              ›
            </button>
          </div>
          {current && PRIMARY_ACTION.has(current) ? (
            <button
              type="button"
              className="so-plus"
              aria-label="Add"
              onClick={() => window.dispatchEvent(new Event('so:primary'))}
            >
              <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                <path d="M12 5v14M5 12h14" />
              </svg>
            </button>
          ) : (
            <span style={{ width: 36 }} />
          )}
        </div>
      </div>
    );
  }

  const tabs = role === 'social' ? [CONTENT_ITEM] : TABS;
  return (
    <div className="so-mobile-only">
      <nav className="so-tabbar" aria-label="Rooms">
        {tabs.map((t) => (
          <Link key={t.href} href={t.href} className={current === t.href ? 'on' : ''}>
            <SoloIcon name={t.iconName} className="" />
            {t.label}
          </Link>
        ))}
        {role !== 'social' && (
          <button type="button" className={sheet || (current && !isTab(current)) ? 'on' : ''} onClick={() => setSheet(true)}>
            <SoloIcon name="more" className="" />
            More
          </button>
        )}
      </nav>

      {sheet && (
        <>
          <div className="so-scrim" onClick={() => setSheet(false)} />
          <div className="so-sheet" role="dialog" aria-label="More rooms">
            <div className="grip" />
            {moreGroups.map((g) => (
              <div key={g.label ?? 'top'}>
                <div className="group-label">{g.label ?? 'More rooms'}</div>
                <div className="group">
                  {g.items.map((r) => (
                    <Link key={r.href} href={r.href} className="row">
                      <SoloIcon name={r.iconName} className="" />
                      {r.label}
                      <span className="chev">›</span>
                    </Link>
                  ))}
                </div>
              </div>
            ))}
            {/* Pinned last: light mode switch, then Setup */}
            <div className="group" style={{ marginTop: 12 }}>
              <button type="button" className="row" onClick={toggle}>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round">
                  <circle cx="12" cy="12" r="4" />
                  <path d="M12 2.5v2M12 19.5v2M2.5 12h2M19.5 12h2M5.3 5.3l1.4 1.4M17.3 17.3l1.4 1.4M5.3 18.7l1.4-1.4M17.3 6.7l1.4-1.4" />
                </svg>
                Light mode
                <span className={`so-switch ${light ? 'on' : ''}`} />
              </button>
              <Link href={SETUP_ITEM.href} className="row">
                <SoloIcon name={SETUP_ITEM.iconName} className="" />
                {SETUP_ITEM.label}
                <span className="chev">›</span>
              </Link>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
