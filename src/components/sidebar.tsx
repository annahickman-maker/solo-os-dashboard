'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';
import { SoloIcon } from '@/components/solo-icons';
import { CONTENT_ITEM, SETUP_ITEM, useNavModules, visibleNavGroups, type NavItem } from '@/components/nav';

export { NAV_ITEMS } from '@/components/nav';

function NavLink({ item, collapsed, pathname }: { item: NavItem; collapsed: boolean; pathname: string | null }) {
  const isActive = pathname === item.href || !!pathname?.startsWith(`${item.href}/`);
  return (
    <Link
      href={item.href}
      title={collapsed ? item.label : undefined}
      className={`flex items-center gap-3 rounded-lg px-3 py-2 transition-colors ${
        collapsed ? 'justify-center' : ''
      } ${isActive ? 'bg-minimal-row text-white' : 'text-minimal-muted hover:text-white hover:bg-minimal-row'}`}
    >
      <SoloIcon name={item.iconName} />
      {!collapsed && <span className="text-[14px] font-medium">{item.label}</span>}
    </Link>
  );
}

function ThemeToggle({ collapsed }: { collapsed: boolean }) {
  const [light, setLight] = useState(false);

  useEffect(() => {
    setLight(!document.documentElement.classList.contains('dark'));
  }, []);

  const toggle = () => {
    const next = !light;
    setLight(next);
    document.documentElement.classList.toggle('dark', !next);
    try {
      localStorage.setItem('dh-theme', next ? 'light' : 'dark');
    } catch {}
  };

  return (
    <button
      onClick={toggle}
      title={light ? 'Switch to dark mode' : 'Switch to light mode'}
      className={`flex items-center gap-3 rounded-lg px-3 py-2 text-minimal-muted hover:text-white hover:bg-minimal-row transition-colors w-full ${
        collapsed ? 'justify-center' : ''
      }`}
    >
      {light ? (
        <svg xmlns="http://www.w3.org/2000/svg" className="w-5 h-5 shrink-0" viewBox="0 0 256 256" fill="currentColor">
          <path d="M233.54,142.23a8,8,0,0,0-8-2,88.08,88.08,0,0,1-109.8-109.8,8,8,0,0,0-10-10,104.84,104.84,0,0,0-52.91,37A104,104,0,0,0,136,224a103.09,103.09,0,0,0,62.52-20.88,104.84,104.84,0,0,0,37-52.91A8,8,0,0,0,233.54,142.23ZM188.9,190.34A88,88,0,0,1,65.66,67.11a89,89,0,0,1,31.4-26A106,106,0,0,0,96,56,104.11,104.11,0,0,0,200,160a106,106,0,0,0,14.92-1.06A89,89,0,0,1,188.9,190.34Z" />
        </svg>
      ) : (
        <svg xmlns="http://www.w3.org/2000/svg" className="w-5 h-5 shrink-0" viewBox="0 0 256 256" fill="currentColor">
          <path d="M120,40V16a8,8,0,0,1,16,0V40a8,8,0,0,1-16,0Zm72,88a64,64,0,1,1-64-64A64.07,64.07,0,0,1,192,128Zm-16,0a48,48,0,1,0-48,48A48.05,48.05,0,0,0,176,128ZM58.34,69.66A8,8,0,0,0,69.66,58.34l-16-16A8,8,0,0,0,42.34,53.66Zm0,116.68-16,16a8,8,0,0,0,11.32,11.32l16-16a8,8,0,0,0-11.32-11.32ZM192,72a8,8,0,0,0,5.66-2.34l16-16a8,8,0,0,0-11.32-11.32l-16,16A8,8,0,0,0,192,72Zm5.66,114.34a8,8,0,0,0-11.32,11.32l16,16a8,8,0,0,0,11.32-11.32ZM48,128a8,8,0,0,0-8-8H16a8,8,0,0,0,0,16H40A8,8,0,0,0,48,128Zm80,80a8,8,0,0,0-8,8v24a8,8,0,0,0,16,0V216A8,8,0,0,0,128,208Zm112-88H216a8,8,0,0,0,0,16h24a8,8,0,0,0,0-16Z" />
        </svg>
      )}
      {!collapsed && <span className="text-[14px] font-medium">{light ? 'Dark mode' : 'Light mode'}</span>}
    </button>
  );
}

export function Sidebar() {
  const pathname = usePathname();
  const [collapsed, setCollapsed] = useState(false);
  const [role, setRole] = useState<'admin' | 'social'>('admin');
  const groups = visibleNavGroups(useNavModules());

  useEffect(() => {
    const mobile = window.matchMedia('(max-width: 639px)');
    const update = () => {
      let saved: string | null = null;
      try { saved = localStorage.getItem('dh-sidebar'); } catch {}
      setCollapsed(saved === null ? mobile.matches : saved === 'collapsed');
    };
    // Respect an explicit saved choice; otherwise follow the current viewport.
    update();
    mobile.addEventListener('change', update);
    return () => mobile.removeEventListener('change', update);
  }, []);

  // Social-role users only get the Content (/social) room. Middleware enforces it;
  // this just keeps the nav honest.
  useEffect(() => {
    fetch('/api/settings/me')
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (d?.role === 'social') setRole('social');
      })
      .catch(() => {});
  }, []);

  const toggleCollapsed = () => {
    const next = !collapsed;
    setCollapsed(next);
    try {
      localStorage.setItem('dh-sidebar', next ? 'collapsed' : 'expanded');
    } catch {}
  };

  // Don't show sidebar on login page
  if (pathname === '/login' || pathname === '/privacy') return null;

  return (
    <aside
      className={`so-sidebar so-desktop-only ${collapsed ? 'w-16' : 'w-60'} shrink-0 border-r border-minimal-border flex flex-col py-4 transition-[width] duration-200`}
    >
      {/* Wordmark + collapse toggle */}
      <div className={`flex items-center px-3 mb-6 ${collapsed ? 'flex-col gap-3' : 'justify-between'}`}>
        <Link href="/focus" className="flex items-center gap-2.5 px-1.5" title="Solo OS">
          <span className="w-6 h-6 rounded-md bg-white text-black text-[11px] font-bold flex items-center justify-center shrink-0">
            S
          </span>
          {!collapsed && <span className="text-[14px] font-semibold text-white">Solo OS</span>}
        </Link>
        <button
          onClick={toggleCollapsed}
          title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          className="text-minimal-muted hover:text-white p-1.5 rounded-md hover:bg-minimal-row transition-colors"
        >
          {collapsed ? (
            <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4" viewBox="0 0 256 256" fill="currentColor">
              <path d="M181.66,133.66l-80,80a8,8,0,0,1-11.32-11.32L164.69,128,90.34,53.66a8,8,0,0,1,11.32-11.32l80,80A8,8,0,0,1,181.66,133.66Z" />
            </svg>
          ) : (
            <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4" viewBox="0 0 256 256" fill="currentColor">
              <path d="M165.66,202.34a8,8,0,0,1-11.32,11.32l-80-80a8,8,0,0,1,0-11.32l80-80a8,8,0,0,1,11.32,11.32L91.31,128Z" />
            </svg>
          )}
        </button>
      </div>

      {/* Nav */}
      <nav className="flex flex-col gap-1 px-3 flex-1 overflow-y-auto">
        {role === 'social' ? (
          <NavLink item={CONTENT_ITEM} collapsed={collapsed} pathname={pathname} />
        ) : (
          groups.map((group, i) => (
            <div key={group.label ?? 'top'} className="flex flex-col gap-1">
              {i > 0 && <div className="my-3 mx-3 border-t border-minimal-border" />}
              {group.label && !collapsed && (
                <div className="px-3 pb-1 text-[11px] font-bold uppercase tracking-[0.1em] text-[color:var(--so-label)]">
                  {group.label}
                </div>
              )}
              {group.items.map((item) => (
                <NavLink key={item.href} item={item} collapsed={collapsed} pathname={pathname} />
              ))}
            </div>
          ))
        )}
      </nav>

      {/* Pinned bottom: light mode switch, then Setup */}
      <div className="px-3 pt-3 mt-3 border-t border-minimal-border flex flex-col gap-1">
        <ThemeToggle collapsed={collapsed} />
        {role !== 'social' && <NavLink item={SETUP_ITEM} collapsed={collapsed} pathname={pathname} />}
      </div>
    </aside>
  );
}
