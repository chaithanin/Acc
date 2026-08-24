'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';
import type { Role, User } from '@/lib/types';
import { FALLBACK_ICON, NAV_ICONS } from './nav-icons';
import { cx } from './ui/primitives';

/**
 * Navigation shell (requirement 12).
 *
 * Entries are filtered by role, so a Viewer never sees an Import link that
 * would only refuse them. The server enforces the same rules independently —
 * this is convenience, not security.
 */

interface NavItem {
  href: string;
  label: string;
  roles: Role[];
}

const NAV_GROUPS: { title: string; items: NavItem[] }[] = [
  {
    title: 'Dashboards',
    items: [
      { href: '/financial', label: 'Financial Dashboard', roles: ['admin', 'finance', 'management', 'viewer'] },
      { href: '/', label: 'Executive Overview', roles: ['admin', 'finance', 'management', 'viewer'] },
      { href: '/projects', label: 'Project Dashboard', roles: ['admin', 'finance', 'management', 'viewer'] },
      { href: '/receivable', label: 'Receivable', roles: ['admin', 'finance', 'management', 'viewer'] },
      { href: '/boq', label: 'BOQ / Construction', roles: ['admin', 'finance', 'management', 'viewer'] },
      { href: '/cashflow', label: 'Cash Flow Forecast', roles: ['admin', 'finance', 'management', 'viewer'] },
      { href: '/ledger', label: 'Ledger & Advances', roles: ['admin', 'finance', 'management', 'viewer'] },
    ],
  },
  {
    title: 'Data',
    items: [
      { href: '/import', label: 'Data Import', roles: ['admin', 'finance'] },
      { href: '/import/history', label: 'Import History', roles: ['admin', 'finance', 'management'] },
      { href: '/reports/customer-card', label: 'Customer Card Report', roles: ['admin', 'finance'] },
      { href: '/reconciliation', label: 'Reconciliation', roles: ['admin', 'finance', 'management'] },
      { href: '/inspector', label: 'Data Inspector', roles: ['admin', 'finance'] },
    ],
  },
  {
    title: 'Settings',
    items: [
      { href: '/settings/budget', label: 'Budget', roles: ['admin', 'finance'] },
      { href: '/settings/projects', label: 'Projects & Aliases', roles: ['admin', 'finance'] },
      { href: '/settings/templates', label: 'Template Mapping', roles: ['admin', 'finance'] },
      { href: '/settings/companies', label: 'Companies', roles: ['admin'] },
      { href: '/settings/users', label: 'Users & Roles', roles: ['admin'] },
      { href: '/settings/audit', label: 'Activity Log', roles: ['admin'] },
    ],
  },
];

export interface ActiveCompany {
  id: string;
  companyCode: string;
  displayName: string;
  legalName: string;
  projectCount: number;
}

export function AppShell({
  user,
  company,
  children,
}: {
  user: User;
  company: ActiveCompany;
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(false);

  // Navigating on a phone should dismiss the drawer.
  useEffect(() => setMobileOpen(false), [pathname]);

  // Read after mount rather than during render: the server has no way to know
  // this preference, and rendering the wrong width first would show the
  // sidebar snapping on every page load.
  useEffect(() => {
    setCollapsed(localStorage.getItem('gtg-nav-collapsed') === '1');
  }, []);

  const toggleCollapsed = () => {
    setCollapsed((value) => {
      localStorage.setItem('gtg-nav-collapsed', value ? '0' : '1');
      return !value;
    });
  };

  return (
    <div className="flex min-h-screen">
      <aside
        className={cx(
          'no-print fixed inset-y-0 left-0 z-40 flex shrink-0 flex-col overflow-y-auto border-r border-sidebar-border bg-sidebar',
          'transition-[transform,width] duration-200 lg:static lg:translate-x-0',
          collapsed ? 'w-[4.5rem]' : 'w-60',
          mobileOpen ? 'translate-x-0' : '-translate-x-full',
        )}
      >
        <div
          className={cx(
            'flex items-center gap-2.5 border-b border-sidebar-border py-4',
            collapsed ? 'justify-center px-2' : 'px-4',
          )}
        >
          <span
            aria-hidden
            className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-sidebar-active text-sm font-bold text-white"
          >
            {company.companyCode.slice(0, 1)}
          </span>
          {collapsed ? null : (
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold leading-tight text-sidebar-ink">
                {company.displayName}
              </p>
              <p className="mt-0.5 truncate text-[11px] text-sidebar-ink-muted">
                {company.companyCode} · Financial Management
              </p>
            </div>
          )}
        </div>

        <nav className="flex-1 px-2 py-3">
          {NAV_GROUPS.map((group) => {
            const items = group.items.filter((item) => item.roles.includes(user.role));
            if (items.length === 0) return null;

            return (
              <div key={group.title} className="mb-4">
                {collapsed ? (
                  // A rule instead of a word: the grouping still reads, and a
                  // truncated label would read as a mistake.
                  <div className="mx-2 mb-2 border-t border-sidebar-border" />
                ) : (
                  <p className="px-3 pb-1.5 text-[10px] font-semibold uppercase tracking-wider text-sidebar-ink-muted">
                    {group.title}
                  </p>
                )}
                {items.map((item) => {
                  const active =
                    item.href === '/' ? pathname === '/' : pathname.startsWith(item.href);
                  return (
                    <Link
                      key={item.href}
                      href={item.href}
                      aria-current={active ? 'page' : undefined}
                      // The label is the accessible name whether or not it is
                      // drawn, so a collapsed rail is still navigable by
                      // screen reader, and it doubles as the hover tooltip.
                      title={collapsed ? item.label : undefined}
                      className={cx(
                        'group relative mb-0.5 flex items-center gap-3 rounded-lg text-sm transition-colors',
                        collapsed ? 'justify-center px-0 py-2.5' : 'px-3 py-2',
                        active
                          ? 'bg-sidebar-active font-medium text-white'
                          : 'text-sidebar-ink-muted hover:bg-sidebar-hover hover:text-sidebar-ink',
                      )}
                    >
                      <span className="shrink-0">{NAV_ICONS[item.href] ?? FALLBACK_ICON}</span>
                      {collapsed ? (
                        <span className="sr-only">{item.label}</span>
                      ) : (
                        <span className="truncate">{item.label}</span>
                      )}
                    </Link>
                  );
                })}
              </div>
            );
          })}
        </nav>

        {/*
          Leaving the company is its own action at the foot of the navigation
          rather than a menu item among the pages, because it changes which
          data every other link shows.
        */}
        <div className="mt-auto border-t border-sidebar-border p-2">
          {collapsed ? (
            <Link
              href="/companies"
              title="Switch company"
              className="flex justify-center rounded-lg py-2.5 text-sidebar-ink-muted transition-colors hover:bg-sidebar-hover hover:text-sidebar-ink"
            >
              <svg
                width={18}
                height={18}
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth={1.7}
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden
              >
                <path d="M4 7h13" />
                <path d="M14 4l3 3-3 3" />
                <path d="M20 17H7" />
                <path d="M10 14l-3 3 3 3" />
              </svg>
              <span className="sr-only">Switch company</span>
            </Link>
          ) : (
            <div className="rounded-xl bg-sidebar-hover p-3">
              <p className="truncate text-xs font-medium text-sidebar-ink">
                {company.displayName}
              </p>
              <p className="mt-0.5 text-[11px] text-sidebar-ink-muted">
                {company.projectCount}{' '}
                {company.projectCount === 1 ? 'project' : 'projects'}
              </p>
              <Link
                href="/companies"
                className="mt-2.5 flex items-center justify-center gap-1.5 rounded-lg bg-sidebar-active px-3 py-1.5 text-xs font-medium text-white transition-opacity hover:opacity-90"
              >
                Switch company
              </Link>
            </div>
          )}

          <button
            type="button"
            onClick={toggleCollapsed}
            className={cx(
              'mt-2 hidden w-full items-center gap-2 rounded-lg py-2 text-xs text-sidebar-ink-muted',
              'transition-colors hover:bg-sidebar-hover hover:text-sidebar-ink lg:flex',
              collapsed ? 'justify-center' : 'px-3',
            )}
            aria-label={collapsed ? 'Expand navigation' : 'Collapse navigation'}
          >
            <span aria-hidden className="text-base leading-none">
              {collapsed ? '»' : '«'}
            </span>
            {collapsed ? null : <span>Collapse</span>}
          </button>
        </div>
      </aside>

      {mobileOpen ? (
        <div
          className="fixed inset-0 z-30 bg-black/40 lg:hidden"
          onClick={() => setMobileOpen(false)}
          aria-hidden
        />
      ) : null}

      <div className="flex min-w-0 flex-1 flex-col">
        <TopBar user={user} company={company} onMenu={() => setMobileOpen(true)} />
        <main className="flex-1 px-4 py-6 sm:px-6 lg:px-8">{children}</main>
      </div>
    </div>
  );
}

function TopBar({
  user,
  company,
  onMenu,
}: {
  user: User;
  company: ActiveCompany;
  onMenu: () => void;
}) {
  return (
    <header className="no-print sticky top-0 z-20 flex items-center gap-3 border-b border-border bg-surface/95 px-4 py-2.5 backdrop-blur sm:px-6 lg:px-8">
      <button
        type="button"
        onClick={onMenu}
        className="rounded-md p-1.5 text-ink-secondary hover:bg-surface-hover lg:hidden"
        aria-label="Open navigation"
      >
        ☰
      </button>

      {/*
        The company sits in the top bar on every page. Someone reading a figure
        should never have to work out whose figure it is.
      */}
      {/*
        The company is named on every page. Someone reading a figure should
        never have to work out whose figure it is.
      */}
      <Link
        href="/companies"
        className="min-w-0 rounded-lg px-2 py-1 transition-colors hover:bg-surface-hover"
        title="Switch company"
      >
        <span className="flex items-center gap-1.5">
          <span className="truncate text-sm font-semibold text-ink">{company.displayName}</span>
          <span aria-hidden className="text-[10px] text-ink-muted">
            ▾
          </span>
        </span>
        <span className="block text-[11px] leading-tight text-ink-muted">
          {company.companyCode}
        </span>
      </Link>

      <div className="ml-auto flex items-center gap-2">
        <ThemeToggle />
        <UserMenu user={user} />
      </div>
    </header>
  );
}

/**
 * The account menu.
 *
 * Sign out moved in here from the top bar, where it sat as a permanently
 * visible button next to everything else — one stray click from ending
 * someone's session mid-task.
 */
function UserMenu({ user }: { user: User }) {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();

  // Any navigation closes it, including a click on one of its own entries.
  useEffect(() => setOpen(false), [pathname]);

  useEffect(() => {
    if (!open) return;
    // Escape and a click elsewhere both close it, which is what a menu is
    // expected to do and what a bare dropdown does not do on its own.
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    const onClick = () => setOpen(false);
    document.addEventListener('keydown', onKey);
    document.addEventListener('click', onClick);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('click', onClick);
    };
  }, [open]);

  const initials = user.name
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0] ?? '')
    .join('')
    .toUpperCase();

  return (
    <div className="relative" onClick={(e) => e.stopPropagation()}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-haspopup="menu"
        className="flex items-center gap-2 rounded-lg px-1.5 py-1 transition-colors hover:bg-surface-hover"
      >
        <span
          aria-hidden
          className="grid h-8 w-8 place-items-center rounded-full bg-accent text-xs font-semibold text-white"
        >
          {initials || '?'}
        </span>
        <span className="hidden text-left sm:block">
          <span className="block text-xs font-medium leading-tight text-ink">{user.name}</span>
          <span className="block text-[11px] capitalize leading-tight text-ink-muted">
            {user.role}
          </span>
        </span>
        <span aria-hidden className="text-[10px] text-ink-muted">
          ▾
        </span>
      </button>

      {open ? (
        <div
          role="menu"
          className="absolute right-0 z-30 mt-1.5 w-56 overflow-hidden rounded-[var(--radius-card)] border border-border bg-surface shadow-lg"
        >
          <div className="border-b border-border px-3 py-2.5">
            <p className="truncate text-sm font-medium text-ink">{user.name}</p>
            <p className="truncate text-xs text-ink-muted">{user.email}</p>
          </div>

          <Link
            href="/account"
            role="menuitem"
            className="block px-3 py-2 text-sm text-ink-secondary transition-colors hover:bg-surface-hover hover:text-ink"
          >
            Profile settings
          </Link>
          <Link
            href="/companies"
            role="menuitem"
            className="block px-3 py-2 text-sm text-ink-secondary transition-colors hover:bg-surface-hover hover:text-ink"
          >
            Switch company
          </Link>

          <form action="/api/auth/logout" method="post" className="border-t border-border">
            <button
              type="submit"
              role="menuitem"
              className="w-full px-3 py-2 text-left text-sm text-critical transition-colors hover:bg-critical/10"
            >
              Log out
            </button>
          </form>
        </div>
      ) : null}
    </div>
  );
}

function ThemeToggle() {
  const [theme, setTheme] = useState<'light' | 'dark' | null>(null);

  useEffect(() => {
    const stored = localStorage.getItem('gtg-theme');
    if (stored === 'dark' || stored === 'light') setTheme(stored);
  }, []);

  const toggle = () => {
    const next =
      theme === 'dark'
        ? 'light'
        : theme === 'light'
          ? 'dark'
          : window.matchMedia('(prefers-color-scheme: dark)').matches
            ? 'light'
            : 'dark';
    setTheme(next);
    localStorage.setItem('gtg-theme', next);
    document.documentElement.setAttribute('data-theme', next);
  };

  return (
    <button
      type="button"
      onClick={toggle}
      className="rounded-md border border-border-strong px-2 py-1 text-xs text-ink-secondary hover:bg-surface-hover"
      aria-label="Toggle colour theme"
    >
      {theme === 'dark' ? '☀' : '☾'}
    </button>
  );
}
