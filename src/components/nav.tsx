'use client';

/**
 * Settings-driven navigation, shared by the desktop sidebar and the phone shell.
 *
 * Layout: an unlabelled top group (Focus, Analytics, Pipeline, Sales), then
 * "Marketing" (Content, Email with its Contacts tab) and "Brand" (Brand, Memory, Library).
 * The light mode switch and Setup sit pinned at the bottom.
 *
 * Focus, Content, Brand, Memory and Library are always shown. The optional
 * modules are toggled in Setup and stored in the solo document `nav` as
 * { modules: { leads, pipeline, email, analytics, sales } }. The `leads` key
 * is the Contacts room (kept so saved settings keep working).
 */
import { useEffect, useState } from 'react';
import { loadDoc } from '@/lib/solo/client';
import type { SoloIconName } from '@/components/solo-icons';

/** `also`: other routes that count as this room (e.g. Contacts lives under Email). */
export type NavItem = { href: string; label: string; iconName: SoloIconName; also?: string[] };

export type NavModuleKey = 'leads' | 'pipeline' | 'email' | 'analytics' | 'sales';
export type NavModules = Record<NavModuleKey, boolean>;
export type NavDoc = { modules: NavModules };

/** A nav room; `module` makes it optional (hidden when its Setup toggle is off). */
export type NavEntry = NavItem & { module?: NavModuleKey };
export type NavGroup = { label: string | null; items: NavEntry[] };
export type ModuleNavItem = NavItem & { module: NavModuleKey; setupLabel: string };

// Sales is always on: every sale counts, whether or not the owner works with clients.
export const DEFAULT_NAV_MODULES: NavModules = { leads: true, pipeline: false, email: true, analytics: true, sales: true };

/** Fired on window (detail: NavDoc) after Setup saves, so the nav updates without a reload. */
export const NAV_CHANGED_EVENT = 'so:nav';

export const FOCUS_ITEM: NavItem = { href: '/focus', label: 'Focus', iconName: 'focus' };
/** The content scheduler, calendar and performance (the /social room). */
export const CONTENT_ITEM: NavItem = { href: '/social', label: 'Content', iconName: 'social' };
export const BRAND_ITEM: NavItem = { href: '/brand', label: 'Brand', iconName: 'brand' };
export const MEMORY_ITEM: NavItem = { href: '/memory', label: 'Memory', iconName: 'memory' };
export const LIBRARY_ITEM: NavItem = { href: '/library', label: 'Library', iconName: 'library' };
export const SETUP_ITEM: NavItem = { href: '/crm/settings', label: 'Setup', iconName: 'setup' };

export const ANALYTICS: ModuleNavItem = { href: '/crm/analytics', label: 'Analytics', iconName: 'analytics', module: 'analytics', setupLabel: 'Analytics' };
const PIPELINE: ModuleNavItem = { href: '/crm/pipeline', label: 'Pipeline', iconName: 'pipeline', module: 'pipeline', setupLabel: 'Client pipeline' };
const SALES: NavItem = { href: '/sales', label: 'Sales', iconName: 'sales' };
// Email has two tabs: Email automations (/crm/workflows) and All contacts (/crm/leads).
const EMAIL: ModuleNavItem = { href: '/crm/workflows', label: 'Email', iconName: 'email', module: 'email', setupLabel: 'Email and contacts', also: ['/crm/leads'] };

/** Every room in nav order. Setup is pinned separately at the bottom. */
export const NAV_GROUPS: NavGroup[] = [
  { label: null, items: [FOCUS_ITEM, ANALYTICS, PIPELINE, SALES] },
  { label: 'Marketing', items: [CONTENT_ITEM, EMAIL] },
  { label: 'Brand', items: [BRAND_ITEM, MEMORY_ITEM, LIBRARY_ITEM] },
];

/** The optional rooms, in the order Setup lists their toggles. */
export const MODULE_NAV: ModuleNavItem[] = [ANALYTICS, PIPELINE, EMAIL];

export const NAV_ITEMS: NavItem[] = [...NAV_GROUPS.flatMap((g) => g.items), SETUP_ITEM];

export function normalizeNavDoc(value: unknown): NavDoc {
  const raw = (value && typeof value === 'object' ? (value as { modules?: unknown }).modules : null) ?? {};
  const modules = { ...DEFAULT_NAV_MODULES };
  for (const key of Object.keys(DEFAULT_NAV_MODULES) as NavModuleKey[]) {
    const v = (raw as Record<string, unknown>)[key];
    if (typeof v === 'boolean') modules[key] = v;
  }
  modules.sales = true;
  return { modules };
}

/** The groups with switched-off modules removed; a group left empty is dropped. */
export function visibleNavGroups(modules: NavModules): NavGroup[] {
  return NAV_GROUPS.map((g) => ({ ...g, items: g.items.filter((i) => !i.module || modules[i.module]) })).filter(
    (g) => g.items.length > 0,
  );
}

/** The nav doc's modules; defaults until loaded, and on any error. */
export function useNavModules(enabled = true): NavModules {
  const [modules, setModules] = useState<NavModules>(DEFAULT_NAV_MODULES);
  useEffect(() => {
    if (!enabled) return;
    let live = true;
    loadDoc<unknown>('nav', null)
      .then((doc) => {
        if (live) setModules(normalizeNavDoc(doc).modules);
      })
      .catch(() => {});
    const onChange = (e: Event) => setModules(normalizeNavDoc((e as CustomEvent).detail).modules);
    window.addEventListener(NAV_CHANGED_EVENT, onChange);
    return () => {
      live = false;
      window.removeEventListener(NAV_CHANGED_EVENT, onChange);
    };
  }, [enabled]);
  return modules;
}

/** Longest matching room for a path, or null. */
export function activeHref(pathname: string, items: NavItem[] = NAV_ITEMS): string | null {
  const hits = items.flatMap((i) =>
    [i.href, ...(i.also || [])]
      .filter((h) => pathname === h || pathname.startsWith(`${h}/`))
      .map((h) => ({ href: i.href, len: h.length })),
  );
  const match = hits.sort((a, b) => b.len - a.len)[0];
  return match ? match.href : null;
}
