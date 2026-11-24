'use client';

/**
 * Settings-driven navigation, shared by the desktop sidebar and the phone shell.
 *
 * Layout: an unlabelled top group (Focus, Analytics, Pipeline, Sales), then
 * "Marketing" (Content, Contacts, Email) and "Brand" (Brand, Memory, Library).
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

export type NavItem = { href: string; label: string; iconName: SoloIconName };

export type NavModuleKey = 'leads' | 'pipeline' | 'email' | 'analytics' | 'sales';
export type NavModules = Record<NavModuleKey, boolean>;
export type NavDoc = { modules: NavModules };

/** A nav room; `module` makes it optional (hidden when its Setup toggle is off). */
export type NavEntry = NavItem & { module?: NavModuleKey };
export type NavGroup = { label: string | null; items: NavEntry[] };
export type ModuleNavItem = NavItem & { module: NavModuleKey; setupLabel: string };

export const DEFAULT_NAV_MODULES: NavModules = { leads: true, pipeline: false, email: true, analytics: true, sales: false };

/** Fired on window (detail: NavDoc) after Setup saves, so the nav updates without a reload. */
export const NAV_CHANGED_EVENT = 'so:nav';

export const FOCUS_ITEM: NavItem = { href: '/focus', label: 'Focus', iconName: 'focus' };
/** The content scheduler, calendar and performance (the /social room). */
export const CONTENT_ITEM: NavItem = { href: '/social', label: 'Content', iconName: 'social' };
export const BRAND_ITEM: NavItem = { href: '/brand', label: 'Brand', iconName: 'brand' };
export const MEMORY_ITEM: NavItem = { href: '/memory', label: 'Memory', iconName: 'memory' };
export const LIBRARY_ITEM: NavItem = { href: '/library', label: 'Library', iconName: 'library' };
export const SETUP_ITEM: NavItem = { href: '/crm/settings', label: 'Setup', iconName: 'setup' };

const ANALYTICS: ModuleNavItem = { href: '/crm/analytics', label: 'Analytics', iconName: 'analytics', module: 'analytics', setupLabel: 'Analytics' };
const PIPELINE: ModuleNavItem = { href: '/crm/pipeline', label: 'Pipeline', iconName: 'pipeline', module: 'pipeline', setupLabel: 'Client pipeline' };
const SALES: ModuleNavItem = { href: '/sales', label: 'Sales', iconName: 'sales', module: 'sales', setupLabel: 'Sales' };
const CONTACTS: ModuleNavItem = { href: '/crm/leads', label: 'Contacts', iconName: 'leads', module: 'leads', setupLabel: 'Contacts' };
const EMAIL: ModuleNavItem = { href: '/crm/workflows', label: 'Email', iconName: 'email', module: 'email', setupLabel: 'Email' };

/** Every room in nav order. Setup is pinned separately at the bottom. */
export const NAV_GROUPS: NavGroup[] = [
  { label: null, items: [FOCUS_ITEM, ANALYTICS, PIPELINE, SALES] },
  { label: 'Marketing', items: [CONTENT_ITEM, CONTACTS, EMAIL] },
  { label: 'Brand', items: [BRAND_ITEM, MEMORY_ITEM, LIBRARY_ITEM] },
];

/** The optional rooms, in the order Setup lists their toggles. */
export const MODULE_NAV: ModuleNavItem[] = [ANALYTICS, PIPELINE, SALES, CONTACTS, EMAIL];

export const NAV_ITEMS: NavItem[] = [...NAV_GROUPS.flatMap((g) => g.items), SETUP_ITEM];

export function normalizeNavDoc(value: unknown): NavDoc {
  const raw = (value && typeof value === 'object' ? (value as { modules?: unknown }).modules : null) ?? {};
  const modules = { ...DEFAULT_NAV_MODULES };
  for (const key of Object.keys(DEFAULT_NAV_MODULES) as NavModuleKey[]) {
    const v = (raw as Record<string, unknown>)[key];
    if (typeof v === 'boolean') modules[key] = v;
  }
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
  const match = items
    .filter((i) => pathname === i.href || pathname.startsWith(`${i.href}/`))
    .sort((a, b) => b.href.length - a.href.length)[0];
  return match ? match.href : null;
}
